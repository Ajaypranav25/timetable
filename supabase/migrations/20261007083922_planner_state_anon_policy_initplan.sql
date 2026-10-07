-- Evaluate auth.jwt() once per statement, not once per row (Supabase linter 0003_auth_rls_initplan).
drop policy if exists "no anonymous users" on public.planner_state;
create policy "no anonymous users" on public.planner_state
  as restrictive for all to authenticated
  using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
