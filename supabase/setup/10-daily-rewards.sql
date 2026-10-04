
-- BEGIN DAILY REWARDS: mirror 20261112_daily_rewards.sql
-- Daily login (+2) and one 3-question music quiz (+1 per correct answer).
-- Run AFTER the existing bonus, activity and security migrations. Rerunnable:
-- no historical rewards are backfilled and existing attempts are preserved.
begin;

create table if not exists public.daily_login_rewards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_day date not null,
  reward int not null default 2 check (reward = 2),
  created_at timestamptz not null default now(),
  primary key (user_id, reward_day)
);

-- Neither the question bank nor attempt snapshots may be read from REST:
-- they contain correct answers. Only the sanitized RPC payload is public.
create table if not exists public.daily_quiz_questions (
  id text primary key,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option int not null check (correct_option between 0 and 3),
  explanation text not null,
  active boolean not null default true
);

create table if not exists public.daily_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quiz_day date not null,
  -- Freeze all question content at start, including private answers. Editing
  -- or retiring a bank question cannot change an already-started round.
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 3),
  answers int[],
  score int check (score between 0 and 3),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, quiz_day),
  constraint daily_quiz_completion check (
    (completed_at is null and answers is null and score is null)
    or (completed_at is not null and answers is not null and score is not null
        and cardinality(answers) = 3)
  )
);

alter table public.daily_login_rewards enable row level security;
alter table public.daily_quiz_questions enable row level security;
alter table public.daily_quiz_attempts enable row level security;
-- No browser policies: all reading/writing goes through owner-scoped RPCs.
revoke all on public.daily_login_rewards, public.daily_quiz_questions, public.daily_quiz_attempts
  from public, anon, authenticated;
grant all on public.daily_login_rewards, public.daily_quiz_questions, public.daily_quiz_attempts
  to service_role;

