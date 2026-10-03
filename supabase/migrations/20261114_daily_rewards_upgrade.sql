-- BEGIN DAILY REWARDS UPGRADE: mirror 20261114_daily_rewards_upgrade.sql
-- Run AFTER 20261113_calendar_kpop_quiz.sql. Check-in calendar gains real
-- multi-month history + streak stats, and the quiz gains a bigger, categorised
-- K-pop bank that avoids repeating the player's recent questions.
-- Reward rules are unchanged (+2 check-in, +1 per correct answer, max +3).
-- No wallet/ledger/session changes and no backfilled rewards. Rerunnable.
begin;

-- Categories only label questions for the player. The column is additive and
-- never part of scoring, so existing rows keep a safe default.
alter table public.daily_quiz_questions
  add column if not exists category text not null default 'Songs';

update public.daily_quiz_questions set category = 'Songs'
where id in ('kpop-easy-dynamite','kpop-easy-ddudu','kpop-easy-tt','kpop-easy-gangnam',
  'kpop-easy-solo','kpop-easy-lalisa','kpop-easy-jungkook','kpop-easy-s-class',
  'kpop-easy-gods-menu','kpop-easy-super-shy','kpop-easy-hype-boy','kpop-easy-love-dive',
  'kpop-easy-next-level','kpop-easy-wannabe','kpop-easy-antifragile','kpop-easy-bang-chan',
  'kpop-easy-red-flavor');
update public.daily_quiz_questions set category = 'Groups'
where id in ('kpop-easy-bts-count','kpop-easy-blackpink-count','kpop-easy-twice-count');
update public.daily_quiz_questions set category = 'Fandom'
where id in ('kpop-easy-army','kpop-easy-blink','kpop-easy-once','kpop-easy-stay');

