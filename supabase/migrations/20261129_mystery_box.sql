-- MYSTERY BOX (approved 2026-10 plan) — one box per day, AFTER check-in.
-- Run AFTER 20261128_achievements_v2.sql. One transaction, rerunnable.
--
-- Approved rules (single unit: VOTES; the old "credits" prize is a vote prize):
--   * gate: must have checked in the SAME Vietnam day before the box opens
--   * one box per account per day — mystery_opens PK (user_id, day)
--   * roll (integer 0..999, uniform):
--       0..549   nothing            (55%)
--       550..749 +1 vote            (20%)
--       750..869 +3 votes           (12%)
--       870..939 +5 votes           (7%)
--       940..969 +10 votes          (3%)
--       970..989 +1 free paid request (2%, bonus_requests — OUTSIDE the cap)
--       990..999 +5 votes           (1%, the former "credits" prize, now votes)
--   * vote prizes go through grant_reward_event (source 'mystery_box'), so the
--     shared 30/day cap scales them exactly like login/spin/vote-back/ach.
--     A prize fully clipped by the cap is still recorded (votes paid = 0,
--     meta keeps the ask) — the box is spent, the ledger tells the truth.
--   * replay (same day, retry, second tab) returns the committed result and
--     never rolls again.
--
-- Flag: reward_config.mystery_box_enabled (added to the CHECK in-place). Off
-- means the RPC refuses and the card hides; nothing else changes.
--
-- Not touched: daily_login_rewards, the calendar payload, any B1 RPC. An old
-- bundle that never calls these RPCs behaves identically before/after.
--
-- No bell notification on purpose: the box is opened in the app and the
-- result is on screen at once; a notification would only duplicate it.

begin;

-- 1. Widen reward_config to carry the mystery flag. The CHECK is replaced
--    in-place; existing tuned rows are untouched and the seed never clobbers.
alter table public.reward_config
  drop constraint reward_config_key_check;
alter table public.reward_config
  add constraint reward_config_key_check check (key in (
    'login_rewards_enabled',
    'mystery_box_enabled',
    'login_daily_votes',
    'login_day7_extra',
    'login_milestone7_bonus',
    'login_milestone30_bonus',
    'daily_reward_cap'));
alter table public.reward_config
  drop constraint reward_config_value_check;
alter table public.reward_config
  add constraint reward_config_value_check check (
    case
      when key in ('login_rewards_enabled', 'mystery_box_enabled')
        then jsonb_typeof(value) = 'boolean'
      when key in ('login_daily_votes','login_day7_extra','login_milestone7_bonus',
                   'login_milestone30_bonus','daily_reward_cap')
        then jsonb_typeof(value) = 'number'
          and (value #>> '{}') ~ '^[0-9]+$'
          and (value #>> '{}')::numeric between 0 and 1000
      else false
    end);

insert into public.reward_config (key, value) values
  ('mystery_box_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- 2. The one-box-per-day record. Append-only in practice (no update/delete
--    path in app code); no FK, mirroring reward_events. reward_kind:
--      'nothing'      — result 0, no payout
--      'votes'        — vote prizes, reward_votes = what the cap let through
--      'paid_request' — the 2% free paid request (bonus_requests, outside cap)
create table if not exists public.mystery_opens (
  user_id      uuid not null,
  day          date not null,
  result       smallint not null check (result between 0 and 6),
  reward_votes int not null default 0 check (reward_votes >= 0),
  reward_kind  text not null check (reward_kind in ('nothing','votes','paid_request')),
  created_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, day)
);

alter table public.mystery_opens enable row level security;
revoke all on public.mystery_opens from public, anon, authenticated;
grant all on public.mystery_opens to service_role;
-- No client policy: the box is read through the owner-scoped RPC below and
-- written only inside the security-definer open RPC.

comment on table public.mystery_opens is
  'One mystery box per account per Vietnam day (PK user_id, day). result is the 0..6 prize index, reward_votes the votes actually credited after the daily cap (0 for nothing/paid_request or a fully clipped prize).';

-- 3. Status view for the card: exact key contract, validated by the client.
--    LEFT JOIN from a constant row so an unopened day still yields exactly
--    one result row (opened=false, nulls) — never a NULL jsonb.
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

comment on function public.my_mystery_status() is
  'Owner-scoped mystery-box view for the check-in screen: whether the box is enabled, whether today is checked in (the unlock gate), and the committed result when today''s box is already opened.';

-- 4. The open RPC. Same caller contract as claim_daily_login_calendar:
--    identity from auth.uid(), p_expected_day is a stale-client guard only,
--    profile lock first so concurrent opens (two tabs, retry) serialize and
--    the loser replays. The edge gate reuses edge_gate_ok: when the Worker
--    gate is armed, only the Edge function (holding EDGE_GATE_TOKEN) gets in.
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
    v_result := 0; v_kind := 'nothing';      v_ask := 0;
  elsif v_roll < 750 then
    v_result := 1; v_kind := 'votes';        v_ask := 1;
  elsif v_roll < 870 then
    v_result := 2; v_kind := 'votes';        v_ask := 3;
  elsif v_roll < 940 then
    v_result := 3; v_kind := 'votes';        v_ask := 5;
  elsif v_roll < 970 then
    v_result := 4; v_kind := 'votes';        v_ask := 10;
  elsif v_roll < 990 then
    v_result := 5; v_kind := 'paid_request'; v_ask := 0;
  else
    v_result := 6; v_kind := 'votes';        v_ask := 5;
  end if;

  v_paid := 0;
  if v_kind = 'votes' then
    -- The shared daily cap scales the prize; a fully clipped prize still
    -- spends the box (paid = 0, the ledger meta keeps the ask).
    v_paid := public.grant_reward_event(v_uid, v_day, 'mystery_box', 'box', v_ask,
      jsonb_build_object('result', v_result));
  elsif v_kind = 'paid_request' then
    -- Free paid requests are not votes: outside the cap, same as the paid
    -- achievement bonuses of 20261128.
    update public.profiles
       set bonus_requests = bonus_requests + 1
     where id = v_uid;
  end if;

  insert into public.mystery_opens (user_id, day, result, reward_votes, reward_kind)
    values (v_uid, v_day, v_result, v_paid, v_kind);

  return jsonb_build_object('replayed', false,
    'mystery', public.mystery_status(v_uid, v_day));
end $$;
revoke all on function public.open_mystery_box(date,text) from public, anon, authenticated;
grant execute on function public.open_mystery_box(date,text) to authenticated;

comment on function public.open_mystery_box(date,text) is
  'Opens today''s mystery box (approved 2026-10 plan): gate = checked in the same Vietnam day, one box per day (PK), vote prizes paid through grant_reward_event under the shared 30/day cap, the 2% prize grants +1 free paid request outside the cap. Replays return the committed result without rolling again.';

notify pgrst, 'reload schema';
commit;
