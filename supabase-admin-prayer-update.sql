-- Run once in Supabase SQL Editor for an existing LINK PRAY project.
-- Uses public.profiles.role as the single source of truth for admin access.

create or replace function public.is_pray_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_pray_admin() to authenticated;

-- Fix profile RLS so an admin set through profiles.role is recognized,
-- and so admins can read member names for the admin-only prayer list.
drop policy if exists "profile owner update" on public.profiles;
create policy "profile owner update" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and (role = 'member' or public.is_pray_admin()));
drop policy if exists "profile admin read" on public.profiles;
create policy "profile admin read" on public.profiles
  for select to authenticated using (public.is_pray_admin());

-- Replace the JWT-only rule that caused the row-level security error.
drop policy if exists "room settings admin write" on public.room_settings;
create policy "room settings admin write" on public.room_settings
  for all to authenticated
  using (public.is_pray_admin())
  with check (public.is_pray_admin());

-- Keep a cumulative history of every posted shared prayer topic.
create table if not exists public.room_prayer_topics (
  id uuid primary key default gen_random_uuid(),
  content text not null check (length(content) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.room_prayer_topics enable row level security;
grant select, insert, update, delete on public.room_prayer_topics to authenticated;
drop policy if exists "room prayer topics admin read" on public.room_prayer_topics;
create policy "room prayer topics admin read" on public.room_prayer_topics
  for select to authenticated using (public.is_pray_admin());
drop policy if exists "room prayer topics admin insert" on public.room_prayer_topics;
create policy "room prayer topics admin insert" on public.room_prayer_topics
  for insert to authenticated
  with check (public.is_pray_admin() and created_by = auth.uid());
drop policy if exists "room prayer topics admin update" on public.room_prayer_topics;
create policy "room prayer topics admin update" on public.room_prayer_topics
  for update to authenticated
  using (public.is_pray_admin())
  with check (public.is_pray_admin());
drop policy if exists "room prayer topics admin delete" on public.room_prayer_topics;
create policy "room prayer topics admin delete" on public.room_prayer_topics
  for delete to authenticated using (public.is_pray_admin());

-- Preserve the current shared topic as the first history entry, if present.
insert into public.room_prayer_topics(content, created_at)
select prayer_topic, coalesce(updated_at, now())
from public.room_settings
where id = 1 and length(trim(prayer_topic)) > 0
  and not exists (
    select 1 from public.room_prayer_topics h where h.content = room_settings.prayer_topic
  );
alter table public.room_settings
  add column if not exists prayer_updated_at timestamptz;
update public.room_settings s
set prayer_updated_at = coalesce(
  (select h.created_at from public.room_prayer_topics h
   where h.content = s.prayer_topic order by h.created_at desc limit 1),
  s.updated_at,
  now()
)
where s.prayer_updated_at is null;
alter table public.room_settings alter column prayer_updated_at set default now();
alter table public.room_settings alter column prayer_updated_at set not null;

-- Admins can view all member prayer topics; members retain their own access.
alter table public.personal_prayer_topics
  add column if not exists response_content text,
  add column if not exists responded_at timestamptz;
drop policy if exists "topics admin read" on public.personal_prayer_topics;
create policy "topics admin read" on public.personal_prayer_topics
  for select to authenticated using (public.is_pray_admin());

-- Audio upload policies used the same outdated JWT-only role check.
drop policy if exists "admins upload room audio" on storage.objects;
create policy "admins upload room audio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'room-audio' and public.is_pray_admin());
drop policy if exists "admins update room audio" on storage.objects;
create policy "admins update room audio" on storage.objects
  for update to authenticated
  using (bucket_id = 'room-audio' and public.is_pray_admin());
drop policy if exists "admins delete room audio" on storage.objects;
create policy "admins delete room audio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'room-audio' and public.is_pray_admin());
