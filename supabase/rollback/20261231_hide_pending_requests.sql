-- Rollback for 20261231_hide_pending_requests.
-- Restores the previous "read requests" policy and the 20261215 / 20261212
-- bodies of admin_review / admin_review_many without dropping any data.
begin;

alter policy "read requests" on public.requests
  using (true);

create or replace function public.admin_review(
  p_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_video_url text default null
) returns public.requests language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  v_before text;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_video_url is not null and (length(p_video_url) > 500 or p_video_url !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$') then
    raise exception 'err.denyVideo';
  end if;

  select status into v_before from public.requests where id = p_id for update;

  update public.requests
     set status      = case when p_approve then 'queued' else 'denied' end,
         deny_reason = case when p_approve then null else left(coalesce(p_reason,''),300) end,
         video_url   = case when p_approve then null else nullif(trim(p_video_url), '') end,
         updated_at  = now()
   where id = p_id
  returning * into r;

  if r.id is null then return r; end if;

  if v_before is distinct from r.status and r.user_id is not null then
    insert into public.notifications (user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (
      r.user_id,
      public.song_key(r.artist, r.title),
      case when p_approve then 'approved' else 'denied' end,
      r.id, r.title, r.artist,
      case when p_approve then null else left(coalesce(p_reason, ''), 300) end,
      'review|' || r.id::text || '|' || r.status
    )
    on conflict (user_id, sig) where sig is not null do nothing;
  end if;

  return r;
end $$;

revoke all on function public.admin_review(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_review(uuid, boolean, text, text) to authenticated;

create or replace function public.admin_review_many(
  p_ids uuid[],
  p_approve boolean,
  p_reason text default null,
  p_video_url text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 200 then raise exception 'err.bulkTooMany'; end if;

  foreach v_id in array p_ids loop
    if exists (select 1 from public.requests where id = v_id) then
      perform public.admin_review(v_id, p_approve, p_reason, p_video_url);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

revoke all on function public.admin_review_many(uuid[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_review_many(uuid[], boolean, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
