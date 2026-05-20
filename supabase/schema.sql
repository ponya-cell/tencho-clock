create extension if not exists "pgcrypto";
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'manager' check (role in ('admin', 'manager')),
  store_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  store_name text,
  clock_in timestamptz,
  clock_out timestamptz,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create index if not exists attendance_records_work_date_idx
  on public.attendance_records (work_date);

create index if not exists attendance_records_user_month_idx
  on public.attendance_records (user_id, work_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_attendance_records_updated_at on public.attendance_records;
create trigger set_attendance_records_updated_at
before update on public.attendance_records
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.attendance_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert on public.profiles to authenticated;
grant select, insert, update on public.attendance_records to authenticated;

create or replace function private.is_admin(check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and role = 'admin'
  );
$$;

grant execute on function private.is_admin(uuid) to authenticated;

drop policy if exists "profiles_self_or_admin_select" on public.profiles;
drop policy if exists "profiles_self_insert" on public.profiles;
drop policy if exists "attendance_self_or_admin_select" on public.attendance_records;
drop policy if exists "attendance_self_insert" on public.attendance_records;
drop policy if exists "attendance_self_update" on public.attendance_records;

create policy "profiles_self_or_admin_select"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or private.is_admin(auth.uid())
);

create policy "profiles_self_insert"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and role = 'manager'
);

create policy "attendance_self_or_admin_select"
on public.attendance_records
for select
to authenticated
using (
  user_id = auth.uid()
  or private.is_admin(auth.uid())
);

create policy "attendance_self_insert"
on public.attendance_records
for insert
to authenticated
with check (user_id = auth.uid());

create policy "attendance_self_update"
on public.attendance_records
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
