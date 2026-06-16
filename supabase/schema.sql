create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'contributor' check (role in ('contributor', 'reviewer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  era text default '',
  roles text[] not null default '{}',
  location text default '',
  tags text[] not null default '{}',
  summary text default '',
  biography text not null,
  source text default '',
  image text default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.people enable row level security;

create or replace function public.current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'visitor');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'contributor')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists people_set_updated_at on public.people;
create trigger people_set_updated_at
  before update on public.people
  for each row execute procedure public.set_updated_at();

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
using (id = auth.uid() or public.current_role() = 'admin');

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles
for update
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

drop policy if exists "people_select_public_own_or_reviewer" on public.people;
create policy "people_select_public_own_or_reviewer"
on public.people
for select
using (
  status = 'approved'
  or created_by = auth.uid()
  or public.current_role() in ('reviewer', 'admin')
);

drop policy if exists "people_insert_authenticated_pending" on public.people;
create policy "people_insert_authenticated_pending"
on public.people
for insert
to authenticated
with check (created_by = auth.uid() and status = 'pending');

drop policy if exists "people_update_own_pending" on public.people;
create policy "people_update_own_pending"
on public.people
for update
to authenticated
using (created_by = auth.uid() and status = 'pending')
with check (created_by = auth.uid() and status = 'pending');

drop policy if exists "people_update_reviewer" on public.people;
create policy "people_update_reviewer"
on public.people
for update
to authenticated
using (public.current_role() in ('reviewer', 'admin'))
with check (public.current_role() in ('reviewer', 'admin'));

drop policy if exists "people_delete_own_pending" on public.people;
create policy "people_delete_own_pending"
on public.people
for delete
to authenticated
using (created_by = auth.uid() and status = 'pending');

drop policy if exists "people_delete_reviewer" on public.people;
create policy "people_delete_reviewer"
on public.people
for delete
to authenticated
using (public.current_role() in ('reviewer', 'admin'));

-- After your own account signs in once, run one of these manually:
-- update public.profiles set role = 'admin' where email = 'you@example.com';
-- update public.profiles set role = 'reviewer' where email = 'friend@example.com';
