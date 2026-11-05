-- Этап 2: закрытие слотов и сетка свободных окон

-- ===== Настройки: удобные геттеры =====
create or replace function public.setting_text(k text) returns text
language sql stable security definer set search_path = public as $$
  select value #>> '{}' from public.settings where key = k
$$;

create or replace function public.setting_int(k text) returns int
language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::int from public.settings where key = k
$$;

-- ===== Закрытия слотов =====
create type public.block_reason as enum
  ('lunch', 'sick', 'vacation', 'day_off', 'followup', 'training', 'other');

create table public.slot_blocks (
  id          uuid primary key default gen_random_uuid(),
  closer_id   uuid references public.users(id) on delete cascade, -- null = все клоузеры
  kind        text not null check (kind in ('once', 'recurring')),
  -- разово / диапазон
  starts_at   timestamptz,
  ends_at     timestamptz,
  -- повтор
  weekdays    smallint[],          -- ISO: 1 = пн … 7 = вс
  start_time  time,
  end_time    time,
  valid_from  date,
  valid_until date,
  reason      public.block_reason not null,
  comment     text,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  constraint slot_blocks_shape check (
    (kind = 'once' and starts_at is not null and ends_at > starts_at)
    or (kind = 'recurring' and coalesce(array_length(weekdays, 1), 0) > 0
        and end_time > start_time and valid_from is not null)
  ),
  constraint slot_blocks_other_comment check (
    reason <> 'other' or coalesce(trim(comment), '') <> ''
  )
);

create index slot_blocks_closer_idx on public.slot_blocks (closer_id);
create index slot_blocks_once_idx on public.slot_blocks (starts_at, ends_at) where kind = 'once';

create or replace function public.slot_blocks_set_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := (public.current_app_user()).id;
  return new;
end $$;

create trigger slot_blocks_creator before insert on public.slot_blocks
  for each row execute function public.slot_blocks_set_creator();

-- Перекрывает ли закрытие интервал [s, e)
create or replace function public.block_covers(b public.slot_blocks, s timestamptz, e timestamptz)
returns boolean
language plpgsql stable set search_path = public as $$
declare
  tz text := coalesce(public.setting_text('timezone'), 'Asia/Almaty');
  ls timestamp := s at time zone tz;
  le timestamp := e at time zone tz;
  le_time time;
begin
  if b.kind = 'once' then
    return b.starts_at < e and b.ends_at > s;
  end if;
  if not (extract(isodow from ls)::smallint = any(b.weekdays)) then return false; end if;
  if ls::date < b.valid_from then return false; end if;
  if b.valid_until is not null and ls::date > b.valid_until then return false; end if;
  le_time := case when le::date > ls::date then time '24:00' else le::time end;
  return b.start_time < le_time and b.end_time > ls::time;
end $$;

-- Может ли текущий пользователь управлять расписанием клоузера (null = все)
create or replace function public.can_manage_schedule(p_closer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin') or public.has_role('rop')
      or (p_closer is not null and p_closer = (public.current_app_user()).id
          and public.has_role('closer'))
$$;

alter table public.slot_blocks enable row level security;

create policy slot_blocks_select on public.slot_blocks for select
  using ((select id from public.current_app_user()) is not null);
create policy slot_blocks_insert on public.slot_blocks for insert
  with check (public.can_manage_schedule(closer_id));
create policy slot_blocks_delete on public.slot_blocks for delete
  using (public.can_manage_schedule(closer_id));

-- ===== Сетка: каждый слот × каждый активный клоузер =====
create or replace function public.slot_availability(p_days int default null)
returns table (
  slot_start  timestamptz,
  slot_end    timestamptz,
  closer_id   uuid,
  block_id    uuid,
  block_kind  text,
  block_closer_id uuid,
  reason      public.block_reason,
  comment     text
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
  select sl.st, sl.en, u.id, b.id, b.kind, b.closer_id, b.reason, b.comment
  from slots sl
  cross join public.users u
  left join lateral (
    select * from public.slot_blocks b
    where (b.closer_id is null or b.closer_id = u.id)
      and public.block_covers(b, sl.st, sl.en)
    order by b.closer_id nulls first, b.created_at
    limit 1
  ) b on true
  where u.is_active
    and 'closer' = any(u.roles)
    and (select id from public.current_app_user()) is not null
  order by sl.st, u.name
$$;

-- ===== Создание закрытий (RLS проверяет права) =====

-- Один или несколько слотов в конкретный день; соседние часы склеиваются
create or replace function public.close_slots(
  p_closer uuid, p_date date, p_start_minutes int[],
  p_reason public.block_reason, p_comment text default null
) returns int
language plpgsql set search_path = public as $$
declare
  tz text := coalesce(public.setting_text('timezone'), 'Asia/Almaty');
  sm int := public.setting_int('slot_minutes');
  m int; run_start int := null; run_end int := null; n int := 0;
begin
  for m in select distinct x from unnest(p_start_minutes) x order by x loop
    if run_start is null then
      run_start := m; run_end := m + sm;
    elsif m = run_end then
      run_end := m + sm;
    else
      insert into public.slot_blocks (closer_id, kind, starts_at, ends_at, reason, comment)
      values (p_closer, 'once',
              (p_date + make_interval(mins => run_start)) at time zone tz,
              (p_date + make_interval(mins => run_end)) at time zone tz,
              p_reason, nullif(trim(p_comment), ''));
      n := n + 1; run_start := m; run_end := m + sm;
    end if;
  end loop;
  if run_start is not null then
    insert into public.slot_blocks (closer_id, kind, starts_at, ends_at, reason, comment)
    values (p_closer, 'once',
            (p_date + make_interval(mins => run_start)) at time zone tz,
            (p_date + make_interval(mins => run_end)) at time zone tz,
            p_reason, nullif(trim(p_comment), ''));
    n := n + 1;
  end if;
  return n;
end $$;

-- Диапазон дат целиком (отпуск, больничный)
create or replace function public.close_range(
  p_closer uuid, p_from date, p_to date,
  p_reason public.block_reason, p_comment text default null
) returns uuid
language plpgsql set search_path = public as $$
declare
  tz text := coalesce(public.setting_text('timezone'), 'Asia/Almaty');
  new_id uuid;
begin
  if p_to < p_from then raise exception 'Дата окончания раньше начала'; end if;
  insert into public.slot_blocks (closer_id, kind, starts_at, ends_at, reason, comment)
  values (p_closer, 'once', p_from::timestamp at time zone tz,
          (p_to + 1)::timestamp at time zone tz, p_reason, nullif(trim(p_comment), ''))
  returning id into new_id;
  return new_id;
end $$;

-- Повторяющееся закрытие (обед каждый день, выходной по субботам)
create or replace function public.close_recurring(
  p_closer uuid, p_weekdays smallint[], p_start time, p_end time,
  p_from date, p_until date,
  p_reason public.block_reason, p_comment text default null
) returns uuid
language plpgsql set search_path = public as $$
declare new_id uuid;
begin
  insert into public.slot_blocks
    (closer_id, kind, weekdays, start_time, end_time, valid_from, valid_until, reason, comment)
  values (p_closer, 'recurring', p_weekdays, p_start, p_end, p_from, p_until,
          p_reason, nullif(trim(p_comment), ''))
  returning id into new_id;
  return new_id;
end $$;
