-- One-file upgrade for an EXISTING LINK PRAY ROOM Supabase project.
-- Paste this whole file into Supabase SQL Editor and run it once.
-- It includes admin, shared topics, prayer-time history, response fields, and the new topic field.
-- Do not run supabase-setup.sql on an existing project.


-- ===== Included: supabase-admin-prayer-update.sql =====

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



-- ===== Included: supabase-shared-prayer-topics-update.sql =====

-- Run once in Supabase SQL Editor for an existing LINK PRAY project.
-- Adds named shared prayer topics and publish states, makes them visible in the prayer room,
-- and archives the current legacy room_settings.prayer_topic.

alter table public.room_prayer_topics
  add column if not exists topic text not null default '';
alter table public.room_prayer_topics
  drop constraint if exists room_prayer_topics_topic_length;
alter table public.room_prayer_topics
  add constraint room_prayer_topics_topic_length check (length(topic) <= 120);

alter table public.room_prayer_topics
  add column if not exists title text not null default '';
alter table public.room_prayer_topics
  drop constraint if exists room_prayer_topics_title_length;
alter table public.room_prayer_topics
  add constraint room_prayer_topics_title_length check (length(title) <= 120);
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'room_prayer_topics' and column_name = 'status'
  ) then
    -- Treat existing entries as earlier topics and keep the newest one published.
    alter table public.room_prayer_topics add column status text not null default 'completed';
    update public.room_prayer_topics
    set status = 'published'
    where id = (select id from public.room_prayer_topics order by created_at desc limit 1);
    alter table public.room_prayer_topics alter column status set default 'published';
  end if;
end;
$$;
alter table public.room_prayer_topics
  drop constraint if exists room_prayer_topics_status_check;
alter table public.room_prayer_topics
  add constraint room_prayer_topics_status_check check (status in ('published', 'unpublished', 'completed'));

-- If the legacy setting is still populated, classify previous history as completed.
update public.room_prayer_topics t
set status = 'completed'
where exists (
  select 1 from public.room_settings s
  where s.id = 1 and length(trim(coalesce(s.prayer_topic, ''))) > 0
);

-- Preserve the existing current prayer topic before clearing the legacy field.
insert into public.room_prayer_topics(title, content, created_at)
select '', s.prayer_topic, coalesce(s.prayer_updated_at, s.updated_at, now())
from public.room_settings s
where s.id = 1
  and length(trim(coalesce(s.prayer_topic, ''))) > 0
  and not exists (
    select 1 from public.room_prayer_topics t where t.content = s.prayer_topic
  );
update public.room_prayer_topics t
set status = 'published'
from public.room_settings s
where s.id = 1 and length(trim(coalesce(s.prayer_topic, ''))) > 0
  and t.content = s.prayer_topic;
update public.room_settings
set prayer_topic = '', updated_at = now()
where id = 1 and length(trim(coalesce(prayer_topic, ''))) > 0;

-- Shared prayer text is public room content; only admins may change it.
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
grant insert, update, delete on public.room_prayer_topics to authenticated;

-- Enable live updates for visitors already in the room.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_prayer_topics'
  ) then
    alter publication supabase_realtime add table public.room_prayer_topics;
  end if;
end;
$$;



-- ===== Included: supabase-topic-prayer-time-update.sql =====

-- Existing LINK PRAY project: run once in Supabase SQL Editor.
-- Enables fixed group choices, admin profile editing, and shared-topic prayer-time history.
grant execute on function public.is_pray_admin() to anon, authenticated;

