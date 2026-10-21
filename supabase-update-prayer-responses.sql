-- Run this once in Supabase SQL Editor for an existing installation.
alter table public.personal_prayer_topics
  add column if not exists response_content text,
  add column if not exists responded_at timestamptz;