-- More easy, familiar K-pop questions: hooks/lyrics, songs, members, fandoms.
-- ON CONFLICT DO NOTHING keeps later editorial edits and never resets scores.
insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation, category) values
  ('kpop-lyric-stars', 'Which K-pop song has the hook “''Cause I-I-I''m in the stars tonight”?', '["Dynamite","Butter","Life Goes On","Boy With Luv"]', 0, '“Dynamite” opens with that line. It is one of BTS''s biggest hits.', 'Lyrics'),
  ('kpop-lyric-butter', 'Which K-pop song says “Smooth like butter, like a criminal undercover”?', '["Butter","Dynamite","Fake Love","IDOL"]', 0, 'That is the opening line of “Butter” by BTS.', 'Lyrics'),
  ('kpop-lyric-ddu-du', 'Which BLACKPINK song repeats “ddu-du ddu-du du”?', '["Whistle","DDU-DU DDU-DU","As If It''s Your Last","Boombayah"]', 1, 'The hook gives “DDU-DU DDU-DU” its name.', 'Lyrics'),
  ('kpop-lyric-shy', 'Which TWICE song has the famous “shy, shy, shy” hook?', '["TT","CHEER UP","LIKEY","What is Love?"]', 1, '“CHEER UP” is known for its “shy shy shy” chorus.', 'Lyrics'),
  ('kpop-lyric-gangnam', 'Which K-pop global hit includes “Oppan Gangnam Style”?', '["Gangnam Style","Gentleman","Daddy","Hangover"]', 0, 'PSY''s “Gangnam Style” made that phrase world-famous.', 'Lyrics'),
  ('kpop-lyric-super-shy', 'Which NewJeans song repeats “I''m super shy, super shy”?', '["Ditto","Hype Boy","Super Shy","Cool With You"]', 2, '“Super Shy” became a viral TikTok hook in 2023.', 'Lyrics'),
  ('kpop-lyric-love-dive', 'Which IVE song repeats “LOVE DIVE” in its chorus?', '["LOVE DIVE","ELEVEN","After LIKE","Kitsch"]', 0, '“LOVE DIVE” was IVE''s breakout hit.', 'Lyrics'),
  ('kpop-lyric-wannabe', 'Which ITZY song sings “I wanna be me, me, me”?', '["WANNABE","DALLA DALLA","ICY","Not Shy"]', 0, '“WANNABE” is one of ITZY''s best-known songs.', 'Lyrics'),
  ('kpop-lyric-antifragile', 'Which LE SSERAFIM song has the hook “Anti-ti-ti-ti fragile”?', '["ANTIFRAGILE","FEARLESS","UNFORGIVEN","EASY"]', 0, 'LE SSERAFIM sing that hook in “ANTIFRAGILE”.', 'Lyrics'),
  ('kpop-lyric-red-flavor', 'Which Red Velvet song repeats “Red Flavor” as its hook?', '["Red Flavor","Russian Roulette","Bad Boy","Psycho"]', 0, '“Red Flavor” is a summer hit by Red Velvet.', 'Lyrics'),
  ('kpop-lyric-next-level', 'Which aespa song says “I''m on the Next Level”?', '["Next Level","Black Mamba","Savage","Supernova"]', 0, '“Next Level” made aespa widely known.', 'Lyrics'),
  ('kpop-lyric-maniac', 'Which Stray Kids song repeats “MANIAC” in its chorus?', '["MANIAC","God''s Menu","Thunderous","CASE 143"]', 0, '“MANIAC” is the title track of Stray Kids'' ODDINARY.', 'Lyrics'),
  ('kpop-lyric-cupid', 'Which K-pop group released the viral song “Cupid”?', '["FIFTY FIFTY","IVE","aespa","Kep1er"]', 0, '“Cupid” by FIFTY FIFTY went viral worldwide in 2023.', 'Lyrics'),
  ('kpop-song-boy-with-luv', '“Boy With Luv” is a BTS collaboration with which artist?', '["Halsey","Selena Gomez","Dua Lipa","Camila Cabello"]', 0, 'BTS recorded “Boy With Luv” with Halsey.', 'Songs'),
  ('kpop-song-eleven', 'Which K-pop girl group debuted with the song “ELEVEN”?', '["IVE","aespa","ITZY","NMIXX"]', 0, 'IVE debuted in 2021 with “ELEVEN”.', 'Songs'),
  ('kpop-song-tomboy', 'Which K-pop group released the hit song “TOMBOY”?', '["(G)I-DLE","ITZY","MAMAMOO","Red Velvet"]', 0, '“TOMBOY” is a 2022 hit by (G)I-DLE.', 'Songs'),
  ('kpop-song-maria', '“MARÍA” is a solo hit by which MAMAMOO member?', '["Hwasa","Solar","Wheein","Moonbyul"]', 0, 'Hwasa released “MARÍA” as a solo artist.', 'Songs'),
  ('kpop-song-ditto', 'Which K-pop group released the song “Ditto”?', '["NewJeans","IVE","LE SSERAFIM","aespa"]', 0, 'NewJeans released “Ditto” in December 2022.', 'Songs'),
  ('kpop-song-psycho', 'Which K-pop girl group sings “Psycho”?', '["Red Velvet","BLACKPINK","TWICE","aespa"]', 0, '“Psycho” is one of Red Velvet''s signature songs.', 'Songs'),
  ('kpop-song-lilac', 'Which K-pop solo artist released the hit song “LILAC”?', '["IU","Taeyeon","Sunmi","Hwasa"]', 0, 'IU released “LILAC” in 2021.', 'Songs'),
  ('kpop-song-flower', 'Which BLACKPINK member released the solo song “Flower”?', '["Jisoo","Jennie","Rosé","Lisa"]', 0, '“Flower” is Jisoo''s solo single.', 'Songs'),
  ('kpop-song-girls', '“Girls” is a 2022 title track by which K-pop group?', '["aespa","ITZY","EVERGLOW","STAYC"]', 0, 'aespa released “Girls” in 2022.', 'Songs'),
  ('kpop-member-leader-bts', 'Who is the leader of BTS?', '["RM","Jin","SUGA","j-hope"]', 0, 'RM is the leader of BTS.', 'Members'),
  ('kpop-member-maknae-bts', 'Who is the youngest member (maknae) of BTS?', '["Jungkook","V","Jimin","Jin"]', 0, 'Jungkook, born in 1997, is the maknae of BTS.', 'Members'),
  ('kpop-member-maknae-blackpink', 'Who is the maknae (youngest member) of BLACKPINK?', '["Lisa","Rosé","Jennie","Jisoo"]', 0, 'Lisa, born in 1997, is the youngest BLACKPINK member.', 'Members'),
  ('kpop-member-leader-twice', 'Who is the leader of TWICE?', '["Jihyo","Nayeon","Sana","Mina"]', 0, 'Jihyo is the leader of TWICE.', 'Members'),
  ('kpop-member-pop', 'Which TWICE member released the solo song “POP!”?', '["Nayeon","Jihyo","Momo","Dahyun"]', 0, '“POP!” is Nayeon''s solo debut single.', 'Members'),
  ('kpop-member-winter-bear', 'Which BTS member released the solo song “Winter Bear”?', '["V","Jin","Jungkook","RM"]', 0, 'V released “Winter Bear” as a solo track.', 'Members'),
  ('kpop-member-seven', 'Which BTS member sings the solo hit “Seven”?', '["Jungkook","Jimin","RM","SUGA"]', 0, '“Seven” is Jungkook''s solo single featuring Latto.', 'Members'),
  ('kpop-member-hanni', 'Which member of NewJeans is known for singing “Hype Boy”''s opening?', '["Hanni","Minji","Danielle","Haerin"]', 0, 'Hanni is one of NewJeans'' most recognisable vocalists.', 'Members'),
  ('kpop-fandom-nctzen', 'What are the fans of K-pop group NCT called?', '["NCTzen","MY","ReVeluv","MIDZY"]', 0, 'NCT''s fandom name is NCTzen.', 'Fandom'),
  ('kpop-fandom-midzy', 'What are ITZY fans called?', '["MIDZY","MY","DIVE","Atiny"]', 0, 'ITZY''s fandom name is MIDZY.', 'Fandom'),
  ('kpop-fandom-my', 'What are aespa fans called?', '["MY","DIVE","NCTzen","MOA"]', 0, 'aespa''s fandom name is MY.', 'Fandom'),
  ('kpop-fandom-dive', 'What are IVE fans called?', '["DIVE","MIDZY","BUDDY","MOA"]', 0, 'IVE''s fandom name is DIVE.', 'Fandom'),
  ('kpop-fandom-moa', 'What are the fans of K-pop group TXT called?', '["MOA","CARAT","Atiny","ENGENE"]', 0, 'TXT''s fandom name is MOA.', 'Fandom'),
  ('kpop-fandom-carat', 'What are the fans of K-pop group SEVENTEEN called?', '["CARAT","MOA","ENGENE","STAY"]', 0, 'SEVENTEEN''s fandom name is CARAT.', 'Fandom'),
  ('kpop-fandom-engene', 'What are the fans of K-pop group ENHYPEN called?', '["ENGENE","MOA","CARAT","Atiny"]', 0, 'ENHYPEN''s fandom name is ENGENE.', 'Fandom'),
  ('kpop-fandom-reveluv', 'What are Red Velvet fans called?', '["ReVeluv","MY","DIVE","BLINK"]', 0, 'Red Velvet''s fandom name is ReVeluv.', 'Fandom'),
  ('kpop-fandom-atiny', 'What are the fans of K-pop group ATEEZ called?', '["ATINY","ENGENE","CARAT","MOA"]', 0, 'ATINY blends ATEEZ and destiny.', 'Fandom')
