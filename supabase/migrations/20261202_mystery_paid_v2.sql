-- MYSTERY BOX PRIZE TABLE v2 (approved 2026-10-09 master prompt) — UI-only
-- display fix for the double "+5 votes" outcome: the 1% prize is RE-POINTED.
-- Run AFTER 20261129_mystery_box.sql. One transaction, rerunnable.
--
-- FINAL approved mapping (7 outcomes, weights unchanged — 55/20/12/7/3/2/1):
--   0..549   nothing              (55%)  — no side effect beyond the record
--   550..749 +1 vote              (20%)  — grant_reward_event, under the cap
--   750..869 +3 votes             (12%)
--   870..939 +5 votes             (7%)   — the ONLY +5-votes outcome
--   940..969 +10 votes            (3%)
--   970..989 +1 free paid request (2%)  — bonus_requests +1, outside the cap
--   990..999 +2 free paid requests(1%)  — bonus_requests +2, outside the cap
--
-- Changes vs 20261129:
--   * result 6: "+5 votes" (1%)  ->  "+2 free paid requests" (1%)
--   * new rows use reward_kind = 'free_paid_request' (both paid prizes).
--     Legacy rows keep 'paid_request'; every reader accepts BOTH spellings,
--     so this migration may be applied at any time after 20261129.
--   * the paid amount is paid LITERALLY in each branch (1 vs 2) AND recorded
--     in a real column: mystery_opens.reward_amount (1 for the 2% prize, 2
--     for the 1% one, the granted votes for vote prizes, 0 for nothing) —
--     per the master prompt data contract "reward_amount = 1|2". The status
--     payload grows one key (reward_amount); readers accept BOTH payloads
--     (8-key pre-migration, 9-key after) so this stays deploy-order safe.
--
-- Untouched: the gate (check-in first), one-box-per-day PK, replay semantics,
-- grant_reward_event / cap / idempotency, reward_config flag, RLS.
-- NOT APPLIED to production here per owner instruction — file + tests only.

begin;

-- 1. Widen the kind CHECK (inline column check carries the auto name).
--    'paid_request' stays valid: legacy rows must keep loading.
alter table public.mystery_opens drop constraint mystery_opens_reward_kind_check;
alter table public.mystery_opens
  add constraint mystery_opens_reward_kind_check
  check (reward_kind in ('nothing', 'votes', 'paid_request', 'free_paid_request'));

comment on table public.mystery_opens is
  'One mystery box per account per Vietnam day (PK user_id, day). result is the 0..6 prize index (v2 table: 5 = +1 free paid request, 6 = +2 free paid requests), reward_votes the votes actually credited after the daily cap (0 for nothing/free-paid-request prizes or a fully clipped prize).';

-- 1b. The paid-amount column per the master prompt data contract
--     ("reward_amount = 1|2"). Backfill keeps every reader exact:
--       votes               -> the granted (post-cap) vote count
--       paid_request (v1)   -> 1   (the only amount that kind ever had)
--       free_paid_request   -> 1 for result 5, 2 for result 6
--       nothing             -> 0
alter table public.mystery_opens add column if not exists reward_amount smallint not null default 0;

update public.mystery_opens o set reward_amount =
  case when o.reward_kind in ('paid_request', 'free_paid_request')
       then case when o.result = 6 then 2 else 1 end
       else coalesce(o.reward_votes, 0) end
where o.reward_amount = 0;

alter table public.mystery_opens drop constraint if exists mystery_opens_reward_amount_check;
alter table public.mystery_opens
  add constraint mystery_opens_reward_amount_check check (reward_amount >= 0);

