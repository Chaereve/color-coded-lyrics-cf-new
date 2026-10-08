-- Corrective rollback for 20261128_achievements_v2. Apply only after
-- approval.
--
-- Restores the live catalog to the exact pre-v2 state (all 42 definitions of
-- 20261106/20261125 active with their original bonus values), removes the
-- three special items, narrows the source CHECK back to the six original
-- sources, and restores the 20261125 claim_achievements body verbatim.
--
-- Guards: refuses while any of the three special achievements has been
-- GRANTED to a user (achievement_rewards rows) — those badges are history and
-- a rollback never deletes them; in that case keep the catalog rows or plan a
-- reviewed data migration. Refuses to run twice. Ledger rows the v2 claim
-- wrote stay exactly where they are (no claw-back).
begin;

do $preflight$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.rewardRollback: guarded-runner migration history is missing';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20261128_achievements_v2') then
    raise exception 'err.rewardRollback: 20261128 is not recorded as applied';
  end if;
  if exists (
    select 1 from public.achievement_rewards
     where achievement_id in ('firstPick','firstVoteBack','firstMystery')) then
    raise exception 'err.rewardRollback: a special achievement has already been granted; roll the catalog back by hand instead';
  end if;
end
$preflight$;

-- 1. The pre-v2 catalog, verbatim from 20261106 (on conflict updates every
--    field back to its original value and re-activates it).
insert into public.achievement_definitions
  (id, source, threshold, bonus_votes, bonus_requests, badge)
values
  ('streak3', 'streak', 3, 1, 0, 'streak3'),
  ('streak7', 'streak', 7, 3, 0, 'streak7'),
  ('streak14', 'streak', 14, 5, 0, 'streak14'),
  ('streak30', 'streak', 30, 10, 0, 'streak30'),
  ('streak60', 'streak', 60, 20, 0, 'streak60'),
  ('streak100', 'streak', 100, 35, 0, 'streak100'),
  ('streak180', 'streak', 180, 50, 0, 'streak180'),
  ('streak365', 'streak', 365, 100, 0, 'streak365'),
  ('firstRequest', 'requests', 1, 1, 0, 'firstRequest'),
  ('request3', 'requests', 3, 2, 0, 'request3'),
  ('request5', 'requests', 5, 3, 0, 'request5'),
  ('request10', 'requests', 10, 5, 0, 'request10'),
  ('request25', 'requests', 25, 10, 0, 'request25'),
  ('request50', 'requests', 50, 20, 0, 'request50'),
  ('request100', 'requests', 100, 35, 0, 'request100'),
  ('request250', 'requests', 250, 50, 0, 'request250'),
  ('firstCompletion', 'completed', 1, 0, 1, 'firstCompletion'),
  ('completion3', 'completed', 3, 3, 0, 'completion3'),
  ('completion5', 'completed', 5, 0, 1, 'completion5'),
  ('completion10', 'completed', 10, 10, 0, 'completion10'),
  ('completion25', 'completed', 25, 0, 2, 'completion25'),
  ('completion50', 'completed', 50, 30, 0, 'completion50'),
  ('completion100', 'completed', 100, 0, 3, 'completion100'),
  ('firstPaidRequest', 'paid', 1, 0, 1, 'firstPaidRequest'),
  ('paid3', 'paid', 3, 0, 1, 'paid3'),
  ('paid5', 'paid', 5, 0, 2, 'paid5'),
  ('paid10', 'paid', 10, 0, 2, 'paid10'),
  ('paid25', 'paid', 25, 0, 3, 'paid25'),
  ('paid50', 'paid', 50, 0, 5, 'paid50'),
  ('votesCast1', 'votes', 1, 1, 0, 'votesCast1'),
  ('votesCast10', 'votes', 10, 3, 0, 'votesCast10'),
  ('votesCast25', 'votes', 25, 5, 0, 'votesCast25'),
  ('votesCast50', 'votes', 50, 10, 0, 'votesCast50'),
  ('votesCast100', 'votes', 100, 20, 0, 'votesCast100'),
  ('votesCast250', 'votes', 250, 35, 0, 'votesCast250'),
  ('votesCast500', 'votes', 500, 50, 0, 'votesCast500'),
  ('votesCast1000', 'votes', 1000, 0, 2, 'votesCast1000'),
  ('top10', 'leaderboard', 10, 10, 0, 'top10'),
  ('top5', 'leaderboard', 5, 20, 0, 'top5'),
  ('podium', 'leaderboard', 3, 0, 1, 'podium'),
  ('runnerUp', 'leaderboard', 2, 30, 0, 'runnerUp'),
  ('champion', 'leaderboard', 1, 0, 3, 'champion')
on conflict (id) do update set
  source = excluded.source,
  threshold = excluded.threshold,
  bonus_votes = excluded.bonus_votes,
  bonus_requests = excluded.bonus_requests,
  badge = excluded.badge,
  active = true;

-- 2. The three special items go away only while nobody holds them (checked
--    above) and only here, before the CHECK narrows again.
delete from public.achievement_definitions
 where id in ('firstPick','firstVoteBack','firstMystery');

-- 3. Narrow the source CHECK back to the original six sources.
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
  check (source in ('streak','requests','completed','paid','votes','leaderboard'));

-- 4. The 20261125 claim body, verbatim (no cap integration, no new sources).
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

notify pgrst, 'reload schema';
commit;