on conflict (id) do nothing;

/* Research pass: the K-pop formats fans play most (boy/girl group, group
   leader, maknae, stage vs. real name, fandom name, finishing a song title),
   written from scratch at beginner difficulty. Facts checked against public
   group profiles; no third-party question text is copied. */
insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation, category) values
  ('kpop-group-gender-blackpink', 'Is BLACKPINK a girl group or a boy group?', '["Girl group","Boy group","Co-ed group","Solo act"]', 0, 'BLACKPINK is a four-member girl group from YG Entertainment.', 'Groups'),
  ('kpop-group-gender-bts', 'Is BTS a boy group or a girl group?', '["Boy group","Girl group","Co-ed group","Dance crew"]', 0, 'BTS is a seven-member boy group that debuted in 2013.', 'Groups'),
  ('kpop-group-gender-kard', 'Which of these K-pop groups is co-ed?', '["KARD","SEVENTEEN","TWICE","aespa"]', 0, 'KARD has both male and female members, which is rare in K-pop.', 'Groups'),
  ('kpop-group-count-seventeen', 'How many members does SEVENTEEN have?', '["13","17","7","9"]', 0, 'SEVENTEEN has 13 members in three units — the name comes from 13 members + 3 units + 1 team.', 'Groups'),
  ('kpop-group-count-straykids', 'How many members does Stray Kids have today?', '["8","9","7","6"]', 0, 'Stray Kids promotes with eight members after Woojin left in 2019.', 'Groups'),
  ('kpop-company-blackpink', 'Which company debuted BLACKPINK?', '["YG Entertainment","JYP Entertainment","SM Entertainment","KQ Entertainment"]', 0, 'BLACKPINK is YG Entertainment''s girl group.', 'Groups'),
  ('kpop-company-twice', 'Which company formed TWICE?', '["JYP Entertainment","YG Entertainment","SM Entertainment","HYBE"]', 0, 'TWICE was formed by JYP Entertainment through Sixteen.', 'Groups'),
  ('kpop-company-aespa', 'Which company debuted aespa?', '["SM Entertainment","JYP Entertainment","YG Entertainment","Pledis"]', 0, 'aespa debuted under SM Entertainment in 2020.', 'Groups'),
  ('kpop-company-ateez', 'Which company debuted ATEEZ?', '["KQ Entertainment","SM Entertainment","JYP Entertainment","Starship"]', 0, 'ATEEZ debuted under KQ Entertainment in October 2018.', 'Groups'),
  ('kpop-debut-bts-year', 'In which year did BTS debut?', '["2013","2015","2010","2018"]', 0, 'BTS debuted on 13 June 2013 with "No More Dream".', 'Groups'),
  ('kpop-leader-shinee', 'Who is the leader of SHINee?', '["Onew","Key","Minho","Taemin"]', 0, 'Onew is the leader of SHINee.', 'Members'),
  ('kpop-leader-redvelvet', 'Who is the leader of Red Velvet?', '["Irene","Seulgi","Wendy","Joy"]', 0, 'Irene is the leader of Red Velvet.', 'Members'),
  ('kpop-leader-itzy', 'Who is the leader of ITZY?', '["Yeji","Lia","Ryujin","Yuna"]', 0, 'Yeji is the leader of ITZY.', 'Members'),
  ('kpop-leader-aespa', 'Who is the leader of aespa?', '["Karina","Giselle","Winter","Ningning"]', 0, 'Karina is the leader of aespa.', 'Members'),
  ('kpop-leader-ateez', 'Who is the leader and producer of ATEEZ?', '["Hongjoong","Seonghwa","Yunho","Jongho"]', 0, 'Hongjoong leads ATEEZ and produces much of their music.', 'Members'),
  ('kpop-leader-enhypen', 'Who is the leader of ENHYPEN?', '["Jungwon","Heeseung","Jay","Ni-ki"]', 0, 'Jungwon is the leader of ENHYPEN.', 'Members'),
  ('kpop-leader-gidle', 'Who is the leader of (G)I-DLE?', '["Soyeon","Miyeon","Minnie","Yuqi"]', 0, 'Soyeon leads (G)I-DLE and writes many of their songs.', 'Members'),
  ('kpop-maknae-newjeans', 'Who is the maknae (youngest member) of NewJeans?', '["Hyein","Haerin","Danielle","Minji"]', 0, 'Hyein, born in 2008, is the youngest NewJeans member.', 'Members'),
  ('kpop-maknae-itzy', 'Who is the maknae of ITZY?', '["Yuna","Yeji","Chaeryeong","Ryujin"]', 0, 'Yuna is the youngest member of ITZY.', 'Members'),
  ('kpop-maknae-seventeen', 'Who is the maknae of SEVENTEEN?', '["Dino","Vernon","Woozi","Hoshi"]', 0, 'Dino is the youngest member of SEVENTEEN.', 'Members'),
  ('kpop-realname-v', 'Which BTS member''s real name is Kim Tae-hyung?', '["V","RM","Jimin","Jin"]', 0, 'V was born Kim Tae-hyung.', 'Members'),
  ('kpop-realname-lisa', 'Which BLACKPINK member''s real first name is Lalisa?', '["Lisa","Jennie","Rosé","Jisoo"]', 0, 'Lisa was born Pranpriya, later Lalisa Manobal.', 'Members'),
  ('kpop-realname-jungkook', 'Which BTS member''s real name is Jeon Jung-kook?', '["Jungkook","Jimin","SUGA","Jin"]', 0, 'Jungkook''s full name is Jeon Jung-kook.', 'Members'),
  ('kpop-fandom-exo-l', 'What are the fans of K-pop group EXO called?', '["EXO-L","EXO-M","EXO-K","Eris"]', 0, 'EXO-L stands for EXO-Love.', 'Fandom'),
  ('kpop-fandom-bunnies', 'What are NewJeans fans called?', '["Bunnies","Tokkis","Carats","DIVE"]', 0, 'NewJeans'' fandom name is Bunnies.', 'Fandom'),
  ('kpop-fandom-shawol', 'What are SHINee fans called?', '["Shawol","SHINee World","Shawols","SHINeez"]', 0, 'Shawol comes from "SHINee World".', 'Fandom'),
  ('kpop-fandom-monbebe', 'What are MONSTA X fans called?', '["MONBEBE","MONSTA","Monbebes","X-Lovers"]', 0, 'MONBEBE mixes MONSTA X with the French word bébé.', 'Fandom'),
  ('kpop-fandom-neverland', 'What are (G)I-DLE fans called?', '["NEVERLAND","Idleland","DLE","Neverlands"]', 0, 'NEVERLAND is the (G)I-DLE fandom, after Peter Pan.', 'Fandom'),
  ('kpop-fandom-moomoo', 'What are MAMAMOO fans called?', '["Moomoo","Mamamoo","Moomoos","Moo"]', 0, 'MAMAMOO''s fandom name is Moomoo.', 'Fandom'),
  ('kpop-fandom-sone', 'What are Girls'' Generation fans called?', '["SONE","SoShi","Girls","Soshi"]', 0, 'SONE comes from the Korean word for "wish".', 'Fandom'),
  ('kpop-fandom-vip', 'What are BIGBANG fans called?', '["VIP","Bang","Big","V.I.P"]', 0, 'BIGBANG''s fandom name is VIP.', 'Fandom'),
  ('kpop-title-blood-sweat', 'Finish this BTS song title: "Blood Sweat & ___"', '["Tears","Fears","Years","Dreams"]', 0, 'The 2016 hit is "Blood Sweat & Tears".', 'Lyrics'),
  ('kpop-title-fake-love', 'Finish this BTS song title: "Fake ___"', '["Love","Hope","Smile","Friends"]', 0, '"Fake Love" was released in 2018.', 'Lyrics'),
  ('kpop-title-kill-this-love', 'Finish this BLACKPINK song title: "Kill This ___"', '["Love","Pain","Night","Beat"]', 0, '"Kill This Love" is a 2019 BLACKPINK single.', 'Lyrics'),
  ('kpop-title-boy-with-luv', 'Finish this BTS song title: "Boy With ___"', '["Luv","Love","You","Us"]', 0, '"Boy With Luv" features Halsey.', 'Lyrics'),
  ('kpop-title-dalla-dalla', 'Which K-pop group debuted with the song "DALLA DALLA"?', '["ITZY","aespa","IVE","NMIXX"]', 0, 'ITZY debuted in 2019 with "DALLA DALLA".', 'Lyrics')
