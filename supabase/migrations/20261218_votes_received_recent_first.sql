-- Keep the most recent vote events inside the first PostgREST page.
-- PostgREST commonly caps each response at 1000 rows, while this RPC may return
-- up to 10000. Newest-first ordering ensures the current week's votes are not
-- hidden behind older events if a client cannot fetch later pages.
create or replace function public.votes_received(p_since timestamptz)
returns table (request_id uuid, created_at timestamptz)
language sql security definer set search_path = public as $$
  select v.request_id, v.created_at
    from public.votes v
   where v.created_at >= p_since
     and v.created_at < greatest(p_since, now())
   order by v.created_at desc, v.id desc
   limit 10000
$$;
revoke all on function public.votes_received(timestamptz) from public, anon, authenticated;
grant execute on function public.votes_received(timestamptz) to anon, authenticated;
notify pgrst, 'reload schema';
