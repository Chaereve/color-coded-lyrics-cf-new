
-- BEGIN DAILY QUIZ SCHEMA: mirror 20261115_daily_quiz_schema.sql
-- Five-question Daily Quiz — tables, columns, constraints and configuration.
-- Run AFTER 20261114_daily_rewards_upgrade.sql, BEFORE
-- 20261116_daily_quiz_rpcs.sql. Rerunnable.
--
-- The quiz can only draw from source-validated questions: the 99 legacy bank
-- questions stay in the table for non-voting practice/legacy use and are
-- marked so that no code path can mistake them for production material. They
-- can be promoted one at a time after research (see docs/DAILY-QUIZ-PLAN.md).
begin;


-- =========================================================
-- 1. CONFIGURATION
-- =========================================================
-- One row per switch. Everything the product owner may need to change later
-- lives here; nothing below hard-codes a reward, a quota or a flag.
create table if not exists public.daily_quiz_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.daily_quiz_config enable row level security;
revoke all on public.daily_quiz_config from public, anon, authenticated;
grant all on public.daily_quiz_config to service_role;

insert into public.daily_quiz_config (key, value) values
  -- Set size and difficulty mix -------------------------------------------
  ('questions_per_day',          '5'),
  ('easy_count',                 '2'),
  ('medium_count',               '3'),
  ('hard_count',                 '0'),
  ('hard_question_enabled',      'false'),
  ('max_hard_per_set',           '1'),
  ('min_hard_pool_to_enable',    '30'),
  -- Diversity --------------------------------------------------------------
  ('min_distinct_artists',       '3'),
  ('max_per_artist',             '2'),
  ('min_profile',                '1'),
  ('min_lyrics',                 '1'),
  ('max_true_false',             '1'),
  ('max_lyrics_keyword',         '1'),
  -- Quality gates ---------------------------------------------------------
  ('repeat_cooldown_days',       '90'),
  ('freshness_days',             '30'),
  ('min_quality_score',          '97'),
  ('max_source_redirects',       '3'),
  -- Votes -----------------------------------------------------------------
  ('daily_vote_cap',             '5'),
  ('free_vote_grant_enabled',    'false'),
  ('free_votes_per_day',         '3'),
  ('global_daily_vote_cap_enabled', 'false'),
  ('global_daily_vote_cap',      '5'),
  -- Legacy bank: kept for practice only, never for votes -------------------
  ('legacy_pool_enabled',        'false')
on conflict (key) do nothing;

-- Typed readers. Defaults are the safe side of every switch: a missing or
-- unreadable row must never widen the pool or raise a cap.
create or replace function public.daily_quiz_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::int from public.daily_quiz_config where key = p_key), p_default)
$$;

create or replace function public.daily_quiz_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::boolean from public.daily_quiz_config where key = p_key), p_default)
$$;

