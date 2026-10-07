-- updated_at is the row version the browser compares against, so every write must change it,
-- even two writes in one transaction (now() is fixed per transaction; clock_timestamp() is not).
create or replace function public.planner_state_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke execute on function public.planner_state_touch() from public, anon, authenticated;
