-- handle_new_user is SECURITY DEFINER (it must insert into profiles past that table's own
-- RLS during signup) -- Postgres grants EXECUTE to PUBLIC on every new function by default,
-- which meant anon/authenticated could call it directly over PostgREST RPC. It should only
-- ever run as the auth.users insert trigger, never as a client-callable endpoint.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