-- Keep profile classifications intact when Auth changes an email/password.
create or replace function public.new_prayer_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, email, phone, name, cohort, group_name, darabang, soon)
  values (
    new.id, lower(new.email),
    regexp_replace(coalesce(new.raw_user_meta_data->>'phone', ''), '[^0-9+]', '', 'g'),
    coalesce(new.raw_user_meta_data->>'name', '기도자'),
    coalesce(new.raw_user_meta_data->>'cohort', ''),
    coalesce(new.raw_user_meta_data->>'group_name', ''),
    coalesce(new.raw_user_meta_data->>'darabang', ''),
    coalesce(new.raw_user_meta_data->>'soon', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Admins may update member group, darabang, and soon fields.
drop policy if exists "profile admin update" on public.profiles;
create policy "profile admin update" on public.profiles
  for update to authenticated
  using (public.is_pray_admin())
  with check (role = 'member' or public.is_pray_admin());

-- Record each period during which a common prayer topic is published.
create table if not exists public.room_prayer_topic_publish_windows (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.room_prayer_topics(id) on delete cascade,
  published_at timestamptz not null,
  completed_at timestamptz,
  check (completed_at is null or completed_at >= published_at)
);
alter table public.room_prayer_topic_publish_windows enable row level security;
revoke all on public.room_prayer_topic_publish_windows from anon, authenticated;

-- Approximate existing topics from the only available timestamp. Older status-change times were not recorded.
insert into public.room_prayer_topic_publish_windows(topic_id, published_at, completed_at)
select t.id, t.created_at, case when t.status = 'completed' then now() else null end
from public.room_prayer_topics t
where t.status in ('published', 'completed')
  and not exists (
    select 1 from public.room_prayer_topic_publish_windows w where w.topic_id = t.id
  );

create or replace function public.track_room_prayer_topic_publish_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      insert into public.room_prayer_topic_publish_windows(topic_id, published_at)
      values(new.id, coalesce(new.created_at, now()));
    end if;
    return new;
  end if;
  if old.status = 'published' and new.status <> 'published' then
    update public.room_prayer_topic_publish_windows
    set completed_at = now()
    where topic_id = old.id and completed_at is null;
  elsif old.status <> 'published' and new.status = 'published' then
    insert into public.room_prayer_topic_publish_windows(topic_id, published_at)
    values(new.id, now());
  end if;
  return new;
end;
$$;
drop trigger if exists room_prayer_topic_publish_window on public.room_prayer_topics;
create trigger room_prayer_topic_publish_window
after insert or update on public.room_prayer_topics
for each row execute function public.track_room_prayer_topic_publish_window();

-- Public rooms can read only published/completed topics; admins can also read drafts.
drop policy if exists room_prayer_topics_select on public.room_prayer_topics;
drop policy if exists "room prayer topics admin read" on public.room_prayer_topics;
drop policy if exists "room prayer topics public read" on public.room_prayer_topics;
drop policy if exists "room prayer topics signed-in read" on public.room_prayer_topics;
create policy room_prayer_topics_select on public.room_prayer_topics
  for select using (status in ('published', 'completed') or public.is_pray_admin());

create or replace function public.shared_topic_prayer_totals()
returns table(topic_id uuid, total_seconds bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
    coalesce((
      select sum(topic_sessions.seconds)::bigint
      from (
        select greatest(0, extract(epoch from (
          least(s.ended_at, coalesce(w.completed_at, now()))
          - greatest(s.started_at, w.published_at)
        ))) as seconds
        from public.room_prayer_topic_publish_windows w
        join public.prayer_sessions s
          on s.ended_at is not null
         and s.started_at < coalesce(w.completed_at, now())
         and s.ended_at > w.published_at
        where w.topic_id = t.id

        union all

        select greatest(0, extract(epoch from (
          least(now(), coalesce(w.completed_at, now()))
          - greatest(s.started_at, ap.started_at, w.published_at)
        ))) as seconds
        from public.room_prayer_topic_publish_windows w
        join public.active_prayers ap
          on ap.started_at < coalesce(w.completed_at, now())
        join public.prayer_sessions s
          on s.id = ap.session_id
         and s.ended_at is null
         and s.started_at < coalesce(w.completed_at, now())
         and now() > w.published_at
        where w.topic_id = t.id
      ) as topic_sessions
    ), 0)::bigint as total_seconds
  from public.room_prayer_topics t
  where t.status in ('published', 'completed')
  ;
$$;
grant execute on function public.shared_topic_prayer_totals() to anon, authenticated;



-- ===== Included: supabase-update-prayer-responses.sql =====

-- Run this once in Supabase SQL Editor for an existing installation.
alter table public.personal_prayer_topics
  add column if not exists response_content text,
  add column if not exists responded_at timestamptz;



-- ===== Included: supabase-prayer-topic-subject-update.sql =====

-- Run once in Supabase SQL Editor before deploying the three-field prayer topic form.
alter table public.room_prayer_topics
  add column if not exists topic text not null default '';

alter table public.room_prayer_topics
  drop constraint if exists room_prayer_topics_topic_length;

alter table public.room_prayer_topics
  add constraint room_prayer_topics_topic_length check (length(topic) <= 120);
