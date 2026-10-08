-- Corrective rollback for 20261127_login_streak_rewards. Apply only after
-- approval.
--
-- Restores the exact claim_daily_login_calendar body that 20261121 shipped
-- (calendar-only claim: check-in row, activity day, replay guard, NO wallet
-- movement), drops the reward-view RPC pair, and leaves reward_events rows —
-- recorded reward history — untouched. Refuses to run twice, refuses while
-- 20261126's objects are missing (the rollback of the ledger must land first
-- or not at all, never in the wrong order).
--
-- After this rollback a check-in grants nothing again; reward rows already
-- written stay in the ledger and in wallets (rollback never claws back).
begin;

do $preflight$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.rewardRollback: guarded-runner migration history is missing';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20261127_login_streak_rewards') then
    raise exception 'err.rewardRollback: 20261127 is not recorded as applied';
  end if;
  if to_regclass('public.reward_events') is null then
    raise exception 'err.rewardRollback: the reward ledger is gone — roll 20261126 back first or not at all';
  end if;
end
$preflight$;

-- The 20261121 body, verbatim (compare with the migration of the same name).
create or replace function public.claim_daily_login_calendar(p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  perform 1 from public.daily_login_rewards
   where user_id = v_uid and reward_day = v_day;
  v_replayed := found;
  if not v_replayed then
    insert into public.daily_login_rewards (user_id, reward_day, reward, created_at)
    values (v_uid, v_day, 0, v_now);
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;

  return jsonb_build_object(
    'replayed', v_replayed,
    'status', public.daily_login_calendar_payload(v_uid, v_now)
  );
end $$;

drop function if exists public.my_login_reward_status();
drop function if exists public.login_reward_status(uuid, date);

notify pgrst, 'reload schema';
commit;