-- 2. The open RPC — same caller contract, new 1% prize and kind spelling.
create or replace function public.open_mystery_box(p_expected_day date, p_gate_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_day   date;
  v_prev  record;
  v_roll  int;
  v_result smallint;
  v_kind  text;
  v_ask   int;
  v_paid  int;
  v_free  int;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.mysteryGate'; end if;

  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  v_day := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  if not public.reward_config_bool('mystery_box_enabled') then
    raise exception 'err.mysteryDisabled';
  end if;

  -- The approved gate: check in first, THEN the box opens.
  if not exists (select 1 from public.daily_login_rewards
                 where user_id = v_uid and reward_day = v_day) then
    raise exception 'err.mysteryLocked';
  end if;

  -- Replay: the box is already spent today — return the committed result.
  select * into v_prev from public.mystery_opens
    where user_id = v_uid and day = v_day;
  if found then
    return jsonb_build_object('replayed', true,
      'mystery', public.mystery_status(v_uid, v_day));
  end if;

  -- One uniform roll decides everything. Writing the row BEFORE paying is not
  -- needed: the PK plus the profile lock already make a double roll
  -- impossible, and grant_reward_event is itself idempotent.
  v_roll := floor(random() * 1000)::int;
  if v_roll < 550 then
    v_result := 0; v_kind := 'nothing';           v_ask := 0;  v_free := 0;
  elsif v_roll < 750 then
    v_result := 1; v_kind := 'votes';             v_ask := 1;  v_free := 0;
  elsif v_roll < 870 then
    v_result := 2; v_kind := 'votes';             v_ask := 3;  v_free := 0;
  elsif v_roll < 940 then
    v_result := 3; v_kind := 'votes';             v_ask := 5;  v_free := 0;
  elsif v_roll < 970 then
    v_result := 4; v_kind := 'votes';             v_ask := 10; v_free := 0;
  elsif v_roll < 990 then
    v_result := 5; v_kind := 'free_paid_request'; v_ask := 0;  v_free := 1;
  else
    v_result := 6; v_kind := 'free_paid_request'; v_ask := 0;  v_free := 2;
  end if;

  v_paid := 0;
  if v_kind = 'votes' then
    -- The shared daily cap scales the prize; a fully clipped prize still
    -- spends the box (paid = 0, the ledger meta keeps the ask).
    v_paid := public.grant_reward_event(v_uid, v_day, 'mystery_box', 'box', v_ask,
      jsonb_build_object('result', v_result));
  elsif v_kind = 'free_paid_request' then
    -- Free PAID requests are not votes: outside the cap, never recorded as a
    -- vote reward. The amount is the branch literal — +1 or +2, never merged.
    update public.profiles
       set bonus_requests = bonus_requests + v_free
     where id = v_uid;
  end if;

  insert into public.mystery_opens
    (user_id, day, result, reward_votes, reward_amount, reward_kind)
    values (v_uid, v_day, v_result, v_paid,
            case when v_kind = 'votes' then v_paid else v_free end, v_kind);

  return jsonb_build_object('replayed', false,
    'mystery', public.mystery_status(v_uid, v_day));
end $$;
revoke all on function public.open_mystery_box(date,text) from public, anon, authenticated;
grant execute on function public.open_mystery_box(date,text) to authenticated;

comment on function public.open_mystery_box(date,text) is
  'Opens today''s mystery box (prize table v2, approved 2026-10-09): gate = checked in the same Vietnam day, one box per day (PK), vote prizes paid through grant_reward_event under the shared 30/day cap, the 2% prize grants +1 and the 1% prize +2 free paid requests outside the cap. Replays return the committed result without rolling again.';

-- 3. Status RPCs — same keys as 20261129 PLUS reward_amount (the master
--    prompt data contract). Key order mirrors the client STATUS_KEYS_V2.
create or replace function public.mystery_status(p_uid uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', p_uid,
    'day', p_day,
    'enabled', public.reward_config_bool('mystery_box_enabled'),
    'checked_in', exists (
      select 1 from public.daily_login_rewards r
       where r.user_id = p_uid and r.reward_day = p_day),
    'opened', (m.user_id is not null),
    'result', m.result,
    'reward_votes', coalesce(m.reward_votes, 0),
    'reward_amount', coalesce(m.reward_amount, 0),
    'reward_kind', m.reward_kind
  )
  from (select 1) one
  left join (select * from public.mystery_opens
              where user_id = p_uid and day = p_day) m on true
$$;
revoke all on function public.mystery_status(uuid,date) from public, anon, authenticated;

create or replace function public.my_mystery_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'err.signin';
  end if;
  return public.mystery_status(v_uid,
    (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date);
end $$;
revoke all on function public.my_mystery_status() from public, anon, authenticated;
grant execute on function public.my_mystery_status() to authenticated;

notify pgrst, 'reload schema';
commit;
