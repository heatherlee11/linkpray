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
    floor(coalesce(sum(greatest(0, extract(epoch from (
      least(coalesce(s.ended_at, now()), coalesce(w.completed_at, now()))
      - greatest(s.started_at, w.published_at)
    )))), 0))::bigint as total_seconds
  from public.room_prayer_topics t
  left join public.room_prayer_topic_publish_windows w on w.topic_id = t.id
  left join public.prayer_sessions s
    on s.started_at < coalesce(w.completed_at, now())
   and coalesce(s.ended_at, now()) > w.published_at
  where t.status in ('published', 'completed')
  group by t.id;
$$;
grant execute on function public.shared_topic_prayer_totals() to anon, authenticated;
