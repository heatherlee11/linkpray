-- Run once in Supabase SQL Editor before deploying the term-aware web app.
-- Existing prayer records are assigned to 27텀 and kept intact. Future sessions receive the active term.

create table if not exists public.prayer_terms (
  term_name text primary key check (length(btrim(term_name)) between 1 and 40),
  started_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
alter table public.prayer_terms enable row level security;
revoke all on public.prayer_terms from anon, authenticated;

alter table public.prayer_sessions add column if not exists term_name text;
update public.prayer_sessions set term_name = '27텀' where term_name is null or btrim(term_name) = '';
alter table public.prayer_sessions alter column term_name set default '27텀';
alter table public.prayer_sessions alter column term_name set not null;

insert into public.prayer_terms(term_name, started_at)
values ('27텀', coalesce((select min(started_at) from public.prayer_sessions), now()))
on conflict (term_name) do nothing;
insert into public.prayer_terms(term_name, started_at)
select s.term_name, min(s.started_at)
from public.prayer_sessions s
where s.term_name is not null and btrim(s.term_name) <> ''
group by s.term_name
on conflict (term_name) do nothing;

alter table public.room_settings add column if not exists current_term text;
update public.room_settings
set current_term = coalesce(nullif(btrim(current_term), ''), '27텀')
where id = 1;
alter table public.room_settings alter column current_term set default '27텀';
alter table public.room_settings alter column current_term set not null;
insert into public.prayer_terms(term_name, started_at)
select current_term, now() from public.room_settings where id = 1
on conflict (term_name) do nothing;

create or replace function public.public_prayer_total_seconds()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((
      select sum(s.duration_seconds)::bigint
      from public.prayer_sessions s
      where s.ended_at is not null
        and s.term_name = (select current_term from public.room_settings where id = 1)
    ), 0)
    + coalesce((
      select sum(extract(epoch from (now() - greatest(s.started_at, a.started_at)))::bigint)
      from public.active_prayers a
      join public.prayer_sessions s on s.id = a.session_id
      where s.ended_at is null
        and s.term_name = (select current_term from public.room_settings where id = 1)
    ), 0)
  )::bigint;
$$;
grant execute on function public.public_prayer_total_seconds() to anon, authenticated;

create or replace function public.admin_start_prayer_term(p_term_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_term text := btrim(coalesce(p_term_name, ''));
  active_count integer;
begin
  if not public.is_pray_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;
  if length(requested_term) < 1 or length(requested_term) > 40 then
    raise exception '새 텀 이름은 1~40자로 입력해 주세요';
  end if;
  if exists (select 1 from public.room_settings where id = 1 and current_term = requested_term) then
    raise exception '현재 텀과 다른 이름을 입력해 주세요';
  end if;
  if exists (select 1 from public.prayer_terms where term_name = requested_term) then
    raise exception '이미 사용한 텀 이름입니다. 다른 이름을 입력해 주세요';
  end if;

  select count(*) into active_count from public.active_prayers;
  if active_count > 0 then
    raise exception '기도 중인 회원이 %명 있어요. 모두 기도를 마친 뒤 새 텀을 시작해 주세요', active_count;
  end if;

  insert into public.prayer_terms(term_name, created_by) values (requested_term, auth.uid());
  update public.room_settings set current_term = requested_term, updated_at = now() where id = 1;
end;
$$;
grant execute on function public.admin_start_prayer_term(text) to authenticated;

-- Member-facing totals grouped by term without exposing other members' records.
create or replace function public.member_prayer_term_totals()
returns table(term_name text, total_seconds bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.term_name, coalesce(sum(s.duration_seconds), 0)::bigint as total_seconds
  from public.prayer_sessions s
  where s.user_id = auth.uid() and s.ended_at is not null
  group by s.term_name;
$$;
grant execute on function public.member_prayer_term_totals() to authenticated;

-- Admin view grouped by member and term; avoids loading every session row into the browser.
create or replace function public.admin_prayer_term_totals()
returns table(user_id uuid, term_name text, total_seconds bigint)
language sql
stable
security definer
set search_path = public
as $$
  select prayer_totals.user_id, prayer_totals.term_name,
    sum(prayer_totals.seconds)::bigint as total_seconds
  from (
    select s.user_id, s.term_name, s.duration_seconds::numeric as seconds
    from public.prayer_sessions s
    where s.ended_at is not null
    union all
    select s.user_id, s.term_name,
      extract(epoch from (now() - greatest(s.started_at, a.started_at))) as seconds
    from public.active_prayers a
    join public.prayer_sessions s on s.id = a.session_id
    where s.ended_at is null
  ) as prayer_totals
  where public.is_pray_admin()
  group by prayer_totals.user_id, prayer_totals.term_name;
$$;
grant execute on function public.admin_prayer_term_totals() to authenticated;
