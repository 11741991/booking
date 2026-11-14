-- Корзина: РОП/админ убирает встречу — она исчезает из статистики, списков и освобождает слот. Можно восстановить

alter table public.bookings
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id);

-- Удалённые встречи не занимают время клоузера
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap exclude using gist (
    closer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelled', 'rescheduled') and deleted_at is null);

-- Корзину видят только РОП и админ
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select using (
  public.has_role('rop') or public.has_role('admin')
  or (deleted_at is null and (hunter_id = (public.current_app_user()).id
                              or closer_id = (public.current_app_user()).id))
);

create or replace function public.trash_booking(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role('rop') or public.has_role('admin')) then raise exception 'NO_RIGHTS'; end if;
  update public.bookings
     set deleted_at = now(), deleted_by = (public.current_app_user()).id
   where id = p_id and deleted_at is null;
end $$;

create or replace function public.restore_booking(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role('rop') or public.has_role('admin')) then raise exception 'NO_RIGHTS'; end if;
  update public.bookings set deleted_at = null, deleted_by = null where id = p_id;
exception when exclusion_violation then
  raise exception 'RESTORE_BUSY';
end $$;

-- Проверки занятости: без удалённых
create or replace function public.slot_blocks_check_bookings() returns trigger
language plpgsql security definer set search_path = public as $$
declare bk record;
begin
  select b.client_name, b.starts_at into bk
  from public.bookings b
  where b.status in ('scheduled', 'confirmed')
    and b.deleted_at is null
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
         and x.deleted_at is null
         and (p_ignore is null or x.id <> p_ignore)
         and x.starts_at < e and x.ends_at > s)
$$;

-- Сетка: без удалённых встреч
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
           greatest(1, coalesce(public.setting_int('meeting_minutes'), 60) / public.setting_int('slot_minutes')) as n,
           coalesce(p_days, public.setting_int('booking_horizon_days')) as hd
  ),
  days as (
    select ((now() at time zone cfg.tz)::date + g) as d, cfg.*
    from cfg, generate_series(0, cfg.hd - 1) g
  ),
  slots as (
    select d, n,
           ((d + make_interval(mins => m)) at time zone tz)      as st,
           ((d + make_interval(mins => m + sm)) at time zone tz) as en
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
      and x.deleted_at is null
      and x.ends_at > now() - interval '1 day'
  ),
  cells as (
    select sl.d, sl.n, sl.st, sl.en, c.id as cid, c.name as cname,
           b.id as bid, b.kind as bkind, b.closer_id as bcloser, b.reason as breason, b.comment as bcomment,
           bk.id as bkid, bk.hunter_id as bkh, bk.hunter_name as bkhn,
           (b.id is null and bk.id is null) as free
    from slots sl
    cross join closers c
    left join lateral (
      select * from public.slot_blocks b
      where (b.closer_id is null or b.closer_id = c.id)
        and (b.kind = 'recurring' or (b.starts_at < sl.en and b.ends_at > sl.st))
        and public.block_covers(b, sl.st, sl.en)
      order by b.closer_id nulls first, b.created_at limit 1
    ) b on true
    left join lateral (
      select * from active_bookings x
      where x.closer_id = c.id and x.starts_at < sl.en and x.ends_at > sl.st limit 1
    ) bk on true
  )
  select cl.st, cl.en, cl.cid, cl.cname,
         cl.bid, cl.bkind, cl.bcloser, cl.breason, cl.bcomment,
         cl.bkid, cl.bkh, cl.bkhn,
         (cl.free
           and (cl.n < 2 or coalesce(lead(cl.free, 1) over w, true))
           and (cl.n < 3 or coalesce(lead(cl.free, 2) over w, true))
           and (cl.n < 4 or coalesce(lead(cl.free, 3) over w, true))
           and (cl.n < 5 or coalesce(lead(cl.free, 4) over w, true))
           and (cl.n < 6 or coalesce(lead(cl.free, 5) over w, true))
           and (cl.n < 7 or coalesce(lead(cl.free, 6) over w, true))
           and (cl.n < 8 or coalesce(lead(cl.free, 7) over w, true))
         ) as can_book
  from cells cl
  window w as (partition by cl.cid, cl.d order by cl.st)
  order by cl.st, cl.cname
$$;

notify pgrst, 'reload schema';
