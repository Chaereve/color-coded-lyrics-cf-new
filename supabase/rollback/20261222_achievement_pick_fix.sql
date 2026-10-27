-- Rollback for 20261222_achievement_pick_fix.sql

begin;

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

      v_granted := 0;
      if d.bonus_votes > 0 then
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
