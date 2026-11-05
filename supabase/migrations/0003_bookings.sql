-- Этап 3: бронирование. Плюс правки этапа 2 (причина «Своя встреча»)

alter type public.block_reason add value if not exists 'own_meeting' after 'followup';

create type public.booking_format as enum ('online', 'offline');
create type public.booking_status as enum ('scheduled', 'done', 'no_show', 'cancelled');

create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  hunter_id     uuid not null references public.users(id),
  closer_id     uuid not null references public.users(id),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  format        public.booking_format not null,
  meeting_url   text,
  address       text,
  client_name   text not null,
  client_phone  text not null,
  crm_url       text not null,
  comment       text,
  status        public.booking_status not null default 'scheduled',
  google_event_id text,
  amo_lead_id   bigint,
  amo_data      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint bookings_time check (ends_at > starts_at),
  constraint bookings_online_link check (format = 'offline' or coalesce(trim(meeting_url), '') <> '')
);

-- Главная защита: у клоузера не может быть двух активных броней на одно время
create unique index bookings_closer_slot_uniq
  on public.bookings (closer_id, starts_at) where status <> 'cancelled';
create index bookings_hunter_idx on public.bookings (hunter_id, starts_at);
create index bookings_starts_idx on public.bookings (starts_at);

create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

alter table public.bookings enable row level security;

-- Видимость: РОП/админ — всё; хантер — свои; клоузер — свои
create policy bookings_select on public.bookings for select using (
  public.has_role('rop') or public.has_role('admin')
  or hunter_id = (public.current_app_user()).id
  or closer_id = (public.current_app_user()).id
);
-- Вставка и изменения — только через функции ниже (security definer)

-- ===== Нельзя закрыть слот поверх активной брони =====
create or replace function public.slot_blocks_check_bookings() returns trigger
language plpgsql security definer set search_path = public as $$
declare bk record;
begin
  select b.client_name, b.starts_at into bk
  from public.bookings b
  where b.status = 'scheduled'
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

create trigger slot_blocks_no_booking before insert on public.slot_blocks
  for each row execute function public.slot_blocks_check_bookings();

-- ===== Сетка: теперь с бронями и именами =====
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
  booking_hunter_name text
)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(public.setting_text('timezone'), 'Asia/Almaty') as tz,
           public.setting_int('work_start_hour') as sh,
           public.setting_int('work_end_hour')   as eh,
           public.setting_int('slot_minutes')    as sm,
           coalesce(p_days, public.setting_int('booking_horizon_days')) as hd
  ),
  days as (
    select ((now() at time zone cfg.tz)::date + g) as d, cfg.*
    from cfg, generate_series(0, cfg.hd - 1) g
  ),
  slots as (
    select ((d + make_interval(mins => m)) at time zone tz)      as st,
           ((d + make_interval(mins => m + sm)) at time zone tz) as en
    from days, generate_series(sh * 60, eh * 60 - sm, sm) m
  )
  select sl.st, sl.en, u.id, u.name,
         b.id, b.kind, b.closer_id, b.reason, b.comment,
         bk.id, bk.hunter_id, bk.hunter_name
  from slots sl
  cross join public.users u
  left join lateral (
    select * from public.slot_blocks b
    where (b.closer_id is null or b.closer_id = u.id)
      and public.block_covers(b, sl.st, sl.en)
    order by b.closer_id nulls first, b.created_at
    limit 1
  ) b on true
  left join lateral (
    select x.id, x.hunter_id, h.name as hunter_name
    from public.bookings x join public.users h on h.id = x.hunter_id
    where x.closer_id = u.id and x.status <> 'cancelled'
      and x.starts_at < sl.en and x.ends_at > sl.st
    limit 1
  ) bk on true
  where u.is_active
    and 'closer' = any(u.roles)
    and (select id from public.current_app_user()) is not null
  order by sl.st, u.name
$$;

-- ===== Создание брони: случайный свободный клоузер =====
create or replace function public.create_booking(
  p_start timestamptz,
  p_format public.booking_format,
  p_meeting_url text,
  p_client_name text,
  p_client_phone text,
  p_crm_url text,
  p_comment text default null,
  p_amo_lead_id bigint default null,
  p_amo_data jsonb default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  sm int := public.setting_int('slot_minutes');
  v_end timestamptz := p_start + make_interval(mins => sm);
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
    where a.slot_start = p_start and a.block_id is null and a.booking_id is null
    order by random()
    limit 1;

    if v_closer is null then raise exception 'NO_FREE_CLOSER'; end if;

    begin
      insert into public.bookings
        (hunter_id, closer_id, starts_at, ends_at, format, meeting_url, address,
         client_name, client_phone, crm_url, comment, amo_lead_id, amo_data)
      values
        (me.id, v_closer, p_start, v_end, p_format,
         case when p_format = 'online' then nullif(trim(p_meeting_url), '') end,
         case when p_format = 'offline' then public.setting_text('office_address') end,
         trim(p_client_name), p_client_phone, trim(p_crm_url), nullif(trim(p_comment), ''),
         p_amo_lead_id, p_amo_data)
      returning * into b;
      return b;
    exception when unique_violation then
      v_closer := null; -- слот только что заняли — пробуем другого клоузера
    end;
  end loop;
  raise exception 'NO_FREE_CLOSER';
end $$;

-- ===== Хантер правит свою бронь до начала встречи =====
create or replace function public.update_my_booking(
  p_id uuid, p_meeting_url text, p_crm_url text, p_comment text
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  b public.bookings;
begin
  select * into b from public.bookings where id = p_id for update;
  if not found or b.hunter_id <> me.id then raise exception 'NO_RIGHTS'; end if;
  if b.status <> 'scheduled' or b.starts_at <= now() then raise exception 'TOO_LATE'; end if;
  if b.format = 'online' and coalesce(trim(p_meeting_url), '') = '' then raise exception 'NEED_LINK'; end if;
  if coalesce(trim(p_crm_url), '') = '' then raise exception 'NEED_CRM'; end if;

  update public.bookings
     set meeting_url = case when b.format = 'online' then trim(p_meeting_url) end,
         crm_url = trim(p_crm_url),
         comment = nullif(trim(p_comment), '')
   where id = p_id
  returning * into b;
  return b;
end $$;

-- Обновление снимка данных из amoCRM (любой, кто видит бронь)
create or replace function public.set_booking_amo(p_id uuid, p_lead_id bigint, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare me public.users := public.current_app_user();
begin
  update public.bookings set amo_lead_id = p_lead_id, amo_data = p_data
  where id = p_id
    and (public.has_role('rop') or public.has_role('admin')
         or hunter_id = me.id or closer_id = me.id);
end $$;