on conflict (id) do nothing;

-- Without at least three active questions a round cannot start.
do $$
begin
  if (select count(*) from public.daily_quiz_questions where active) < 3 then
    raise exception 'err.dailySetup';
  end if;
end $$;

/* Same sanitized payload as before, plus lifetime/streak check-in statistics
   and question categories. Statistics are read-only: nothing here awards a
   reward, and a streak is only a display counter. */
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
      ), '[]'::jsonb),
      'total_days', coalesce(st.total_days, 0),
      'first_day', st.first_day,
      -- A streak stays alive until the end of the next day, then restarts.
      'streak', case when st.last_day is null or st.last_day < d.day - 1 then 0 else st.run end,
      'best_streak', coalesce(st.best_streak, 0)),
    'earned_today', coalesce(l.reward, 0) + coalesce(a.score, 0),
    'quiz', case when a.id is null then null else jsonb_build_object(
      'attempt_id', a.id,
      'completed', a.completed_at is not null,
      'score', a.score,
      'reward', a.score,
      'answers', to_jsonb(a.answers),
      'questions', (
        select jsonb_agg(
          jsonb_build_object('id', q.item->'id', 'prompt', q.item->'prompt', 'options', q.item->'options',
            'category', coalesce(q.item->>'category', 'Songs'))
          || case when a.completed_at is not null
             then jsonb_build_object('correct_option', q.item->'correct_option', 'explanation', q.item->'explanation')
             else '{}'::jsonb end
          order by q.ord
        ) from jsonb_array_elements(a.questions) with ordinality as q(item, ord)
      )
    ) end
  ) from d
  join public.profiles p on p.id = p_uid
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
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day
  left join public.daily_quiz_attempts a on a.user_id = p_uid and a.quiz_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

