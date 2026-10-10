-- ACHIEVEMENTS V2 — the approved 20-item catalog (2026-10 plan).
-- Run AFTER 20261127_login_streak_rewards.sql. One transaction, rerunnable.
--
-- The catalog narrows 42 -> exactly 20 ACTIVE items in five groups. Nothing
-- is deleted: 25 retired ids are deactivated (history in achievement_rewards
-- is untouched — an already-earned badge stays earned), the kept 17 are
-- re-pointed to the approved reward amounts, and three NEW special sources
-- join the catalog. The claim RPC gains three progress signals and pays its
-- vote bonuses through the shared reward ledger + daily cap.
--
-- Approved catalog (amounts in VOTES, unless "free paid request"):
--   Requests (5): 1/5/10/25/50  -> +1/2/3/5/10 votes
--   Votes    (5): 1/10/50/100/250 -> +1/2/3/5/10 votes
--   Paid     (4): 1/3/5/10      -> 1/2/3/4 free paid requests (NOT votes —
--                                   outside the daily vote cap)
--   Streak   (3): 7/30/100      -> +5/10/20 votes
--   Special  (3): first pick / first vote-back / first mystery box
--                                 -> +2/3/5 votes

begin;

-- 1. The source vocabulary widens for the three special items. Drop whatever
--    the live CHECK is named (a hand-edited install may have renamed it),
--    then re-add under the canonical name — the 20260908 pattern.
do $$
declare v_con record;
begin
  for v_con in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'achievement_definitions'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%source%'
  loop
    execute format('alter table public.achievement_definitions drop constraint %I', v_con.conname);
  end loop;
end $$;

alter table public.achievement_definitions
  add constraint achievement_definitions_source_check
  check (source in ('streak','requests','completed','paid','votes','leaderboard',
                    'pick','vote_back','mystery'));

-- 2. The approved catalog, active exactly 20. Upsert first (rerunnable: a
--    tuned value would be overwritten by a re-run ONLY for these 20 ids,
--    which is intended — this file IS the catalog), then retire the rest.
insert into public.achievement_definitions
  (id, source, threshold, bonus_votes, bonus_requests, badge)
values
  ('streak7',         'streak',   7,   5, 0, 'streak7'),
  ('streak30',        'streak',  30,  10, 0, 'streak30'),
  ('streak100',       'streak', 100,  20, 0, 'streak100'),
  ('firstRequest',    'requests', 1,   1, 0, 'firstRequest'),
  ('request5',        'requests', 5,   2, 0, 'request5'),
  ('request10',       'requests',10,   3, 0, 'request10'),
  ('request25',       'requests',25,   5, 0, 'request25'),
  ('request50',       'requests',50,  10, 0, 'request50'),
  ('votesCast1',      'votes',    1,   1, 0, 'votesCast1'),
  ('votesCast10',     'votes',   10,   2, 0, 'votesCast10'),
  ('votesCast50',     'votes',   50,   3, 0, 'votesCast50'),
  ('votesCast100',    'votes',  100,   5, 0, 'votesCast100'),
  ('votesCast250',    'votes',  250,  10, 0, 'votesCast250'),
  ('firstPaidRequest','paid',     1,   0, 1, 'firstPaidRequest'),
  ('paid3',           'paid',     3,   0, 2, 'paid3'),
  ('paid5',           'paid',     5,   0, 3, 'paid5'),
  ('paid10',          'paid',    10,   0, 4, 'paid10'),
  ('firstPick',       'pick',     1,   2, 0, 'firstPick'),
  ('firstVoteBack',   'vote_back',1,   3, 0, 'firstVoteBack'),
  ('firstMystery',    'mystery',  1,   5, 0, 'firstMystery')
on conflict (id) do update set
  source = excluded.source,
  threshold = excluded.threshold,
  bonus_votes = excluded.bonus_votes,
  bonus_requests = excluded.bonus_requests,
  badge = excluded.badge,
  active = true;

update public.achievement_definitions
   set active = false
 where id in (
   'streak3','streak14','streak60','streak180','streak365',
   'request3','request100','request250',
   'firstCompletion','completion3','completion5','completion10',
   'completion25','completion50','completion100',
   'paid25','paid50',
   'votesCast25','votesCast500','votesCast1000',
   'top10','top5','podium','runnerUp','champion');

