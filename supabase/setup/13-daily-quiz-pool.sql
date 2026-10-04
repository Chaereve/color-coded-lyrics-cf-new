
-- BEGIN DAILY QUIZ POOL: mirror 20261116_daily_quiz_pool.sql
-- Five-question Daily Quiz — the eligible pool and the sanitized payload.
-- Run AFTER 20261115_daily_quiz_schema.sql, BEFORE 20261117_daily_quiz_flow.sql.
--
-- Eligibility is decided here and nowhere else: approval, daily eligibility,
-- retirement, quality score, safety/copyright flags, duplicate marker, fact
-- match, access status, a measured final HTTP 200, a final URL, a redirect
-- count inside the limit and a fresh last-checked date. Hard questions are
-- excluded while daily_quiz_config.hard_question_enabled is false.
begin;

-- 6. ELIGIBLE POOL
-- =========================================================
-- The only place that decides whether a question may ever award a vote.
-- Legacy/unverified rows fail here on approval_status, source_fact_match and
-- the measured HTTP fields; there is no override and no relaxation.
create or replace function public.daily_quiz_candidates(p_uid uuid, p_day date)
returns table (
  id text, prompt text, options jsonb, option_ids text[], correct_option int,
  correct_option_id text, explanation text, category text, difficulty text,
  sub_category text, question_type text, artist text, fact_key text, song_key text,
  seen_recently boolean
)
language sql stable security definer set search_path = public as $$
  select q.id, q.prompt, q.options, q.option_ids, q.correct_option, q.correct_option_id,
         q.explanation, q.category, q.difficulty, q.sub_category, q.question_type,
         q.artist, q.fact_key, q.song_key,
         exists (select 1 from public.daily_quiz_seen s
                  where s.user_id = p_uid
                    and s.question_id = q.id
                    and s.last_seen > p_day - public.daily_quiz_int('repeat_cooldown_days', 90)) as seen_recently
    from public.daily_quiz_questions q
   where q.active
     and q.approval_status = 'approved'
     and q.daily_eligibility_status = 'eligible'
     and q.retirement_status = 'active'
     and q.duplicate_of is null
     and coalesce(cardinality(q.safety_flags), 0) = 0
     and coalesce(cardinality(q.copyright_flags), 0) = 0
     and coalesce(q.quality_score, 0) >= public.daily_quiz_int('min_quality_score', 97)
     and q.source_fact_match = 'pass'
     and q.source_access_status in ('public_accessible','accessible_with_redirect')
     and q.source_final_http_status = '200'
     and coalesce(q.source_final_url, '') <> ''
     and coalesce(nullif(q.source_redirect_count, '')::int, 99)
         <= public.daily_quiz_int('max_source_redirects', 3)
     and q.source_last_checked is not null
     and q.source_last_checked > p_day - public.daily_quiz_int('freshness_days', 30)
     and (q.difficulty <> 'hard'
          or (public.daily_quiz_bool('hard_question_enabled', false)
              and public.daily_quiz_bool('legacy_pool_enabled', false) is not null))
$$;
revoke all on function public.daily_quiz_candidates(uuid,date) from public, anon, authenticated;

create or replace function public.daily_quiz_pool(p_uid uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total',  count(*),
    'easy',   count(*) filter (where difficulty = 'easy'),
    'medium', count(*) filter (where difficulty = 'medium'),
    'hard',   count(*) filter (where difficulty = 'hard'))
  from public.daily_quiz_candidates(p_uid, p_day);
$$;
revoke all on function public.daily_quiz_pool(uuid,date) from public, anon, authenticated;

