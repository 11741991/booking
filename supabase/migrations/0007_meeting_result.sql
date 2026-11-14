-- Итог встречи: обязательный квал после встречи, примечание, отметка о передаче в amoCRM

alter table public.bookings
  add column if not exists note_after text,
  add column if not exists amo_sync jsonb;

-- ===== Смена статуса =====
-- «Проведена» и «Эксперт не засчитал» — обязателен квал после встречи
-- «Эксперт не засчитал» — обязательно примечание
drop function if exists public.set_booking_status(uuid, public.booking_status, text);

create function public.set_booking_status(
  p_id uuid,
  p_status public.booking_status,
  p_note text default null,
  p_qual_after text default null,
  p_note_after text default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  b public.bookings;
  is_rop boolean := public.has_role('rop') or public.has_role('admin');
  v_qual text;
  v_note text;
  is_result boolean := p_status in ('done', 'no_show', 'not_counted');
begin
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'NO_RIGHTS'; end if;
  if p_status = 'rescheduled' then raise exception 'USE_RESCHEDULE'; end if;
  if b.status = 'rescheduled' then raise exception 'ALREADY_RESCHEDULED'; end if;

  if not is_rop then
    if b.closer_id = me.id and is_result then
      if b.starts_at > now() then raise exception 'NOT_STARTED'; end if;
    elsif b.hunter_id = me.id and p_status in ('confirmed', 'scheduled') then
      if b.starts_at <= now() then raise exception 'TOO_LATE'; end if;
    else
      raise exception 'NO_RIGHTS';
    end if;
  end if;

  v_qual := coalesce(nullif(p_qual_after, ''), b.qual_after);
  v_note := coalesce(nullif(trim(p_note_after), ''), b.note_after);
  if is_result then
    if v_qual is not null and v_qual not in ('A', 'B', 'C') then raise exception 'NEED_QUAL_AFTER'; end if;
    if p_status in ('done', 'not_counted') and v_qual is null then raise exception 'NEED_QUAL_AFTER'; end if;
    if p_status = 'not_counted' and v_note is null then raise exception 'NEED_NOTE_AFTER'; end if;
  end if;

  perform set_config('app.status_note',
    coalesce(nullif(trim(p_note), ''), case when is_result then nullif(trim(p_note_after), '') end, ''), true);

  update public.bookings
     set status = p_status,
         qual_after = case when is_result then v_qual else qual_after end,
         note_after = case when is_result then v_note else note_after end
   where id = p_id
  returning * into b;
  return b;
exception when exclusion_violation then
  raise exception 'SLOT_TAKEN';
end $$;

-- ===== Правка итога (квал после встречи + примечание) без смены статуса =====
drop function if exists public.set_qual_after(uuid, text);

create or replace function public.set_meeting_result(p_id uuid, p_qual text, p_note text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me public.users := public.current_app_user();
  b public.bookings;
  v_qual text := nullif(p_qual, '');
  v_note text := nullif(trim(p_note), '');
begin
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'NO_RIGHTS'; end if;
  if not (b.closer_id = me.id or public.has_role('rop') or public.has_role('admin')) then
    raise exception 'NO_RIGHTS';
  end if;
  if v_qual is not null and v_qual not in ('A', 'B', 'C') then raise exception 'NEED_QUAL_AFTER'; end if;
  if b.status in ('done', 'not_counted') and v_qual is null then raise exception 'NEED_QUAL_AFTER'; end if;
  if b.status = 'not_counted' and v_note is null then raise exception 'NEED_NOTE_AFTER'; end if;

  update public.bookings set qual_after = v_qual, note_after = v_note where id = p_id returning * into b;
  return b;
end $$;

-- ===== Отметка о передаче в amoCRM =====
create or replace function public.set_booking_amo_sync(p_id uuid, p_sync jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me public.users := public.current_app_user();
begin
  update public.bookings set amo_sync = p_sync
  where id = p_id
    and (public.has_role('rop') or public.has_role('admin') or hunter_id = me.id or closer_id = me.id);
end $$;
