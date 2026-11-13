-- Этап 4, часть 2: получасовая сетка, статусы и история, перенос, правка РОПом, класс и квал

create extension if not exists btree_gist;

-- ===== Настройки: шаг сетки 30 мин, встреча 60 мин =====
insert into public.settings (key, value) values ('meeting_minutes', '60')
  on conflict (key) do nothing;
update public.settings set value = '30' where key = 'slot_minutes';

-- ===== Новые поля встречи =====
alter table public.bookings
  add column if not exists student_grade text,
  add column if not exists qual text,
  add column if not exists qual_after text,
  add column if not exists rescheduled_from uuid references public.bookings(id),
  add column if not exists rescheduled_to uuid references public.bookings(id);

alter table public.bookings
  add constraint bookings_qual_chk check (qual is null or qual in ('A', 'B', 'C')),
  add constraint bookings_qual_after_chk check (qual_after is null or qual_after in ('A', 'B', 'C'));

-- Пересечение по времени (а не только одинаковое начало) запрещено на уровне базы
drop index if exists public.bookings_closer_slot_uniq;
alter table public.bookings
  add constraint bookings_no_overlap exclude using gist (
    closer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelled', 'rescheduled'));

-- ===== История статусов =====
create table public.booking_status_history (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  old_status  public.booking_status,
  new_status  public.booking_status not null,
  changed_by  uuid references public.users(id),
  changed_at  timestamptz not null default now(),
  note        text
);
create index booking_status_history_booking_idx on public.booking_status_history (booking_id, changed_at);

alter table public.booking_status_history enable row level security;
create policy bsh_select on public.booking_status_history for select
  using (exists (select 1 from public.bookings b where b.id = booking_id));

create or replace function public.bookings_log_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_status_history (booking_id, old_status, new_status, changed_by, note)
    values (new.id, null, new.status, (public.current_app_user()).id,
            case when new.rescheduled_from is not null then 'Создана переносом' end);
  elsif new.status is distinct from old.status then
    insert into public.booking_status_history (booking_id, old_status, new_status, changed_by, note)
    values (new.id, old.status, new.status, (public.current_app_user()).id,
            nullif(current_setting('app.status_note', true), ''));
  end if;
  return new;
end $$;

create trigger bookings_status_history after insert or update of status on public.bookings
  for each row execute function public.bookings_log_status();

-- Уже существующие брони: стартовая запись истории
insert into public.booking_status_history (booking_id, old_status, new_status, changed_by, changed_at)
select id, null, status, hunter_id, created_at from public.bookings;

-- Слот с бронью нельзя закрыть (обновлено под новые статусы)
create or replace function public.slot_blocks_check_bookings() returns trigger
language plpgsql security definer set search_path = public as $$
declare bk record;
begin
  select b.client_name, b.starts_at into bk
  from public.bookings b
  where b.status in ('scheduled', 'confirmed')
    and b.ends_at > now()
    and (new.closer_id is null or b.closer_id = new.closer_id)
    and public.block_covers(new, b.starts_at, b.ends_at)
  order by b.starts_at
  limit 1;
  if found then
    raise exception 'BOOKING_CONFLICT:%|%', bk.client_name,
      to_char(bk.starts_at at time zone coalesce(public.setting_text('timezone'), 'Asia/Almaty'), 'DD.MM HH24:MI');
  end if;
  return new;
end $$;

-- ===== Свободен ли клоузер на интервал =====
create or replace function public.closer_is_free(p_closer uuid, s timestamptz, e timestamptz, p_ignore uuid default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = p_closer and u.is_active and 'closer' = any(u.roles))
     and not exists (
       select 1 from public.slot_blocks b
       where (b.closer_id is null or b.closer_id = p_closer) and public.block_covers(b, s, e))
     and not exists (
       select 1 from public.bookings x
       where x.closer_id = p_closer and x.status not in ('cancelled', 'rescheduled')
         and (p_ignore is null or x.id <> p_ignore)
         and x.starts_at < e and x.ends_at > s)
$$;

-- ===== Сетка: ячейка = шаг сетки; can_book = свободен на всю встречу =====
drop function if exists public.slot_availability(int);

create function public.slot_availability(p_days int default null)
returns table (
  slot_start      timestamptz,
  slot_end        timestamptz,
  closer_id       uuid,
  closer_name     text,
  block_id        uuid,
  block_kind      text,
  block_closer_id uuid,
  reason          public.block_reason,
  comment         text,
  booking_id      uuid,
  booking_hunter_id   uuid,
  booking_hunter_name text,
  can_book        boolean
)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(public.setting_text('timezone'), 'Asia/Almaty') as tz,
           public.setting_int('work_start_hour') as sh,
           public.setting_int('work_end_hour')   as eh,
           public.setting_int('slot_minutes')    as sm,
           coalesce(public.setting_int('meeting_minutes'), 60) as mm,
           coalesce(p_days, public.setting_int('booking_horizon_days')) as hd
  ),
  days as (
    select ((now() at time zone cfg.tz)::date + g) as d, cfg.*
    from cfg, generate_series(0, cfg.hd - 1) g
  ),
  slots as (
    select ((d + make_interval(mins => m)) at time zone tz)      as st,
           ((d + make_interval(mins => m + sm)) at time zone tz) as en,
           ((d + make_interval(mins => m + mm)) at time zone tz) as me
    from days, generate_series(sh * 60, eh * 60 - sm, sm) m
  ),
  closers as (
    select u.id, u.name from public.users u
    where u.is_active and 'closer' = any(u.roles)
      and (select id from public.current_app_user()) is not null
  ),
  active_bookings as (
    select x.id, x.closer_id, x.hunter_id, x.starts_at, x.ends_at, h.name as hunter_name
    from public.bookings x join public.users h on h.id = x.hunter_id
    where x.status not in ('cancelled', 'rescheduled')
      and x.ends_at > now() - interval '1 day'
  )
  select sl.st, sl.en, c.id, c.name,
         b.id, b.kind, b.closer_id, b.reason, b.comment,
         bk.id, bk.hunter_id, bk.hunter_name,
         (b2.id is null and bk2.id is null) as can_book
  from slots sl
  cross join closers c
  left join lateral (
    select * from public.slot_blocks b
    where (b.closer_id is null or b.closer_id = c.id) and public.block_covers(b, sl.st, sl.en)
    order by b.closer_id nulls first, b.created_at limit 1
  ) b on true
  left join lateral (
    select * from active_bookings x
    where x.closer_id = c.id and x.starts_at < sl.en and x.ends_at > sl.st limit 1
  ) bk on true
  left join lateral (
    select b.id from public.slot_blocks b
    where (b.closer_id is null or b.closer_id = c.id) and public.block_covers(b, sl.st, sl.me) limit 1
  ) b2 on true
  left join lateral (
    select x.id from active_bookings x
    where x.closer_id = c.id and x.starts_at < sl.me and x.ends_at > sl.st limit 1
  ) bk2 on true
  order by sl.st, c.name
