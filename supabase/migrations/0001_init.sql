-- Этап 1: пользователи, роли, настройки
-- Время храним в UTC (timestamptz), показываем в GMT+5 (Asia/Almaty)

create type public.user_role as enum ('hunter', 'closer', 'admin', 'rop');

-- Сотрудники. Доступ в систему есть только у e-mail из этой таблицы (is_active = true)
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  email         text not null unique,
  name          text not null,
  roles         public.user_role[] not null default '{}',
  is_active     boolean not null default true,
  -- для клоузеров (этап 5-6)
  google_refresh_token text,
  google_calendar_id   text,
  google_channel_id    text,
  google_channel_expires_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index users_email_lower_idx on public.users (lower(email));

-- Глобальные настройки (ключ → значение)
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('timezone',           '"Asia/Almaty"'),
  ('work_start_hour',    '12'),
  ('work_end_hour',      '21'),
  ('slot_minutes',       '60'),
  ('booking_horizon_days','7'),
  ('office_address',     '"Шевченко 165Б, 9 этаж"');

-- updated_at автоматически
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ===== Вспомогательные функции для RLS =====

-- Текущий сотрудник (по auth.uid() или по e-mail из JWT, если ещё не привязан)
create or replace function public.current_app_user()
returns public.users
language sql stable security definer set search_path = public as $$
  select u.* from public.users u
  where u.is_active
    and (u.auth_user_id = auth.uid()
         or (u.auth_user_id is null and lower(u.email) = lower(auth.jwt() ->> 'email')))
  limit 1
$$;

create or replace function public.has_role(r public.user_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(r = any((select roles from public.current_app_user())), false)
$$;

-- Привязка auth-пользователя к сотруднику при первом входе
create or replace function public.link_auth_user()
returns public.users
language plpgsql security definer set search_path = public as $$
declare
  u public.users;
begin
  update public.users
     set auth_user_id = auth.uid()
   where auth_user_id is null
     and is_active
     and lower(email) = lower(auth.jwt() ->> 'email')
  returning * into u;
  if u.id is null then
    select * into u from public.users where auth_user_id = auth.uid() and is_active;
  end if;
  return u;
end $$;

-- ===== RLS =====
alter table public.users enable row level security;
alter table public.settings enable row level security;

-- users: все активные сотрудники видят список (нужно для сетки/подбора), пишет только админ
create policy users_select on public.users for select
  using ((select id from public.current_app_user()) is not null);
create policy users_admin_insert on public.users for insert
  with check (public.has_role('admin'));
create policy users_admin_update on public.users for update
  using (public.has_role('admin'));

-- settings: читают все, меняет админ
create policy settings_select on public.settings for select
  using ((select id from public.current_app_user()) is not null);
create policy settings_admin_update on public.settings for update
  using (public.has_role('admin'));
create policy settings_admin_insert on public.settings for insert
  with check (public.has_role('admin'));

-- Первый админ (замени e-mail при необходимости)
insert into public.users (email, name, roles) values
  ('speedhackqq@gmail.com', 'Илияс', '{admin,rop}');