create or replace function public.daily_quiz_num(p_key text)
returns float8 language sql stable security definer set search_path = public as $$
  select (select nullif(value #>> '{}', '')::float8 from public.daily_quiz_config where key = p_key)
$$;

revoke all on function public.daily_quiz_int(text,int),
                       public.daily_quiz_bool(text,boolean),
                       public.daily_quiz_num(text) from public, anon, authenticated;

-- =========================================================
-- 2. QUESTION BANK: source, review and diversity metadata
-- =========================================================
alter table public.daily_quiz_questions
  add column if not exists option_ids        text[] not null default array['opt-a','opt-b','opt-c','opt-d'],
  add column if not exists artist            text,
  add column if not exists difficulty        text not null default 'easy',
  add column if not exists sub_category      text not null default 'profile',
  add column if not exists question_type     text not null default 'mcq',
  add column if not exists fact_key          text,
  add column if not exists song_key          text,
  add column if not exists quality_score     int,
  add column if not exists approval_status   text not null default 'draft',
  add column if not exists daily_eligibility_status text not null default 'ineligible',
  add column if not exists retirement_status text not null default 'active',
  add column if not exists source_url        text,
  add column if not exists source_initial_http_status text,
  add column if not exists source_final_http_status   text,
  add column if not exists source_final_url           text,
  add column if not exists source_redirect_count      text,
  add column if not exists source_access_status       text,
  add column if not exists source_fact_match          text,
  add column if not exists source_last_checked        date,
  add column if not exists safety_flags      text[] not null default '{}',
  add column if not exists copyright_flags   text[] not null default '{}',
  add column if not exists duplicate_of      text references public.daily_quiz_questions(id);

-- The 99 legacy questions have never been source-validated. Mark them as what
-- they are so no code path can mistake them for production material. They stay
-- in the table (practice/legacy use, future research) but are NOT eligible:
-- eligibility below requires approval_status = 'approved'.
update public.daily_quiz_questions
   set source_fact_match          = coalesce(source_fact_match, 'pending_external_validation'),
       source_access_status       = coalesce(source_access_status, 'unknown_not_observable'),
       source_initial_http_status = coalesce(source_initial_http_status, 'unknown_not_observable'),
       source_final_http_status   = coalesce(source_final_http_status, 'unknown_not_observable'),
       source_redirect_count      = coalesce(source_redirect_count, 'unknown_not_observable')
 where coalesce(source_final_url, '') = '';

-- Legacy rows were filed under a display category only; mirror it so the
-- future research queue can be triaged by sub-category.
update public.daily_quiz_questions
   set sub_category = 'lyrics'
 where coalesce(source_final_url, '') = ''
   and category = 'Lyrics'
   and sub_category = 'profile';

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_difficulty_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_difficulty_check
  check (difficulty in ('easy','medium','hard'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_sub_category_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_sub_category_check
  check (sub_category in ('profile','lyrics','lyrics_keyword'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_question_type_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_question_type_check
  check (question_type in ('mcq','true_false'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_approval_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_approval_check
  check (approval_status in ('draft','pending_verification','approved','rejected'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_eligibility_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_eligibility_check
  check (daily_eligibility_status in ('eligible','temporarily_ineligible','ineligible'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_retirement_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_retirement_check
  check (retirement_status in ('active','review_required','retired','superseded'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_quality_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_quality_check
  check (quality_score is null or quality_score between 0 and 100);

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_option_ids_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_option_ids_check
  check (cardinality(option_ids) = 4
     and option_ids[1] <> option_ids[2] and option_ids[1] <> option_ids[3] and option_ids[1] <> option_ids[4]
     and option_ids[2] <> option_ids[3] and option_ids[2] <> option_ids[4] and option_ids[3] <> option_ids[4]);

-- Stable option identity: an id that survives client-side shuffling. It is
-- DERIVED from the canonical order, so the frozen snapshot and the live row can
-- never disagree and no importer has to keep two fields in sync by hand.
alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_correct_id_check;
alter table public.daily_quiz_questions drop column if exists correct_option_id;
alter table public.daily_quiz_questions add column correct_option_id text
  generated always as (option_ids[correct_option + 1]) stored;

create index if not exists daily_quiz_questions_pool_idx
  on public.daily_quiz_questions (difficulty, artist)
  where approval_status = 'approved'
    and daily_eligibility_status = 'eligible'
    and retirement_status = 'active'
    and active;

-- =========================================================
-- 3. ATTEMPTS
-- =========================================================
alter table public.daily_quiz_attempts
  add column if not exists quiz_date      date,
  add column if not exists question_count int not null default 5,
  add column if not exists max_votes      int not null default 5,
  add column if not exists votes_awarded  int not null default 0,
  add column if not exists submitted_at   timestamptz,
  add column if not exists locked         boolean not null default false,
  add column if not exists selection      jsonb not null default '{}'::jsonb;

-- Historical 3-question rounds keep their real size; only new rounds are 5.
update public.daily_quiz_attempts
   set question_count = jsonb_array_length(questions)
 where question_count = 5
   and jsonb_array_length(questions) <> 5;

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_questions_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_questions_check
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) in (3,5));

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_score_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_score_check
  check (score is null or score between 0 and 5);

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_question_count_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_question_count_check
  check (question_count in (3,5));

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_max_votes_check;
-- The structural ceiling: no round can ever be worth more than 5 votes.
-- daily_quiz_config.daily_vote_cap may lower it, never raise it.
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_max_votes_check
  check (max_votes between 1 and 5);

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_votes_awarded_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_votes_awarded_check
  check (votes_awarded between 0 and 5);

-- New 5-question rounds are graded per answer in public.daily_quiz_answers, so
-- the attempt itself never carries answers/score. Legacy 3-question rounds keep
-- their original all-at-once shape untouched.
alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_completion;
alter table public.daily_quiz_attempts add constraint daily_quiz_completion check (
  (question_count = 5 and answers is null and score is null and completed_at is null
                      and ((submitted_at is null and not locked)
                           or (submitted_at is not null and locked)))
  or (question_count = 3 and (
        (completed_at is null and answers is null and score is null)
     or (completed_at is not null and answers is not null and score is not null
         and cardinality(answers) = 3)))
);

create unique index if not exists daily_quiz_attempts_user_quiz_date_idx
  on public.daily_quiz_attempts (user_id, quiz_date)
  where quiz_date is not null;

-- =========================================================
-- 4. ANSWER LEDGER — the idempotency anchor
-- =========================================================
-- One row per (user, quiz date, question). The primary key is what makes a
-- replay, a retry, a second tab or a crafted duplicate a no-op instead of a
-- second vote. question_id is intentionally NOT a foreign key: the frozen
-- snapshot is the history, and deleting an edited question must never be able
-- to delete or resurrect an award.
create table if not exists public.daily_quiz_answers (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  quiz_date    date not null,
  question_id  text not null,
  attempt_id   uuid not null references public.daily_quiz_attempts(id) on delete cascade,
  option_id    text not null,
  correct      boolean not null,
  awarded      int not null default 0 check (awarded in (0,1)),
  answered_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, quiz_date, question_id)
);

create index if not exists daily_quiz_answers_day_idx
  on public.daily_quiz_answers (user_id, quiz_date);

-- =========================================================
-- 5. REPEAT HISTORY — 90-day cooldown
-- =========================================================
create table if not exists public.daily_quiz_seen (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  question_id text not null,
  last_seen   date not null,
  primary key (user_id, question_id)
);

create index if not exists daily_quiz_seen_recent_idx
  on public.daily_quiz_seen (user_id, last_seen);

alter table public.daily_quiz_answers enable row level security;
alter table public.daily_quiz_seen enable row level security;
revoke all on public.daily_quiz_answers, public.daily_quiz_seen from public, anon, authenticated;
grant all on public.daily_quiz_answers, public.daily_quiz_seen to service_role;

notify pgrst, 'reload schema';
commit;