-- Answers use zero-based indices, matching the browser's option values.
-- ON CONFLICT preserves editorial changes and does not reactivate old entries.
insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation) values
  ('kpop-dynamite', 'Which group released "Dynamite"?', '["EXO","BTS","SEVENTEEN","SHINee"]', 1, 'BTS released the English-language single "Dynamite" in 2020.'),
  ('kpop-ddudu', 'Which group released "DDU-DU DDU-DU"?', '["BLACKPINK","TWICE","Red Velvet","ITZY"]', 0, '"DDU-DU DDU-DU" is a BLACKPINK single from the EP Square Up.'),
  ('kpop-gods-menu', 'Which group performs "God''s Menu"?', '["ATEEZ","NCT 127","Stray Kids","MONSTA X"]', 2, '"God''s Menu" is the title track of Stray Kids'' album GO LIVE.'),
  ('kpop-ditto', 'Which group released "Ditto"?', '["IVE","aespa","LE SSERAFIM","NewJeans"]', 3, 'NewJeans released "Ditto" in December 2022.'),
  ('kpop-super', 'Which group released "Super" on the album FML?', '["BTS","SEVENTEEN","EXO","TXT"]', 1, '"Super" is one of the title tracks on SEVENTEEN''s FML.'),
  ('kpop-cheer-up', 'Which group released "CHEER UP"?', '["TWICE","GFRIEND","MAMAMOO","Apink"]', 0, 'TWICE released "CHEER UP" as the title track of Page Two.'),
  ('kpop-love-shot', 'Which group released "Love Shot"?', '["SHINee","GOT7","EXO","NCT DREAM"]', 2, 'EXO released "Love Shot" in 2018.'),
  ('kpop-psy', 'Who performs "Gangnam Style"?', '["Rain","G-DRAGON","J.Y. Park","PSY"]', 3, 'PSY released the worldwide hit "Gangnam Style" in 2012.'),
  ('kpop-maknae', 'In a K-pop group, what does "maknae" mean?', '["The leader","The youngest member","The main dancer","The oldest member"]', 1, 'Maknae is the Korean term for the youngest member of a group.'),
  ('kpop-bias', 'What does a fan usually mean by their "bias"?', '["Their favorite member","A concert ticket","An album version","A dance practice"]', 0, 'A bias is a fan''s favorite member of a group.'),
  ('kpop-comeback', 'What does a K-pop "comeback" usually refer to?', '["A member''s birthday","A fan meeting","A new music release and its promotions","A concert encore"]', 2, 'A comeback refers to a new release and the related promotional activities.'),
  ('lyrics-colors', 'What do different colors usually identify in color-coded group lyrics?', '["Album sales","Song genres","The music video location","Which member is singing"]', 3, 'Color-coded lyrics use colors to show who sings each part.'),
  ('lyrics-romanization', 'What is romanization in a lyrics video?', '["A dance tutorial","Writing another script using Latin letters","A song remix","An album review"]', 1, 'Romanization represents words from another writing system using Latin letters.'),
  ('music-bpm', 'What does BPM stand for in music?', '["Beats per minute","Bass per melody","Band performance mode","Bridge pattern meter"]', 0, 'BPM measures tempo in beats per minute.'),
  ('music-acappella', 'What is an a cappella performance?', '["An instrumental solo","A faster remix","Singing without instrumental accompaniment","A live dance performance"]', 2, 'A cappella means singing without instrumental accompaniment.'),
  ('music-chorus', 'Which section commonly repeats the main hook of a song?', '["The intro","The bridge","The outro","The chorus"]', 3, 'The chorus often repeats the song''s main hook and melody.'),
  ('music-duet', 'How many performers are featured in a duet?', '["One","Two","Three","Four"]', 1, 'A duet is a performance by two people.'),
  ('music-ep', 'What does EP stand for on a music release?', '["Extended play","Extra performance","Electronic pop","Encore playlist"]', 0, 'EP stands for extended play, typically shorter than a full-length album.'),
  ('music-mv', 'What does MV usually stand for in K-pop?', '["Main vocal","Music version","Music video","Member vote"]', 2, 'MV is the common abbreviation for music video.'),
  ('music-encore', 'What is an encore at a concert?', '["The soundcheck","The opening act","A costume change","An extra performance after the main set"]', 3, 'An encore is an additional performance after the main set ends.'),
  ('music-instrumental', 'What is usually absent from an instrumental version of a song?', '["The rhythm","The lead vocals","The melody","The instruments"]', 1, 'An instrumental version generally removes the lead vocal track.'),
  ('music-bridge', 'What is the usual purpose of a song''s bridge?', '["To introduce a contrasting section","To list the album tracks","To adjust speaker volume","To announce the singer"]', 0, 'A bridge adds contrast to the repeated verse and chorus sections.'),
  ('music-lightstick', 'What do many K-pop fans bring to concerts to light up the crowd?', '["A metronome","A microphone","A light stick","A guitar pick"]', 2, 'Fans use group-specific light sticks to support artists at concerts.'),
  ('music-cover', 'What is a cover song?', '["An album''s title page","A hidden bonus track","A song without lyrics","A performance of a song originally by another artist"]', 3, 'A cover is a new performance of a song originally recorded by another artist.')
on conflict (id) do nothing;

-- Internal-only helper. The recipient and timestamp are never client inputs
-- to this function. Correct answers/explanations appear ONLY after completion.
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day)
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'credits', p.vote_credits + p.bonus_credits,
    'purchased', p.vote_credits,
    'bonus', p.bonus_credits,
    'login', jsonb_build_object('claimed', l.user_id is not null, 'reward', 2),
    'earned_today', coalesce(l.reward, 0) + coalesce(a.score, 0),
    'quiz', case when a.id is null then null else jsonb_build_object(
      'attempt_id', a.id,
      'completed', a.completed_at is not null,
      'score', a.score,
      'reward', a.score,
      'answers', to_jsonb(a.answers),
      'questions', (
        select jsonb_agg(
          jsonb_build_object('id', q.item->'id', 'prompt', q.item->'prompt', 'options', q.item->'options')
          || case when a.completed_at is not null
             then jsonb_build_object('correct_option', q.item->'correct_option', 'explanation', q.item->'explanation')
             else '{}'::jsonb end
          order by q.ord
        ) from jsonb_array_elements(a.questions) with ordinality as q(item, ord)
      )
    ) end
  ) from d
  join public.profiles p on p.id = p_uid
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day
  left join public.daily_quiz_attempts a on a.user_id = p_uid and a.quiz_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

