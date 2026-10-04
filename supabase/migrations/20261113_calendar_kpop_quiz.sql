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
