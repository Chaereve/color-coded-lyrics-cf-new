-- Narrow anonymous SQL privileges on tables and RPCs.
-- The admin functions still require is_admin(), but anonymous clients should
-- not be able to invoke them at all. User actions remain available to signed-in
-- users; public leaderboard/read RPCs are intentionally untouched.
begin;

-- These are not used by the web client and are not protected by row policies.
revoke truncate, references, trigger on all tables in schema public
  from anon, authenticated;
-- All are authenticated UI actions. Keep authenticated access, remove the
-- default PUBLIC and anon grants that made them appear as public RPC endpoints.
revoke all on function public.admin_media_delete(uuid) from public, anon;
grant execute on function public.admin_media_delete(uuid) to authenticated;
revoke all on function public.admin_media_reorder(uuid[]) from public, anon;
grant execute on function public.admin_media_reorder(uuid[]) to authenticated;
revoke all on function public.admin_media_save(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_media_save(uuid, text, text, text, text, text, boolean) to authenticated;
revoke all on function public.admin_order(uuid, boolean) from public, anon;
grant execute on function public.admin_order(uuid, boolean) to authenticated;
revoke all on function public.admin_pick(uuid, boolean) from public, anon;
grant execute on function public.admin_pick(uuid, boolean) to authenticated;
revoke all on function public.admin_update(uuid, text, integer, text, boolean, boolean, boolean, text, text) from public, anon;
grant execute on function public.admin_update(uuid, text, integer, text, boolean, boolean, boolean, text, text) to authenticated;
revoke all on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;
revoke all on function public.delete_my_request(uuid) from public, anon;
grant execute on function public.delete_my_request(uuid) to authenticated;
revoke all on function public.toggle_watch(text, text) from public, anon;
grant execute on function public.toggle_watch(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
