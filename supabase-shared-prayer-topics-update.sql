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