-- Difficulty mix for one round, clamped to what the pool can actually supply.
-- Hard questions only enter the mix when the flag is on AND the validated hard
-- pool has reached min_hard_pool_to_enable.
create or replace function public.daily_quiz_mix(p_pool jsonb)
returns table (need_easy int, need_medium int, need_hard int)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_total  int := public.daily_quiz_int('questions_per_day', 5);
  v_easy   int := public.daily_quiz_int('easy_count', 2);
  v_medium int := public.daily_quiz_int('medium_count', 3);
  v_hard   int := public.daily_quiz_int('hard_count', 0);
  v_pool_hard   int := coalesce((p_pool ->> 'hard')::int, 0);
  v_pool_medium int := coalesce((p_pool ->> 'medium')::int, 0);
  v_pool_easy   int := coalesce((p_pool ->> 'easy')::int, 0);
  v_hard_on boolean := public.daily_quiz_bool('hard_question_enabled', false)
                       and v_pool_hard >= public.daily_quiz_int('min_hard_pool_to_enable', 30);
  v_options jsonb := '[]'::jsonb;
  v_pick jsonb;
  v_seed float8;
begin
  -- Deterministic for tests: daily_quiz_config.random_seed, when present,
  -- pins the Postgres RNG for the whole session.
  v_seed := public.daily_quiz_num('random_seed');
  if v_seed is not null then perform setseed(v_seed); end if;

  v_options := v_options || jsonb_build_array(jsonb_build_array(v_easy, v_medium, v_hard));
  if v_hard_on then
    -- Ranges once hard questions are enabled: 1-2 easy / 2-3 medium / 0-1 hard.
    v_options := v_options || jsonb_build_array(
      jsonb_build_array(v_easy - 1, v_medium, v_hard + 1),
      jsonb_build_array(v_easy, v_medium - 1, v_hard + 1));
  end if;

  v_pick := v_options -> (floor(random() * jsonb_array_length(v_options))::int);
  v_hard   := least(coalesce((v_pick ->> 2)::int, 0), v_pool_hard, public.daily_quiz_int('max_hard_per_set', 1));
  v_medium := least(coalesce((v_pick ->> 1)::int, 0), v_pool_medium);
  v_easy   := greatest(0, v_total - v_hard - v_medium);
  -- Whatever easy cannot cover is pushed back onto medium, then reported as
  -- infeasible by the caller if the pool still falls short.
  if v_easy > v_pool_easy then
    v_medium := least(v_medium + (v_easy - v_pool_easy), v_pool_medium);
    v_easy   := greatest(0, v_total - v_hard - v_medium);
  end if;
  return query select v_easy, v_medium, v_hard;
end $$;
revoke all on function public.daily_quiz_mix(jsonb) from public, anon, authenticated;

