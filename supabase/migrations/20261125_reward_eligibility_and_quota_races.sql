/* ============================================================================
   20261125 — paid eligibility, request-quota serialization, and ranking parity
   ----------------------------------------------------------------------------
   Append-only fix for the reviewed Batch 1 scope. Keeps all existing RPC
   signatures, achievement catalog rows, response JSON keys, and idempotency
   keys. Does not claw back previously granted rewards or credits.

   No persistent database is changed by adding this file. Apply only through the
   guarded migration runner after the normal preflight and separate approval.
   ============================================================================ */
begin;

/* The paid-achievement EXISTS check probes orders by request_id. Reuse any
   existing usable btree index whose leading key is request_id (including the
   equivalent partial index); add one only when the live catalog has none. */
do $request_order_index$
declare
  v_request_attnum smallint;
begin
  select a.attnum
    into v_request_attnum
    from pg_attribute a
   where a.attrelid = 'public.orders'::regclass
     and a.attname = 'request_id'
     and not a.attisdropped;

  if v_request_attnum is null then
    raise exception 'err.rewardEligibilityPreflight: public.orders.request_id is missing';
  end if;

  if not exists (
    select 1
      from pg_index i
      join pg_class ix on ix.oid = i.indexrelid
      join pg_am am on am.oid = ix.relam
     where i.indrelid = 'public.orders'::regclass
       and i.indisvalid
       and i.indisready
       and am.amname = 'btree'
       and i.indkey[0] = v_request_attnum
       and (
         i.indpred is null
         or lower(regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[\s"]', '', 'g'))
              = '(request_idisnotnull)'
       )
  ) then
    execute 'create index orders_request_id_idx on public.orders using btree (request_id) where request_id is not null';
  end if;
end
$request_order_index$;

/* Keep the public view's column names/types unchanged. Only accepted request
   states contribute, and each user/song pair contributes once. Inline the
   same lower/trim/newline expression as public.song_key() so this invoker view
   does not require clients to have EXECUTE on that internal helper. */
create or replace view public.requester_ranking
  with (security_invoker = on) as
  with work_rows as (
    select r.user_id,
           r.requester,
           lower(trim(coalesce(r.artist, ''))) || E'\n' || lower(trim(coalesce(r.title, ''))) as work_key,
           r.status,
           r.votes
      from public.requests r
     where r.status in ('queued', 'in_progress', 'completed')
  ), work_groups as (
    select user_id,
           work_key,
           max(requester) as name,
           bool_or(status = 'completed') as completed,
           coalesce(sum(votes), 0)::int as total_votes
      from work_rows
     group by user_id, work_key
  )
  select g.user_id,
         max(g.name) as name,
         max(p.avatar_url) as avatar_url,
         count(*)::int as total,
         count(*) filter (where g.completed)::int as completed,
         coalesce(sum(g.total_votes), 0)::int as total_votes
    from work_groups g
    left join public.profiles p on p.id = g.user_id
   group by g.user_id;

create or replace function public.claim_achievements()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_streak int := 0;
  v_requests int := 0;
  v_completed int := 0;
  v_paid int := 0;
  v_votes int := 0;
  v_rank int;
  v_progress int;
  v_earned boolean;
  v_inserted boolean;
  d record;
  v_new jsonb := '[]'::jsonb;
  p public.profiles;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select * into p from public.profiles where id = v_uid for update;
  if p.id is null then raise exception 'err.signin'; end if;

  select coalesce(max(run_len), 0)::int into v_streak
    from (
      select count(*)::int as run_len
        from (
          select day, day - (row_number() over (order by day))::int as grp
            from public.activity_days where user_id = v_uid
        ) runs
       group by grp
    ) grouped_runs;

  /* Count one work per normalized artist/title, and require an accepted state.
     A paid achievement additionally needs a settled paid_request order tied to
     that exact request; a bonus-funded request has no such order and cannot
     qualify merely because payment_status says 'paid'. */
  with work_rows as (
    select r.user_id,
           public.song_key(r.artist, r.title) as work_key,
           r.status,
           r.is_paid,
           r.payment_status,
           r.id as request_id,
           exists (
             select 1
               from public.orders o
              where o.request_id = r.id
                and o.user_id = r.user_id
                and o.kind = 'paid_request'
                and o.status = 'paid'
           ) as settled_paid_order
      from public.requests r
     where r.user_id = v_uid
       and r.status in ('queued', 'in_progress', 'completed')
  ), work_groups as (
    select user_id,
           work_key,
           bool_or(status = 'completed') as completed,
           bool_or(is_paid and payment_status = 'paid' and settled_paid_order) as paid
      from work_rows
     group by user_id, work_key
  )
  select count(*)::int,
         count(*) filter (where completed)::int,
         count(*) filter (where paid)::int
    into v_requests, v_completed, v_paid
    from work_groups;

  select count(*)::int into v_votes from public.votes where user_id = v_uid;

  /* Match requester_ranking's qualified, distinct-work totals. The achievement
     rank's existing ordering (total, then votes, then user id) is unchanged. */
  with work_groups as (
    select user_id,
           public.song_key(artist, title) as work_key,
           coalesce(sum(votes), 0)::int as total_votes
      from public.requests
     where status in ('queued', 'in_progress', 'completed')
     group by user_id, public.song_key(artist, title)
  ), scores as (
    select user_id,
           count(*)::int as total,
           coalesce(sum(total_votes), 0)::int as total_votes
      from work_groups
     group by user_id
  ), me as (
    select * from scores where user_id = v_uid
  )
  select case when me.user_id is null then null else
    (1 + count(*) filter (
      where s.total > me.total
         or (s.total = me.total and s.total_votes > me.total_votes)
         or (s.total = me.total and s.total_votes = me.total_votes
             and s.user_id::text < me.user_id::text)
    ))::int end
    into v_rank
    from scores s cross join me
   group by me.user_id, me.total, me.total_votes;

  for d in select * from public.achievement_definitions where active order by id loop
    v_progress := case d.source
      when 'streak' then v_streak
      when 'requests' then v_requests
      when 'completed' then v_completed
      when 'paid' then v_paid
      when 'votes' then v_votes
      when 'leaderboard' then coalesce(v_rank, 0)
      else 0 end;
    v_earned := case when d.source = 'leaderboard'
      then v_rank is not null and v_rank <= d.threshold
      else v_progress >= d.threshold end;

    if v_earned then
      insert into public.achievement_rewards
        (user_id, achievement_id, bonus_votes, bonus_requests, badge)
      values (v_uid, d.id, d.bonus_votes, d.bonus_requests, d.badge)
      on conflict (user_id, achievement_id) do nothing;
      v_inserted := found;
      if v_inserted then
        update public.profiles
           set bonus_credits = bonus_credits + d.bonus_votes,
               bonus_requests = bonus_requests + d.bonus_requests
         where id = v_uid;
      end if;
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', d.id, 'progress', v_progress, 'need', d.threshold,
        'badge', d.badge, 'bonus_votes', d.bonus_votes,
        'bonus_requests', d.bonus_requests, 'newly_granted', v_inserted
      ));
    end if;
  end loop;

  select * into p from public.profiles where id = v_uid;
  return jsonb_build_object(
    'earned', v_new,
    'bonus_credits', p.bonus_credits,
    'purchased', p.vote_credits,
    'credits', p.vote_credits + p.bonus_credits,
    'bonus_requests', p.bonus_requests
  );
