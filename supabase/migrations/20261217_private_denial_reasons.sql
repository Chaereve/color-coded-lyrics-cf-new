-- A denial note is private to its requester and administrators. PostgreSQL
-- column grants prevent reading it through PostgREST/table queries; the narrow
-- SECURITY DEFINER RPC below is the only client read path.
begin;

revoke select on table public.requests from public, anon, authenticated;
grant select (
  id, user_id, kind, artist, title, link, note, requester, status, progress, votes,
  is_paid, payment_status, done_layout, done_lyrics, done_edit, video_url,
  picked_at, expired_at, created_at, updated_at
) on table public.requests to anon, authenticated;

create or replace function public.get_visible_denial_reasons()
returns table (id uuid, deny_reason text)
language sql stable security definer set search_path = public as $$
  select r.id, r.deny_reason
  from public.requests r
  where r.status = 'denied'
    and auth.uid() is not null
    and (r.user_id = auth.uid() or public.is_admin());
$$;
revoke all on function public.get_visible_denial_reasons() from public, anon, authenticated;
grant execute on function public.get_visible_denial_reasons() to authenticated;

notify pgrst, 'reload schema';

commit;
