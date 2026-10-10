-- Rollback of 20261202_mystery_paid_v2.sql (mystery prize table v2).
-- Restores the 20261129 prize table: 1% back to "+5 votes", kind spelling
-- back to 'paid_request' for the 2% prize.
--
-- GUARD: a v2 "+2 free paid requests" row (result 6, free_paid_request) has
-- NO representation under the v1 table — rolling back would silently turn a
-- paid +2 into votes +5, which the owner explicitly forbade. Refuse instead
-- (same policy as the spin-v2 rollback). v2 result-5 rows map back 1:1.

begin;

do $$ begin
  if exists (select 1 from public.mystery_opens
             where reward_kind = 'free_paid_request' and result = 6) then
    raise exception 'rollback refused: result-6 free_paid_request rows exist (+2 free paid requests has no v1 equivalent)';
  end if;
end $$;

update public.mystery_opens
   set reward_kind = 'paid_request'
 where reward_kind = 'free_paid_request' and result = 5;

alter table public.mystery_opens drop constraint mystery_opens_reward_kind_check;
alter table public.mystery_opens
  add constraint mystery_opens_reward_kind_check
  check (reward_kind in ('nothing', 'votes', 'paid_request'));

comment on table public.mystery_opens is
  'One mystery box per account per Vietnam day (PK user_id, day). result is the 0..6 prize index, reward_votes the votes actually credited after the daily cap (0 for nothing/paid_request or a fully clipped prize).';

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

  if not exists (select 1 from public.daily_login_rewards
                 where user_id = v_uid and reward_day = v_day) then
    raise exception 'err.mysteryLocked';
  end if;

  select * into v_prev from public.mystery_opens
    where user_id = v_uid and day = v_day;
  if found then
    return jsonb_build_object('replayed', true,
      'mystery', public.mystery_status(v_uid, v_day));
  end if;

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
    v_paid := public.grant_reward_event(v_uid, v_day, 'mystery_box', 'box', v_ask,
      jsonb_build_object('result', v_result));
  elsif v_kind = 'paid_request' then
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