-- Greedy draw with randomized retries. Returns 5 ids when the constraints can
-- be met at this relaxation level, 0 rows otherwise.
create or replace function public.daily_quiz_pick(
  p_uid uuid, p_day date,
  p_need_easy int, p_need_medium int, p_need_hard int,
  p_unseen_only boolean, p_min_artists int,
  p_require_profile boolean, p_require_lyrics boolean,
  p_attempts int default 60
)
returns table (question_id text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_max_artist int := public.daily_quiz_int('max_per_artist', 2);
  v_max_tf     int := public.daily_quiz_int('max_true_false', 1);
  v_max_lk     int := public.daily_quiz_int('max_lyrics_keyword', 1);
  v_try int;
  v_pool jsonb;
  v_item jsonb;
  v_i int;
  v_diff text;
  v_picked text[] := '{}';
  v_artists text[] := '{}';
  v_facts text[] := '{}';
  v_songs text[] := '{}';
  v_tf int;
  v_lk int;
  v_profile int;
  v_lyrics int;
  v_counts jsonb;
  v_need jsonb := jsonb_build_object('easy', p_need_easy, 'medium', p_need_medium, 'hard', p_need_hard);
begin
  for v_try in 1 .. greatest(p_attempts, 1) loop
    -- Interleave artists (row_number per artist) so the first picks naturally
    -- come from different artists, then randomize inside each artist.
    select coalesce(jsonb_agg(x.item order by x.ar, x.r), '[]'::jsonb)
      into v_pool
      from (
        select c.item, c.ar, random() as r
          from (
            select jsonb_build_object(
                     'id', q.id, 'difficulty', q.difficulty,
                     'sub_category', q.sub_category, 'question_type', q.question_type,
                     'artist', coalesce(q.artist, 'unknown'),
                     'fact', coalesce(q.fact_key, 'fact:' || q.id),
                     'song', coalesce(q.song_key, 'song:' || q.id)) as item,
                   row_number() over (partition by coalesce(q.artist, 'unknown') order by random()) as ar
              from public.daily_quiz_candidates(p_uid, p_day) q
             where (not p_unseen_only or not q.seen_recently)
          ) c
      ) x;

    v_picked  := '{}';
    v_artists := '{}';
    v_facts   := '{}';
    v_songs   := '{}';
    v_tf      := 0;
    v_lk      := 0;
    v_profile := 0;
    v_lyrics  := 0;
    v_counts  := jsonb_build_object('easy', 0, 'medium', 0, 'hard', 0);

    for v_i in 0 .. jsonb_array_length(v_pool) - 1 loop
      v_item := v_pool -> v_i;
      v_diff := v_item ->> 'difficulty';

      continue when (v_counts ->> v_diff)::int >= coalesce((v_need ->> v_diff)::int, 0);
      continue when v_item ->> 'question_type' = 'true_false' and v_tf >= v_max_tf;
      continue when v_item ->> 'sub_category' = 'lyrics_keyword' and v_lk >= v_max_lk;
      continue when (select count(*) from unnest(v_artists) a where a = v_item ->> 'artist') >= v_max_artist;
      continue when v_item ->> 'fact' = any (v_facts);
      continue when v_item ->> 'song' = any (v_songs);

      v_picked  := v_picked || (v_item ->> 'id');
      v_artists := v_artists || (v_item ->> 'artist');
      v_facts   := v_facts   || (v_item ->> 'fact');
      v_songs   := v_songs   || (v_item ->> 'song');
      v_counts  := jsonb_set(v_counts, array[v_diff], to_jsonb((v_counts ->> v_diff)::int + 1));
      if v_item ->> 'question_type' = 'true_false' then v_tf := v_tf + 1; end if;
      if v_item ->> 'sub_category' = 'lyrics_keyword' then v_lk := v_lk + 1; end if;
      if v_item ->> 'sub_category' = 'profile' then v_profile := v_profile + 1; end if;
      if v_item ->> 'sub_category' in ('lyrics','lyrics_keyword') then v_lyrics := v_lyrics + 1; end if;
    end loop;

    if coalesce(array_length(v_picked, 1), 0) = public.daily_quiz_int('questions_per_day', 5)
       and (select count(distinct a) from unnest(v_artists) a) >= p_min_artists
       and (not p_require_profile or v_profile >= public.daily_quiz_int('min_profile', 1))
       and (not p_require_lyrics or v_lyrics >= public.daily_quiz_int('min_lyrics', 1)) then
      return query select u from unnest(v_picked) u;
      return;
    end if;
  end loop;
end $$;
revoke all on function public.daily_quiz_pick(uuid,date,int,int,int,boolean,int,boolean,boolean,int)
  from public, anon, authenticated;

-- =========================================================
-- 7. SANITIZED PAYLOAD
-- =========================================================
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day),
  pool as (select public.daily_quiz_pool(p_uid, d.day) as p from d),
  mix as (select m.* from pool, public.daily_quiz_mix(pool.p) m),
  quiz_state as (
    select case
             when a.question_count <> 5 then 'retired'
             when a.locked then 'completed'
             else 'in_progress' end as state,
           a.*
      from public.daily_quiz_attempts a cross join d
     where a.user_id = p_uid and a.quiz_day = d.day
  )
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'credits', p.vote_credits + p.bonus_credits,
    'purchased', p.vote_credits,
    'bonus', p.bonus_credits,
    'login', jsonb_build_object('claimed', l.user_id is not null, 'reward', 2,
      'claimed_days', coalesce((
        select jsonb_agg(c.reward_day order by c.reward_day)
        from public.daily_login_rewards c
        where c.user_id = p_uid
          and c.reward_day >= date_trunc('month', d.day)::date
          and c.reward_day <= d.day
      ), '[]'::jsonb),
      'total_days', coalesce(st.total_days, 0),
      'first_day', st.first_day,
      'streak', case when st.last_day is null or st.last_day < d.day - 1 then 0 else st.run end,
      'best_streak', coalesce(st.best_streak, 0)),
    'earned_today', coalesce(l.reward, 0) + coalesce((select a.votes_awarded from quiz_state a), 0),
    'quiz', case
      when (select count(*) from quiz_state) = 0 then jsonb_build_object(
        'state', case when (select (p.p ->> 'total')::int from pool p) >= 5
                       and (select (p.p ->> 'easy')::int from pool p) >= (select mix.need_easy from mix)
                       and (select (p.p ->> 'medium')::int from pool p) >= (select mix.need_medium from mix)
                       and (select (p.p ->> 'hard')::int from pool p) >= (select mix.need_hard from mix)
                      then 'ready' else 'unavailable' end,
        'question_count', public.daily_quiz_int('questions_per_day', 5),
        'max_votes', public.daily_quiz_int('daily_vote_cap', 5),
        'pool', (select p.p from pool p))
      when (select state from quiz_state) = 'retired' then jsonb_build_object('state', 'retired')
      else jsonb_build_object(
        'state', (select state from quiz_state),
        'attempt_id', (select a.id from quiz_state a),
        'quiz_date', (select a.quiz_date from quiz_state a),
        'question_count', (select a.question_count from quiz_state a),
        'max_votes', (select a.max_votes from quiz_state a),
        'votes_awarded', (select a.votes_awarded from quiz_state a),
        'answered_count', (select count(*)::int from public.daily_quiz_answers w
                            where w.user_id = p_uid and w.quiz_date = d.day),
        'submitted_at', (select a.submitted_at from quiz_state a),
        'locked', (select a.locked from quiz_state a),
        'questions', (
          select jsonb_agg(
            jsonb_build_object('id', q.item ->> 'id', 'prompt', q.item ->> 'prompt',
              'options', q.item -> 'options', 'option_ids', q.item -> 'option_ids',
              'category', coalesce(q.item ->> 'category', 'Songs'),
              'difficulty', q.item ->> 'difficulty',
              'sub_category', q.item ->> 'sub_category',
              'question_type', q.item ->> 'question_type',
              'answered', w.question_id is not null)
            || case when w.question_id is null then '{}'::jsonb
               else jsonb_build_object('option_id', w.option_id, 'correct', w.correct,
                                       'awarded', w.awarded,
                                       'correct_option_id', q.item ->> 'correct_option_id',
                                       'explanation', q.item ->> 'explanation') end
            order by q.ord)
          from jsonb_array_elements((select a.questions from quiz_state a)) with ordinality as q(item, ord)
          left join public.daily_quiz_answers w
            on w.user_id = p_uid and w.quiz_date = d.day and w.question_id = q.item ->> 'id'
        )) end
  ) from d
  join public.profiles p on p.id = p_uid
  cross join pool
  left join lateral (
    select count(*)::int as total_days,
           min(c.reward_day) as first_day,
           (select max(x.reward_day) from public.daily_login_rewards x
             where x.user_id = p_uid and x.reward_day <= d.day) as last_day,
           coalesce((select max(runs.n) from (
             select count(*)::int as n from (
               select c2.reward_day - (row_number() over (order by c2.reward_day))::int as grp
               from public.daily_login_rewards c2 where c2.user_id = p_uid
             ) g group by g.grp
           ) runs), 0)::int as best_streak,
           coalesce((select count(*)::int from (
             select c3.reward_day - (row_number() over (order by c3.reward_day))::int as grp
             from public.daily_login_rewards c3
             where c3.user_id = p_uid and c3.reward_day <= d.day
           ) h group by h.grp order by h.grp desc limit 1), 0)::int as run
    from public.daily_login_rewards c
    where c.user_id = p_uid
  ) st on true
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

-- =========================================================

notify pgrst, 'reload schema';
commit;
