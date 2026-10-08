-- Corrective rollback for 20261126_reward_ledger. Apply only after approval.
--
-- 20261126 is purely additive (three tables + internal helpers, no data
-- written by the migration itself), so the rollback is the exact inverse:
-- remove what it added and change nothing else. It refuses to run when the
-- ledger already holds rows — those are granted-reward history, and history
-- is never deleted by a rollback. In that case a human decides: keep the
-- ledger (it is harmless bookkeeping) or archive the rows first.
--
-- Preflight refuses to run twice (no history row -> nothing to undo), and
-- refuses while reward_events, reward_milestone_once or any non-default
-- reward_config row exists.
begin;

do $preflight$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.rewardRollback: guarded-runner migration history is missing';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20261126_reward_ledger') then
    raise exception 'err.rewardRollback: 20261126 is not recorded as applied';
  end if;
  if to_regclass('public.reward_events') is not null then
    if exists (select 1 from public.reward_events) then
      raise exception 'err.rewardRollback: reward_events already holds granted-reward history; archive it by hand first';
    end if;
  end if;
  if to_regclass('public.reward_milestone_once') is not null then
    if exists (select 1 from public.reward_milestone_once) then
      raise exception 'err.rewardRollback: reward_milestone_once already holds markers; review by hand first';
    end if;
  end if;
end
$preflight$;

drop function if exists public.grant_reward_event(uuid, date, text, text, integer, jsonb);
drop function if exists public.reward_granted_total(uuid, text, text);
drop function if exists public.reward_votes_used_on(uuid, date);
drop function if exists public.reward_config_int(text);
drop function if exists public.reward_config_bool(text);

drop table if exists public.reward_milestone_once;
drop table if exists public.reward_events;
drop table if exists public.reward_config;

notify pgrst, 'reload schema';
commit;
