-- One row per signed-in user: their parsed semester data, current plan/settings and saved plans.
-- The browser keeps a localStorage copy; js/cloud.js syncs it here. updated_at doubles as the
-- row version: uploads are `update ... where updated_at = <version the browser last saw>`.

create table if not exists public.planner_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null,
  session    jsonb not null default '{}'::jsonb,
  plans      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- a semester's data is ~50 KB; this stops anyone using the table as free storage
  constraint planner_state_size check (pg_column_size(data) + pg_column_size(session) + pg_column_size(plans) < 1000000),
  constraint planner_state_shapes check (
    jsonb_typeof(data) = 'object' and jsonb_typeof(session) = 'object' and jsonb_typeof(plans) = 'object'
  )
);

comment on table public.planner_state is 'SKIP.EXE attendance planner state, one row per user.';

-- updated_at is the sync clock, so the server sets it, never the client
create or replace function public.planner_state_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.planner_state_touch() from public, anon, authenticated;

drop trigger if exists planner_state_touch on public.planner_state;
create trigger planner_state_touch
  before insert or update on public.planner_state
  for each row execute function public.planner_state_touch();

alter table public.planner_state enable row level security;

revoke all on public.planner_state from anon, authenticated;
grant select, insert, update, delete on public.planner_state to authenticated;

drop policy if exists "read own planner state" on public.planner_state;
create policy "read own planner state" on public.planner_state
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "insert own planner state" on public.planner_state;
create policy "insert own planner state" on public.planner_state
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "update own planner state" on public.planner_state;
create policy "update own planner state" on public.planner_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "delete own planner state" on public.planner_state;
create policy "delete own planner state" on public.planner_state
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous sign-ins (if ever enabled in the dashboard) also get the `authenticated` role;
-- only real (Google) accounts may store a plan.
drop policy if exists "no anonymous users" on public.planner_state;
create policy "no anonymous users" on public.planner_state
  as restrictive for all to authenticated
  using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false)
  with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false);
