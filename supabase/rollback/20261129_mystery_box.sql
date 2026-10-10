-- ROLLBACK of 20261129_mystery_box.sql — remove the mystery box entirely.
-- Run AFTER reverting the app deploy (client hides the card once the RPC is
-- gone: PGRST202 maps to err.mysterySetup and the card auto-hides).
--
-- Safety rails (refuse instead of guessing, same doctrine as the 20261126
-- rollback):
--   * refuses while ANY reward_events row with source 'mystery_box' exists in
--     the last 48 hours — players are actively opening boxes and paid votes
--     are already in their wallets. SQL rollback never claws votes back; wait
--     for the window to pass or do a reviewed manual cleanup instead.
--   * refuses if the ledger is missing entirely (wrong database / order).
--   * dropping mystery_opens discards the record of boxes already opened
--     (results, not wallets) — that is the accepted cost of a rollback; the
--     reward ledger stays untouched and append-only.
--
-- Run in a transaction by an owner via psql/SQL editor.

begin;

do $$
declare
  v_recent bigint;
  v_total  bigint;
begin
  -- Ledger present? (20261126 must be applied.)
  if to_regclass('public.reward_events') is null then
    raise exception 'rollback-refused: reward_events missing - wrong database or 20261126 not applied';
  end if;

  select count(*) into v_total from public.reward_events where source = 'mystery_box';
  select count(*) into v_recent from public.reward_events
    where source = 'mystery_box' and created_at > clock_timestamp() - interval '48 hours';

  if v_recent > 0 then
    raise exception 'rollback-refused: % mystery_box grants in the last 48h (% lifetime) - wait or clean up manually', v_recent, v_total;
  end if;
end $$;

-- 1. RPCs first (a client that somehow still calls gets a clean PGRST202).
drop function if exists public.open_mystery_box(date, text);
drop function if exists public.my_mystery_status();
drop function if exists public.mystery_status(uuid, date);

-- 2. The per-day record table.
drop table if exists public.mystery_opens;

-- 3. Remove the flag and shrink the config CHECK back to the B1 key set.
delete from public.reward_config where key = 'mystery_box_enabled';
alter table public.reward_config drop constraint reward_config_value_check;
alter table public.reward_config drop constraint reward_config_key_check;
alter table public.reward_config
  add constraint reward_config_key_check check (key in (
    'login_rewards_enabled',
    'login_daily_votes',
    'login_day7_extra',
    'login_milestone7_bonus',
    'login_milestone30_bonus',
    'daily_reward_cap'));
alter table public.reward_config
  add constraint reward_config_value_check check (
    case
      when key = 'login_rewards_enabled'
        then jsonb_typeof(value) = 'boolean'
      when key in ('login_daily_votes','login_day7_extra','login_milestone7_bonus',
                   'login_milestone30_bonus','daily_reward_cap')
        then jsonb_typeof(value) = 'number'
          and (value #>> '{}') ~ '^[0-9]+$'
          and (value #>> '{}')::numeric between 0 and 1000
      else false
    end);

notify pgrst, 'reload schema';
commit;
