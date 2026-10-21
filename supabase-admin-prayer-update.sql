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
  title text not null default '' check (length(title) <= 120),
  status text not null default 'published' check (status in ('published', 'unpublished', 'completed')),
  content text not null check (length(content) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.room_prayer_topics
  add column if not exists title text not null default '',
  add column if not exists status text not null default 'published';
alter table public.room_prayer_topics
  drop constraint if exists room_prayer_topics_status_check;
alter table public.room_prayer_topics
  add constraint room_prayer_topics_status_check check (status in ('published', 'unpublished', 'completed'));
alter table public.room_prayer_topics enable row level security;
grant select, insert, update, delete on public.room_prayer_topics to authenticated;
grant select on public.room_prayer_topics to anon, authenticated;
grant execute on function public.is_pray_admin() to anon, authenticated;
drop policy if exists "room prayer topics admin read" on public.room_prayer_topics;
drop policy if exists "room prayer topics public read" on public.room_prayer_topics;
drop policy if exists "room prayer topics signed-in read" on public.room_prayer_topics;
drop policy if exists room_prayer_topics_select on public.room_prayer_topics;
create policy room_prayer_topics_select
  on public.room_prayer_topics
  for select
  using (status = 'published' or public.is_pray_admin());
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
alter table public.room_settings add column if not exists youtube_url text;

-- Admin dashboard needs read access to sessions to show individual totals.
drop policy if exists "session admin read" on public.prayer_sessions;
create policy "session admin read" on public.prayer_sessions
  for select to authenticated using (public.is_pray_admin());

-- Reset completed totals and restart any prayer sessions currently in progress.
create or replace function public.admin_reset_prayer_time(target_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_pray_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;
  if target_user_id is not null and not exists (
    select 1 from public.profiles where id = target_user_id
  ) then
    raise exception '회원을 찾을 수 없습니다';
  end if;
  delete from public.prayer_sessions
  where ended_at is not null and (target_user_id is null or user_id = target_user_id);
  update public.prayer_sessions set started_at = now(), duration_seconds = 0
  where ended_at is null and (target_user_id is null or user_id = target_user_id);
  update public.active_prayers set started_at = now()
  where target_user_id is null or user_id = target_user_id;
  update public.room_settings set updated_at = now() where id = 1;
end;
$$;
grant execute on function public.admin_reset_prayer_time(uuid) to authenticated;

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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_settings'
  ) then
    alter publication supabase_realtime add table public.room_settings;
  end if;
end;
$$;