$$;

-- ===== Создание брони =====
drop function if exists public.create_booking(timestamptz, public.booking_format, text, text, text, text, text, bigint, jsonb);

create function public.create_booking(
  p_start timestamptz,
  p_format public.booking_format,
  p_meeting_url text,
  p_client_name text,
  p_client_phone text,
  p_crm_url text,
  p_comment text,
  p_grade text,
  p_qual text,
  p_amo_lead_id bigint default null,
  p_amo_data jsonb default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  mm int := coalesce(public.setting_int('meeting_minutes'), 60);
  v_end timestamptz := p_start + make_interval(mins => mm);
  v_closer uuid;
  b public.bookings;
  i int;
begin
  if me.id is null or not (public.has_role('hunter') or public.has_role('rop') or public.has_role('admin')) then
    raise exception 'NO_RIGHTS';
  end if;
  if v_end <= now() then raise exception 'SLOT_PAST'; end if;
  if not exists (select 1 from public.slot_availability() a where a.slot_start = p_start) then
    raise exception 'SLOT_INVALID';
  end if;

  for i in 1..10 loop
    select a.closer_id into v_closer
    from public.slot_availability() a
    where a.slot_start = p_start and a.can_book
    order by random() limit 1;

    if v_closer is null then raise exception 'NO_FREE_CLOSER'; end if;

    begin
      insert into public.bookings
        (hunter_id, closer_id, starts_at, ends_at, format, meeting_url, address,
         client_name, client_phone, crm_url, comment, student_grade, qual, amo_lead_id, amo_data)
      values
        (me.id, v_closer, p_start, v_end, p_format,
         case when p_format = 'online' then nullif(trim(p_meeting_url), '') end,
         case when p_format = 'offline' then public.setting_text('office_address') end,
         trim(p_client_name), p_client_phone, trim(p_crm_url), nullif(trim(p_comment), ''),
         nullif(trim(p_grade), ''), nullif(p_qual, ''), p_amo_lead_id, p_amo_data)
      returning * into b;
      return b;
    exception when unique_violation or exclusion_violation then
      v_closer := null;
    end;
  end loop;
  raise exception 'NO_FREE_CLOSER';
end $$;

-- ===== Хантер правит свою бронь до начала =====
drop function if exists public.update_my_booking(uuid, text, text, text);

create function public.update_my_booking(
  p_id uuid, p_meeting_url text, p_crm_url text, p_comment text, p_grade text, p_qual text
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  b public.bookings;
begin
  select * into b from public.bookings where id = p_id for update;
  if not found or b.hunter_id <> me.id then raise exception 'NO_RIGHTS'; end if;
  if b.status not in ('scheduled', 'confirmed') or b.starts_at <= now() then raise exception 'TOO_LATE'; end if;
  if b.format = 'online' and coalesce(trim(p_meeting_url), '') = '' then raise exception 'NEED_LINK'; end if;
  if coalesce(trim(p_crm_url), '') = '' then raise exception 'NEED_CRM'; end if;

  update public.bookings
     set meeting_url = case when b.format = 'online' then trim(p_meeting_url) end,
         crm_url = trim(p_crm_url),
         comment = nullif(trim(p_comment), ''),
         student_grade = nullif(trim(p_grade), ''),
         qual = nullif(p_qual, '')
   where id = p_id
  returning * into b;
  return b;
end $$;

-- ===== Смена статуса =====
-- РОП/админ — любой (кроме «перенос», он через reschedule_booking)
-- Клоузер (свой) — проведена / не проведена / эксперт не засчитал, после начала
-- Хантер (свой) — подтверждена, до начала
create or replace function public.set_booking_status(p_id uuid, p_status public.booking_status, p_note text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  b public.bookings;
  is_rop boolean := public.has_role('rop') or public.has_role('admin');
begin
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'NO_RIGHTS'; end if;
  if p_status = 'rescheduled' then raise exception 'USE_RESCHEDULE'; end if;
  if b.status = 'rescheduled' then raise exception 'ALREADY_RESCHEDULED'; end if;

  if not is_rop then
    if b.closer_id = me.id and p_status in ('done', 'no_show', 'not_counted') then
      if b.starts_at > now() then raise exception 'NOT_STARTED'; end if;
    elsif b.hunter_id = me.id and p_status in ('confirmed', 'scheduled') then
      if b.starts_at <= now() then raise exception 'TOO_LATE'; end if;
    else
      raise exception 'NO_RIGHTS';
    end if;
  end if;

  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.bookings set status = p_status where id = p_id returning * into b;
  return b;
exception when exclusion_violation then
  raise exception 'SLOT_TAKEN';
end $$;

-- ===== Квал после встречи (клоузер своей встречи или РОП) =====
create or replace function public.set_qual_after(p_id uuid, p_qual text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.users := public.current_app_user();
begin
  update public.bookings set qual_after = nullif(p_qual, '')
  where id = p_id
    and (closer_id = me.id or public.has_role('rop') or public.has_role('admin'));
  if not found then raise exception 'NO_RIGHTS'; end if;
end $$;

-- ===== Перенос: старая → «перенос», новая бронь на выбранное время =====
-- Хантер — свою, РОП/админ — любую. Клоузер остаётся тот же, если свободен (или РОП выбирает сам)
create or replace function public.reschedule_booking(p_id uuid, p_new_start timestamptz, p_closer uuid default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  is_rop boolean := public.has_role('rop') or public.has_role('admin');
  old public.bookings;
  nb public.bookings;
  mm int := coalesce(public.setting_int('meeting_minutes'), 60);
  v_end timestamptz := p_new_start + make_interval(mins => mm);
  v_closer uuid;
begin
  select * into old from public.bookings where id = p_id for update;
  if not found then raise exception 'NO_RIGHTS'; end if;
  if not (is_rop or old.hunter_id = me.id) then raise exception 'NO_RIGHTS'; end if;
  if old.status not in ('scheduled', 'confirmed', 'no_show') then raise exception 'CANT_RESCHEDULE'; end if;
  if p_closer is not null and not is_rop then raise exception 'NO_RIGHTS'; end if;
  if v_end <= now() then raise exception 'SLOT_PAST'; end if;
  if not exists (select 1 from public.slot_availability() a where a.slot_start = p_new_start) then
    raise exception 'SLOT_INVALID';
  end if;

  -- освобождаем старое время
  perform set_config('app.status_note', 'Перенос', true);
  update public.bookings set status = 'rescheduled' where id = p_id;

  if p_closer is not null then
    if not public.closer_is_free(p_closer, p_new_start, v_end) then raise exception 'CLOSER_BUSY'; end if;
    v_closer := p_closer;
  elsif public.closer_is_free(old.closer_id, p_new_start, v_end) then
    v_closer := old.closer_id;
  else
    select a.closer_id into v_closer from public.slot_availability() a
    where a.slot_start = p_new_start and a.can_book order by random() limit 1;
    if v_closer is null then raise exception 'NO_FREE_CLOSER'; end if;
  end if;

  insert into public.bookings
    (hunter_id, closer_id, starts_at, ends_at, format, meeting_url, address, client_name, client_phone,
     crm_url, comment, student_grade, qual, amo_lead_id, amo_data, rescheduled_from)
  values
    (old.hunter_id, v_closer, p_new_start, v_end, old.format, old.meeting_url, old.address, old.client_name,
     old.client_phone, old.crm_url, old.comment, old.student_grade, old.qual, old.amo_lead_id, old.amo_data, old.id)
  returning * into nb;

  update public.bookings set rescheduled_to = nb.id where id = p_id;
  return nb;
exception when exclusion_violation or unique_violation then
  raise exception 'CLOSER_BUSY';
end $$;

-- ===== РОП/админ редактирует карточку, в т.ч. меняет клоузера =====
create or replace function public.rop_update_booking(
  p_id uuid, p_closer uuid, p_client_name text, p_client_phone text, p_crm_url text,
  p_format public.booking_format, p_meeting_url text, p_comment text, p_grade text, p_qual text
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  if not (public.has_role('rop') or public.has_role('admin')) then raise exception 'NO_RIGHTS'; end if;
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'NO_RIGHTS'; end if;
  if p_format = 'online' and coalesce(trim(p_meeting_url), '') = '' then raise exception 'NEED_LINK'; end if;

  if p_closer <> b.closer_id and b.status not in ('cancelled', 'rescheduled') then
    if not public.closer_is_free(p_closer, b.starts_at, b.ends_at, b.id) then raise exception 'CLOSER_BUSY'; end if;
  end if;

  update public.bookings set
    closer_id = p_closer,
    client_name = trim(p_client_name),
    client_phone = p_client_phone,
    crm_url = trim(p_crm_url),
    format = p_format,
    meeting_url = case when p_format = 'online' then trim(p_meeting_url) end,
    address = case when p_format = 'offline' then coalesce(b.address, public.setting_text('office_address')) end,
    comment = nullif(trim(p_comment), ''),
    student_grade = nullif(trim(p_grade), ''),
    qual = nullif(p_qual, '')
  where id = p_id
  returning * into b;
  return b;
exception when exclusion_violation then
  raise exception 'CLOSER_BUSY';
end $$;

-- Свободные клоузеры на время конкретной брони (для выбора РОПом)
create or replace function public.free_closers_for(p_id uuid)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.name from public.users u, public.bookings b
  where b.id = p_id and (public.has_role('rop') or public.has_role('admin'))
    and u.is_active and 'closer' = any(u.roles)
    and (u.id = b.closer_id or public.closer_is_free(u.id, b.starts_at, b.ends_at, b.id))
  order by u.name
$$;
