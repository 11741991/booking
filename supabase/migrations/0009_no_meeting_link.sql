-- Поле «Ссылка на встречу» убрано из букинга: ссылка больше не обязательна для онлайн-встреч.
-- Уже сохранённые ссылки остаются.
alter table public.bookings drop constraint if exists bookings_online_link;

create or replace function public.update_my_booking(
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
  if coalesce(trim(p_crm_url), '') = '' then raise exception 'NEED_CRM'; end if;

  update public.bookings
     set meeting_url = coalesce(nullif(trim(p_meeting_url), ''), meeting_url),
         crm_url = trim(p_crm_url),
         comment = nullif(trim(p_comment), ''),
         student_grade = nullif(trim(p_grade), ''),
         qual = nullif(p_qual, '')
   where id = p_id
  returning * into b;
  return b;
end $$;

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

  if p_closer <> b.closer_id and b.status not in ('cancelled', 'rescheduled') and b.deleted_at is null then
    if not public.closer_is_free(p_closer, b.starts_at, b.ends_at, b.id) then raise exception 'CLOSER_BUSY'; end if;
  end if;

  update public.bookings set
    closer_id = p_closer,
    client_name = trim(p_client_name),
    client_phone = p_client_phone,
    crm_url = trim(p_crm_url),
    format = p_format,
    meeting_url = coalesce(nullif(trim(p_meeting_url), ''), meeting_url),
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

notify pgrst, 'reload schema';
