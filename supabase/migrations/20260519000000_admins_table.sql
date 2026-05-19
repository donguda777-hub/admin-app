-- admin-app: 관리자 로그인 (public.admins)
-- Supabase Dashboard / CLI 로 적용

create table if not exists public.admins (
  login_id text primary key,
  password text not null,
  display_name text not null default '',
  role text not null default 'AMOUNT_ADMIN'
    check (role in ('AMOUNT_ADMIN', 'BASIC_ADMIN')),
  is_master boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_admins_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists admins_set_updated_at on public.admins;

create trigger admins_set_updated_at
  before update on public.admins
  for each row
  execute function public.set_admins_updated_at();

alter table public.admins enable row level security;

drop policy if exists "admins_select" on public.admins;
drop policy if exists "admins_insert" on public.admins;
drop policy if exists "admins_update" on public.admins;
drop policy if exists "admins_delete" on public.admins;

create policy "admins_select"
  on public.admins
  for select
  to anon, authenticated
  using (true);

create policy "admins_insert"
  on public.admins
  for insert
  to anon, authenticated
  with check (is_master = false);

create policy "admins_update"
  on public.admins
  for update
  to anon, authenticated
  using (is_master = false)
  with check (is_master = false);

create policy "admins_delete"
  on public.admins
  for delete
  to anon, authenticated
  using (is_master = false);

insert into public.admins (login_id, password, display_name, role, is_master)
values ('donguda', 'lee21400**', 'donguda', 'AMOUNT_ADMIN', true)
on conflict (login_id) do update
  set
    password = excluded.password,
    display_name = excluded.display_name,
    is_master = true,
    updated_at = now();
