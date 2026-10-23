-- Run once in Supabase SQL Editor before deploying the three-field prayer topic form.
alter table public.room_prayer_topics
  add column if not exists topic text not null default '';

alter table public.room_prayer_topics
  drop constraint if exists room_prayer_topics_topic_length;

alter table public.room_prayer_topics
  add constraint room_prayer_topics_topic_length check (length(topic) <= 120);