end $$;

revoke all on function public.claim_achievements() from public, anon, authenticated;
grant execute on function public.claim_achievements() to authenticated;

create or replace function public.create_request(
  p_kind text, p_artist text, p_title text,
  p_link text, p_note text, p_paid boolean default false,
  p_use_bonus boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_cnt int;
  v_bonus_requests int;
  r public.requests;
begin
  if v_uid is null then raise exception 'err.requestAuth'; end if;
  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'err.needFields';
  end if;
  if coalesce(p_use_bonus, false) and not coalesce(p_paid, false) then
    raise exception 'err.rewardType';
  end if;

  /* Serialize every request-creation path for this account before checking a
     quota. The row lock is held to transaction end, so the count and insert
     below are one atomic decision against other create_request calls. */
  select name, bonus_requests into v_name, v_bonus_requests
    from public.profiles where id = v_uid for update;
  if not found or v_name is null then raise exception 'err.requestAuth'; end if;

  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests
     where user_id = v_uid and is_paid = false
       and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then raise exception 'err.rateLimit' using detail = '3'; end if;
  elsif not coalesce(p_use_bonus, false) then
    select count(*) into v_cnt from public.orders
     where user_id = v_uid and kind = 'paid_request' and status = 'awaiting';
    if v_cnt >= 5 then raise exception 'err.paidPending' using detail = '5'; end if;
  end if;

  if coalesce(p_use_bonus, false) and coalesce(v_bonus_requests, 0) < 1 then
    raise exception 'err.noBonusRequest';
  end if;

  insert into public.requests (user_id, kind, artist, title, link, note, requester,
                               is_paid, payment_status, status)
  values (
    v_uid,
    coalesce(nullif(p_kind,''), 'Color Coded Lyrics'),
    left(trim(p_artist),120), left(trim(p_title),160),
    left(coalesce(p_link,''),500), left(coalesce(p_note,''),500),
    coalesce(v_name,'Anonymous'), coalesce(p_paid,false),
    case when p_use_bonus then 'paid' when p_paid then 'awaiting' else 'none' end,
    case when p_use_bonus then 'queued' else 'pending' end
  ) returning * into r;

  if p_use_bonus then
    update public.profiles
       set bonus_requests = bonus_requests - 1
     where id = v_uid and bonus_requests > 0;
    if not found then raise exception 'err.noBonusRequest'; end if;
  elsif p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id)
    values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;
  return r;