do $catalog_guard$
declare v_active int; v_groups int;
begin
  select count(*) into v_active from public.achievement_definitions where active;
  select count(distinct case when source in ('pick','vote_back','mystery')
                             then 'special' else source end) into v_groups
    from public.achievement_definitions where active;
  if v_active <> 20 then
    raise exception 'err.achievementCatalog: active catalog must be exactly 20, got %', v_active;
  end if;
  -- Five APPROVED groups: requests, votes, paid, streak, special — the three
  -- special sources are one group, not three.
  if v_groups <> 5 then
    raise exception 'err.achievementCatalog: active catalog must span 5 groups, got %', v_groups;
  end if;
end
$catalog_guard$;

-- 3. The claim RPC, restated from 20261125 with three changes and nothing
--    else: the new progress sources, cap-aware vote payouts recorded in
--    reward_events, and retry-once semantics for anything the cap clipped.
--    Same signature, same lock order (profile first), same idempotency PK,
--    same earned-list response shape.
create or replace function public.claim_achievements()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
  v_streak int := 0;
  v_requests int := 0;
  v_completed int := 0;
  v_paid int := 0;
  v_votes int := 0;
  v_pick int := 0;
  v_vote_back int := 0;
  v_mystery int := 0;
  v_rank int;
  v_progress int;
  v_earned boolean;
  v_inserted boolean;
  v_remaining int;
  v_slice int;
  v_granted int;
  d record;
  v_new jsonb := '[]'::jsonb;
  p public.profiles;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select * into p from public.profiles where id = v_uid for update;
  if p.id is null then raise exception 'err.signin'; end if;
  v_day := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;

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

  /* Special sources: picked = any of my requests ever entered Up next
     (picked_at set; admin_update clears it again on completion, after which
     the vote-back ledger of the pick keeps the fact). vote_back / mystery are
     observed through the reward ledger — B2/B4 write those events. */
  select count(*)::int into v_pick from public.requests
   where user_id = v_uid and picked_at is not null;
  if exists (
    select 1 from public.reward_events
     where user_id = v_uid and source in ('vote_back_owner','vote_back_voter')) then
    v_vote_back := 1;
  end if;
  if exists (
    select 1 from public.reward_events
     where user_id = v_uid and source = 'mystery_box') then
    v_mystery := 1;
  end if;

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
      when 'pick' then v_pick
      when 'vote_back' then v_vote_back
      when 'mystery' then v_mystery
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

      -- Vote bonuses: through the ledger + daily cap. A bonus clipped by the
      -- cap keeps its badge row and tops up on a LATER claim. Each payment is
      -- its own slice ref (ach:<id>#<n>): a fresh idempotency slot per slice,
      -- so a same-day top-up after the cap widens cannot collide with the
      -- clipped slice it follows. The ask minus every slice already paid is
      -- what remains; once fully paid, no further slice is ever created.
      v_granted := 0;
      if d.bonus_votes > 0 then
        -- The '#' delimiter keeps prefix families apart: 'ach:request5#%'
        -- never matches 'ach:request50#1'.
        select coalesce(sum(amount), 0)::int into v_remaining
          from public.reward_events
         where user_id = v_uid and source = 'achievement'
           and ref like 'ach:' || d.id || '#%';
        v_remaining := d.bonus_votes - v_remaining;
        if v_remaining > 0 then
          select count(*)::int + 1 into v_slice
            from public.reward_events
           where user_id = v_uid and source = 'achievement'
             and ref like 'ach:' || d.id || '#%';
          v_granted := public.grant_reward_event(v_uid, v_day, 'achievement',
            'ach:' || d.id || '#' || v_slice, v_remaining,
            jsonb_build_object('achievement', d.id));
        end if;
      end if;

      -- Free paid requests are not votes: outside the cap, once per badge.
      if v_inserted and d.bonus_requests > 0 then
        update public.profiles
           set bonus_requests = bonus_requests + d.bonus_requests
         where id = v_uid;
      end if;

      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', d.id, 'progress', v_progress, 'need', d.threshold,
        'badge', d.badge, 'bonus_votes', d.bonus_votes,
        'bonus_requests', d.bonus_requests, 'newly_granted', v_inserted,
        'votes_granted', v_granted
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

comment on function public.claim_achievements() is
  'Catalog v2 (2026-10 plan, 20 active items). Vote bonuses flow through reward_events under the shared daily cap and top up later when clipped; free paid requests stay outside the cap and are granted once with the badge.';

notify pgrst, 'reload schema';
commit;
