-- handle_new_user is a trigger function, but living in the `public` schema also
-- exposed it at /rest/v1/rpc/handle_new_user, callable by anon. It runs as
-- SECURITY DEFINER, so nobody outside the trigger should be able to invoke it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;