end $$;

revoke all on function public.create_request(text,text,text,text,text,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean,boolean)
  to authenticated;

/* Use the same accepted-state and one-user/song policy for season payouts. The
   time-window rules, winner order, rewards, and idempotency constraints stay
   unchanged; only pending/denied and duplicate inflation are removed. */
create or replace function public.settle_season_rewards(
  p_season_type text, p_period_key text,
  p_start timestamptz, p_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_winners record;
  v_rank int := 1;
  v_votes int;
  v_reqs int;
  v_title text;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  if p_season_type not in ('week', 'month') or p_start is null or p_end is null or p_start >= p_end then
    raise exception 'err.rewardPeriod';
  end if;

  for v_winners in (
    with period_rows as (
      select r.user_id,
             public.song_key(r.artist, r.title) as work_key,
             r.status,
             r.votes,
             r.created_at,
             coalesce(r.updated_at, r.created_at) as done_at
        from public.requests r
       where r.user_id is not null
         and r.status in ('queued', 'in_progress', 'completed')
         and ((r.status = 'completed' and coalesce(r.updated_at, r.created_at) >= p_start
               and coalesce(r.updated_at, r.created_at) < p_end)
           or (r.created_at >= p_start and r.created_at < p_end))
    ), work_groups as (
      select user_id,
             work_key,
             bool_or(status = 'completed' and done_at >= p_start and done_at < p_end) as completed_in,
             coalesce(sum(votes), 0)::bigint as total_votes,
             min(created_at) as earliest_request
        from period_rows
       group by user_id, work_key
    ), scores as (
      select user_id,
             count(*) filter (where completed_in)::bigint as completed_count,
             coalesce(sum(total_votes), 0)::bigint as total_votes,
             count(*)::bigint as total_submitted,
             min(earliest_request) as earliest_request
        from work_groups
       group by user_id
    )
    select user_id, completed_count, total_votes, total_submitted, earliest_request
      from scores
     order by completed_count desc, total_votes desc, total_submitted desc,
              earliest_request asc, user_id asc
     limit 3
  ) loop
    if p_season_type = 'week' then
      if v_rank = 1 then v_votes := 15; v_reqs := 0; v_title := 'Weekly #1 Winner';
      elsif v_rank = 2 then v_votes := 10; v_reqs := 0; v_title := 'Weekly #2 Winner';
      else v_votes := 5; v_reqs := 0; v_title := 'Weekly #3 Winner'; end if;
    else
      if v_rank = 1 then v_votes := 50; v_reqs := 1; v_title := 'Monthly Champion';
      elsif v_rank = 2 then v_votes := 30; v_reqs := 0; v_title := 'Monthly Runner-up';
      else v_votes := 20; v_reqs := 0; v_title := 'Monthly #3 Winner'; end if;
    end if;

    insert into public.season_rewards_log
      (season_type, period_key, user_id, rank, bonus_votes, bonus_requests, title)
    values (p_season_type, p_period_key, v_winners.user_id, v_rank,
            v_votes, v_reqs, v_title)
    on conflict on constraint uq_season_rewards_rank do nothing;
    if found then
      perform public.grant_season_reward(v_winners.user_id::text, v_votes, v_reqs, v_title);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rank', v_rank, 'user_id', v_winners.user_id,
        'bonus_votes', v_votes, 'bonus_requests', v_reqs, 'title', v_title));
    end if;
    v_rank := v_rank + 1;
  end loop;
  return v_results;
end $$;

revoke all on function public.settle_season_rewards(text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_season_rewards(text,text,timestamptz,timestamptz)
  to service_role;

notify pgrst, 'reload schema';
commit;
