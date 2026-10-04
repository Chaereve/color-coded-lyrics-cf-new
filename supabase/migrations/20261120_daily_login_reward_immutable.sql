-- BEGIN DAILY LOGIN REWARD IMMUTABLE: mirror 20261120_daily_login_reward_immutable.sql
-- Run AFTER 20261119_preserve_legacy_daily_login_rewards.sql.
-- Append-only, one transaction, rerunnable.
--
-- What changes and why
-- --------------------
-- 20261119 stopped the +2 check-in reward without rewriting history, but its
-- trigger still allowed an UPDATE that changed a legacy amount from 2 to 0.
-- "Correcting" a value downwards does not create votes, yet it still edits the
-- audit trail: after such an UPDATE nobody can tell whether that check-in was
-- ever worth 2. A recorded amount is history, not a setting.
--
-- This migration makes the recorded amount immutable:
--   * INSERT          must carry reward = 0 (a new check-in never pays).
--   * UPDATE OF reward is rejected whenever the value would change at all
--     (2 -> 0, 0 -> 2, 2 -> 5, 0 -> 1 …). Error: err.dailyLoginRewardImmutable.
--   * An UPDATE that does not touch reward, or that re-saves the same value,
--     is untouched: the trigger does not fire, or has nothing to object to.
-- Historical rows are never modified here: no UPDATE, no DELETE, no backfill,
-- and no table-wide CHECK (reward = 0), because valid legacy rows carry 2.
--
-- Exceptional data repair (documented, NOT an application path)
-- -------------------------------------------------------------
-- Nothing in the app, the RPCs, the frontend or an authenticated role can edit
-- a recorded amount. If a repair is ever required, it is an administrator-only,
-- one-off migration that:
--   1. records before/after values (row count per amount, and the affected
--      user_id / reward_day pairs) in that migration's own audit output;
--   2. runs inside one transaction with the trigger disabled for the duration
--      of the statement only, e.g.
--        alter table public.daily_login_rewards disable trigger daily_login_rewards_no_vote;
--        -- audited repair UPDATE
--        alter table public.daily_login_rewards enable  trigger daily_login_rewards_no_vote;
--   3. re-enables the trigger in the same transaction and never leaves a
--      general-purpose path open afterwards.
begin;

-- The recorded amount is immutable. New rows are created with 0; existing rows
-- keep whatever they recorded on their own day.
create or replace function public.daily_login_rewards_no_vote()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- A new check-in may only ever be recorded with no amount at all.
    if new.reward is distinct from 0 then
      raise exception 'err.dailyLoginRewardImmutable';
    end if;
  elsif new.reward is distinct from old.reward then
    -- Any change of a recorded amount rewrites history: 2 -> 0 hides that the
    -- check-in once paid, and 0 -> 2 would invent a payment. Both are refused.
    raise exception 'err.dailyLoginRewardImmutable';
  end if;
  return new;
end $$;

-- Re-declared so the trigger definition matches even if it was altered by hand.
drop trigger if exists daily_login_rewards_no_vote on public.daily_login_rewards;
create trigger daily_login_rewards_no_vote
before insert or update of reward on public.daily_login_rewards
for each row execute function public.daily_login_rewards_no_vote();

-- No application path may write this table: RLS, revoked client privileges, and
-- no write policy. The security-definer RPC is the only intended writer.
alter table public.daily_login_rewards enable row level security;
revoke all on public.daily_login_rewards from public, anon, authenticated;
grant all on public.daily_login_rewards to service_role;
do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'daily_login_rewards'
                and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')) then
    raise exception 'daily_login_rewards must stay writable through claim_daily_login only';
  end if;
end $$;

comment on column public.daily_login_rewards.reward is
  'Immutable recorded amount: 2 for rows written under the retired policy, 0 for every check-in from that policy onward. Never re-awarded, never summed, never editable by application code (err.dailyLoginRewardImmutable); repairs are administrator-only migrations with before/after audit logging.';

notify pgrst, 'reload schema';
commit;
