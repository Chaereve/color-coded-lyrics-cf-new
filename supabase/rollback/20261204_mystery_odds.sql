-- ROLLBACK of 20261204_mystery_odds.sql — restore open_mystery_box roll
-- thresholds from 20261202 (55/20/12/7/3/2/1). Mapping, gate, cap unchanged.
begin;

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
    v_paid := public.grant_reward_event(v_uid, v_day, 'mystery_box', 'box', v_ask,
      jsonb_build_object('result', v_result));
  elsif v_kind = 'free_paid_request' then
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

notify pgrst, 'reload schema';
commit;