-- Do not hand the same questions back day after day: prefer active questions
-- the player has not seen in the last 30 days, then fall back to any active
-- question. Scoring, rewards and the frozen snapshot are unchanged.
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
      'correct_option', q.correct_option, 'explanation', q.explanation, 'category', q.category)
      order by q.seen, q.draw)
      into v_questions
    from (
      select b.*, random() as draw,
             case when exists (
               select 1 from public.daily_quiz_attempts a,
                    jsonb_array_elements(a.questions) item
               where a.user_id = v_uid and a.quiz_day > v_day - 30
                 and item->>'id' = b.id
             ) then 1 else 0 end as seen
      from public.daily_quiz_questions b
      where b.active
      order by seen, draw
      limit 3
    ) q;
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

/* Calendar browsing for any month, owner-scoped and read-only. It returns the
   real check-in ledger only, never activity/streak rows, and never awards a
   reward. Days after the server's Vietnam day are simply absent. */
create or replace function public.my_daily_checkin_month(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
  v_from date;
  v_to date;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_month is null then raise exception 'err.dailyDayChanged'; end if;
  v_day := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_from := date_trunc('month', p_month)::date;
  v_to := (date_trunc('month', v_from) + interval '1 month - 1 day')::date;
  if v_to > v_day then v_to := v_day; end if;
  return jsonb_build_object(
    'user_id', v_uid,
    'month', to_char(v_from, 'YYYY-MM'),
    'day', v_day,
    'days', coalesce((
      select jsonb_agg(c.reward_day order by c.reward_day)
      from public.daily_login_rewards c
      where c.user_id = v_uid and c.reward_day >= v_from and c.reward_day <= v_to
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.my_daily_checkin_month(date) from public, anon, authenticated;
grant execute on function public.my_daily_checkin_month(date) to authenticated;

notify pgrst, 'reload schema';
commit;