create or replace function public.my_daily_rewards_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'err.signin';
  end if;
  return public.daily_rewards_payload(v_uid, clock_timestamp());
end $$;
revoke all on function public.my_daily_rewards_status() from public, anon, authenticated;
grant execute on function public.my_daily_rewards_status() to authenticated;

create or replace function public.claim_daily_login(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_claim public.daily_login_rewards;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  -- The same lock as votes/spin/achievements: no lost wallet updates, even
  -- when several devices or tabs claim at once. Capture time AFTER the lock.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  select * into v_claim from public.daily_login_rewards
    where user_id = v_uid and reward_day = p_expected_day;
  v_replayed := found;
  if not v_replayed then
    -- The expected day only guards stale clicks/retries at midnight. It NEVER
    -- selects the awarded date. A browser cannot claim a past or future day.
    if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;
    insert into public.daily_login_rewards (user_id, reward_day, reward, created_at)
    values (v_uid, v_day, 2, v_now) returning * into v_claim;
    update public.profiles set bonus_credits = bonus_credits + v_claim.reward where id = v_uid;
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  return jsonb_build_object('reward', v_claim.reward, 'replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.claim_daily_login(uuid,date) from public, anon, authenticated;
grant execute on function public.claim_daily_login(uuid,date) to authenticated;

create or replace function public.start_daily_quiz(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_questions jsonb;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;
  select * into v_attempt from public.daily_quiz_attempts where user_id = v_uid and quiz_day = v_day;
  v_replayed := found;
  if not v_replayed then
    select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', q.options,
      'correct_option', q.correct_option, 'explanation', q.explanation) order by q.draw)
      into v_questions
    from (select b.*, random() as draw from public.daily_quiz_questions b
          where b.active order by draw limit 3) q;
    if v_questions is null or jsonb_array_length(v_questions) <> 3 then raise exception 'err.dailySetup'; end if;
    insert into public.daily_quiz_attempts (user_id, quiz_day, questions, created_at)
    values (v_uid, v_day, v_questions, v_now);
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  return jsonb_build_object('replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.start_daily_quiz(uuid,date) from public, anon, authenticated;
grant execute on function public.start_daily_quiz(uuid,date) to authenticated;

create or replace function public.submit_daily_quiz(p_expected_user_id uuid, p_attempt_id uuid, p_answers int[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_score int;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  -- Lock order is always profile, then attempt; identical on every quiz path.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  select * into v_attempt from public.daily_quiz_attempts
    where id = p_attempt_id and user_id = v_uid for update;
  if not found then raise exception 'err.dailyQuizSession'; end if;
  v_replayed := v_attempt.completed_at is not null;
  if not v_replayed then
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
    if v_attempt.quiz_day <> v_day then raise exception 'err.dailyDayChanged'; end if;
    if p_answers is null or cardinality(p_answers) <> 3 or array_ndims(p_answers) <> 1
       or array_lower(p_answers, 1) <> 1
       or exists (select 1 from unnest(p_answers) n where n is null or n not between 0 and 3) then
      raise exception 'err.dailyQuizAnswers';
    end if;
    -- NO client-provided score, reward, correct answers, question IDs or date.
    select count(*)::int into v_score
      from jsonb_array_elements(v_attempt.questions) with ordinality as q(item, ord)
      where (q.item->>'correct_option')::int = p_answers[q.ord::int];
    update public.daily_quiz_attempts set answers = p_answers, score = v_score, completed_at = v_now
      where id = v_attempt.id returning * into v_attempt;
    update public.profiles set bonus_credits = bonus_credits + v_score where id = v_uid;
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  -- Completed attempts replay even across midnight, without changing balances.
  return jsonb_build_object('reward', v_attempt.score, 'score', v_attempt.score, 'replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.submit_daily_quiz(uuid,uuid,int[]) from public, anon, authenticated;
grant execute on function public.submit_daily_quiz(uuid,uuid,int[]) to authenticated;

notify pgrst, 'reload schema';
commit;

-- BEGIN CHECK-IN CALENDAR / K-POP QUIZ: mirror 20261113_calendar_kpop_quiz.sql
-- Run AFTER 20261112_daily_rewards.sql. Add real current-month check-in dates
-- and replace the factory quiz bank with beginner-friendly K-pop questions.
-- No wallet/ledger/session changes. Already-started quizzes keep their frozen
-- questions and scores; these questions apply only to newly started rounds.
begin;

-- Retire only the original factory seeds, not custom editorial questions.
-- Keep every row/snapshot for historical reviews. Reruns preserve edits to
-- the new bank (ON CONFLICT DO NOTHING) and never award bonus votes.
update public.daily_quiz_questions set active = false
where id in (
  'kpop-dynamite',
  'kpop-ddudu',
  'kpop-gods-menu',
  'kpop-ditto',
  'kpop-super',
  'kpop-cheer-up',
  'kpop-love-shot',
  'kpop-psy',
  'kpop-maknae',
  'kpop-bias',
  'kpop-comeback',
  'lyrics-colors',
  'lyrics-romanization',
  'music-bpm',
  'music-acappella',
  'music-chorus',
  'music-duet',
  'music-ep',
  'music-mv',
  'music-encore',
  'music-instrumental',
  'music-bridge',
  'music-lightstick',
  'music-cover'
);

insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation) values
  ('kpop-easy-dynamite', 'Which K-pop group sings "Dynamite"?', '["BTS","BLACKPINK","TWICE","EXO"]', 0, '"Dynamite" is one of BTS’s biggest hits.'),
  ('kpop-easy-ddudu', 'Which K-pop girl group released "DDU-DU DDU-DU"?', '["TWICE","BLACKPINK","Red Velvet","ITZY"]', 1, '"DDU-DU DDU-DU" is a hit song by BLACKPINK.'),
  ('kpop-easy-army', 'What are BTS fans called?', '["BLINK","STAY","ARMY","ONCE"]', 2, 'ARMY is the official name of BTS’s fandom.'),
  ('kpop-easy-blink', 'What are BLACKPINK fans called?', '["ARMY","ONCE","STAY","BLINK"]', 3, 'BLACKPINK’s official fandom name is BLINK.'),
  ('kpop-easy-tt', 'Which K-pop girl group sings "TT"?', '["TWICE","BLACKPINK","aespa","IVE"]', 0, '"TT" is one of TWICE’s signature songs.'),
  ('kpop-easy-gangnam', 'Who sings the K-pop hit "Gangnam Style"?', '["Jungkook","PSY","G-DRAGON","J.Y. Park"]', 1, 'PSY is the artist behind "Gangnam Style".'),
  ('kpop-easy-solo', 'Which BLACKPINK member released "SOLO"?', '["Lisa","Jisoo","Jennie","Rosé"]', 2, '"SOLO" is Jennie’s debut solo single.'),
  ('kpop-easy-lalisa', 'Which BLACKPINK member sings "LALISA"?', '["Rosé","Jennie","Jisoo","Lisa"]', 3, '"LALISA" is Lisa’s solo debut song.'),
  ('kpop-easy-bts-count', 'How many members are in BTS?', '["7","4","5","9"]', 0, 'BTS has seven members: RM, Jin, SUGA, j-hope, Jimin, V and Jungkook.'),
  ('kpop-easy-blackpink-count', 'How many members are in BLACKPINK?', '["7","4","9","5"]', 1, 'BLACKPINK has four members: Jisoo, Jennie, Rosé and Lisa.'),
  ('kpop-easy-twice-count', 'How many members are in TWICE?', '["4","7","9","5"]', 2, 'TWICE has nine members.'),
  ('kpop-easy-jungkook', 'Which K-pop group is Jungkook a member of?', '["EXO","Stray Kids","SEVENTEEN","BTS"]', 3, 'Jungkook is the youngest member of BTS.'),
  ('kpop-easy-s-class', 'Which K-pop group sings "S-Class"?', '["Stray Kids","BTS","EXO","TXT"]', 0, '"S-Class" is a hit song by Stray Kids.'),
  ('kpop-easy-gods-menu', 'Which K-pop group released "God''s Menu"?', '["BTS","Stray Kids","SEVENTEEN","EXO"]', 1, '"God’s Menu" is one of Stray Kids’ best-known songs.'),
  ('kpop-easy-super-shy', 'Which K-pop girl group sings "Super Shy"?', '["IVE","aespa","NewJeans","TWICE"]', 2, '"Super Shy" is a hit song by NewJeans.'),
  ('kpop-easy-hype-boy', 'Which K-pop girl group released "Hype Boy"?', '["aespa","IVE","LE SSERAFIM","NewJeans"]', 3, '"Hype Boy" is a NewJeans song.'),
  ('kpop-easy-love-dive', 'Which K-pop girl group sings "LOVE DIVE"?', '["IVE","TWICE","BLACKPINK","ITZY"]', 0, '"LOVE DIVE" is a hit song by IVE.'),
  ('kpop-easy-next-level', 'Which K-pop girl group sings "Next Level"?', '["ITZY","aespa","Red Velvet","TWICE"]', 1, '"Next Level" is an aespa song.'),
  ('kpop-easy-wannabe', 'Which K-pop girl group released "WANNABE"?', '["TWICE","BLACKPINK","ITZY","IVE"]', 2, '"WANNABE" is one of ITZY’s best-known songs.'),
  ('kpop-easy-antifragile', 'Which K-pop girl group sings "ANTIFRAGILE"?', '["aespa","IVE","TWICE","LE SSERAFIM"]', 3, '"ANTIFRAGILE" is a hit song by LE SSERAFIM.'),
  ('kpop-easy-once', 'What are TWICE fans called?', '["ONCE","ARMY","BLINK","STAY"]', 0, 'ONCE is TWICE’s official fandom name.'),
  ('kpop-easy-stay', 'What are Stray Kids fans called?', '["ARMY","STAY","BLINK","ONCE"]', 1, 'STAY is the official name of Stray Kids’ fandom.'),
  ('kpop-easy-bang-chan', 'Which K-pop group is Bang Chan the leader of?', '["BTS","EXO","Stray Kids","TXT"]', 2, 'Bang Chan is the leader of Stray Kids.'),
  ('kpop-easy-red-flavor', 'Which K-pop girl group sings "Red Flavor"?', '["TWICE","BLACKPINK","ITZY","Red Velvet"]', 3, '"Red Flavor" is a hit song by Red Velvet.')
on conflict (id) do nothing;

-- Same private helper and sanitized answer visibility as before. Only the
-- owner’s real check-in dates are added, using the server’s Vietnam month.
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day)
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
      ), '[]'::jsonb)),
    'earned_today', coalesce(l.reward, 0) + coalesce(a.score, 0),
    'quiz', case when a.id is null then null else jsonb_build_object(
      'attempt_id', a.id,
      'completed', a.completed_at is not null,
      'score', a.score,
      'reward', a.score,
      'answers', to_jsonb(a.answers),
      'questions', (
        select jsonb_agg(
          jsonb_build_object('id', q.item->'id', 'prompt', q.item->'prompt', 'options', q.item->'options')
          || case when a.completed_at is not null
             then jsonb_build_object('correct_option', q.item->'correct_option', 'explanation', q.item->'explanation')
             else '{}'::jsonb end
          order by q.ord
        ) from jsonb_array_elements(a.questions) with ordinality as q(item, ord)
      )
    ) end
  ) from d
  join public.profiles p on p.id = p_uid
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day
  left join public.daily_quiz_attempts a on a.user_id = p_uid and a.quiz_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
