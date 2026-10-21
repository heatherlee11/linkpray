-- Run once in Supabase SQL Editor for an existing LINK PRAY project.
-- Adds named shared prayer topics, makes them visible in the prayer room,
-- and archives the current legacy room_settings.prayer_topic.

alter table public.room_prayer_topics
  add column if not exists title text not null default '';
alter table public.room_prayer_topics
  drop constraint if exists room_prayer_topics_title_length;
alter table public.room_prayer_topics
  add constraint room_prayer_topics_title_length check (length(title) <= 120);

-- Preserve the existing current prayer topic before clearing the legacy field.
insert into public.room_prayer_topics(title, content, created_at)
select '', s.prayer_topic, coalesce(s.prayer_updated_at, s.updated_at, now())
from public.room_settings s
where s.id = 1
  and length(trim(coalesce(s.prayer_topic, ''))) > 0
  and not exists (
    select 1 from public.room_prayer_topics t where t.content = s.prayer_topic
  );
update public.room_settings
set prayer_topic = '', updated_at = now()
where id = 1 and length(trim(coalesce(prayer_topic, ''))) > 0;

-- Shared prayer text is public room content; only admins may change it.
grant select on public.room_prayer_topics to anon, authenticated;
drop policy if exists "room prayer topics admin read" on public.room_prayer_topics;
drop policy if exists "room prayer topics public read" on public.room_prayer_topics;
create policy "room prayer topics public read" on public.room_prayer_topics
  for select to anon, authenticated using (true);
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
