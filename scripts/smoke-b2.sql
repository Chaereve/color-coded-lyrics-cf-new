-- B2 smoke: check-in → open box on dedicated accounts only. Stop on error.
\set ON_ERROR_STOP on

create or replace function pg_temp.b2_ensure_user(p_email text, p_name text)
returns uuid language plpgsql as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email = p_email;
  if v_uid is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    )
    select u.instance_id, gen_random_uuid(), 'authenticated', 'authenticated', p_email,
           '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
           clock_timestamp(), clock_timestamp(), clock_timestamp(),
           '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
      from auth.users u
     limit 1
    returning id into v_uid;
    if v_uid is null then
      raise exception 'B2 smoke: could not insert auth.users for %', p_email;
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    insert into public.profiles (id, name) values (v_uid, p_name)
    on conflict (id) do nothing;
  end if;
  return v_uid;
end $$;

create or replace function pg_temp.b2_find_seed(p_lo int, p_hi int)
returns float language plpgsql as $$
declare s float; r int;
begin
  for i in 0..30000 loop
    s := i / 30000.0;
    perform setseed(s);
    r := floor(random() * 1000)::int;
    if r >= p_lo and r <= p_hi then
      return s;
    end if;
  end loop;
  raise exception 'B2 smoke: no setseed in 30000 tries for roll %-%', p_lo, p_hi;
end $$;

create or replace function pg_temp.b2_session(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

do $smoke$
declare
  v_day      date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_token    text := nullif(current_setting('b2.gate_token', true), '');
  v_hash     text;
  v_live     uuid;
  v_paid1    uuid;
  v_paid2    uuid;
  v_cap      uuid;
  v_json     jsonb;
  v_m        jsonb;
  v_kind     text;
  v_result   int;
  v_votes    int;
  v_amount   int;
  v_before_c int;
  v_after_c  int;
  v_before_r int;
  v_after_r  int;
  v_seed     float;
  v_used     int;
  v_fill     int;
  v_ledger   int;
  v_ask      int[] := array[0, 1, 3, 5, 10];
begin
  select token_hash into v_hash from public.edge_gate where id;
  if v_hash is not null and (v_token is null or length(v_token) < 32) then
    raise exception 'B2 smoke: edge_gate is armed and CI has no EDGE_GATE_TOKEN — cannot open_mystery_box';
  end if;

  v_live  := pg_temp.b2_ensure_user('b2-deploy-smoke@invalid.ccl', 'B2 deploy smoke');
  v_paid1 := pg_temp.b2_ensure_user('b2-paid1-smoke@invalid.ccl', 'B2 paid1 smoke');
  v_paid2 := pg_temp.b2_ensure_user('b2-paid2-smoke@invalid.ccl', 'B2 paid2 smoke');
  v_cap   := pg_temp.b2_ensure_user('b2-cap-smoke@invalid.ccl', 'B2 cap smoke');

  -- 1. Live path: check-in (idempotent) then open today's box.
  perform pg_temp.b2_session(v_live);
  v_json := public.claim_daily_login_calendar(v_day);
  raise notice 'B2 live check-in replayed=%', v_json->>'replayed';

  v_json := public.open_mystery_box(v_day, v_token);
  v_m := v_json->'mystery';
  raise notice 'B2 live open replayed=% mystery=%', v_json->>'replayed', v_m;
  if coalesce((v_m->>'checked_in')::boolean, false) is not true
     or coalesce((v_m->>'opened')::boolean, false) is not true then
    raise exception 'B2 smoke: live box not opened after check-in: %', v_m;
  end if;
  v_result := (v_m->>'result')::int;
  v_kind := v_m->>'reward_kind';
  v_votes := coalesce((v_m->>'reward_votes')::int, 0);
  v_amount := coalesce((v_m->>'reward_amount')::int, 0);
  if v_result not between 0 and 6 then
    raise exception 'B2 smoke: live result % out of 0..6', v_result;
  end if;
  if v_result = 0 and v_kind is distinct from 'nothing' then
    raise exception 'B2 smoke: result 0 must be nothing, got %', v_kind;
  elsif v_result between 1 and 4 and v_kind is distinct from 'votes' then
    raise exception 'B2 smoke: result % must be votes, got %', v_result, v_kind;
  elsif v_result in (5, 6) and v_kind is distinct from 'free_paid_request' then
    raise exception 'B2 smoke: result % must be free_paid_request (label +% Free Paid Request), got %',
      v_result, case when v_result = 5 then 1 else 2 end, v_kind;
  end if;
  if v_kind = 'votes' and v_votes > v_ask[v_result + 1] then
    raise exception 'B2 smoke: votes % exceed v3 ask for result %', v_votes, v_result;
  end if;
  if v_kind = 'free_paid_request' and v_amount not in (1, 2) then
    raise exception 'B2 smoke: free paid reward_amount % not 1 or 2', v_amount;
  end if;

  v_json := public.open_mystery_box(v_day, v_token);
  if coalesce((v_json->>'replayed')::boolean, false) is not true
     or (v_json->'mystery'->>'result')::int is distinct from v_result then
    raise exception 'B2 smoke: replay re-rolled or not marked replayed: %', v_json;
  end if;

  -- 2. Forced +1 free paid request (roll 995..998) — bonus_requests, not cap.
  perform pg_temp.b2_session(v_paid1);
  perform public.claim_daily_login_calendar(v_day);
  if not exists (select 1 from public.mystery_opens where user_id = v_paid1 and day = v_day) then
    select coalesce(bonus_requests, 0), coalesce(bonus_credits, 0)
      into v_before_r, v_before_c from public.profiles where id = v_paid1;
    select coalesce(sum(amount), 0)::int into v_used
      from public.reward_events where user_id = v_paid1 and day = v_day;
    v_seed := pg_temp.b2_find_seed(995, 998);
    perform setseed(v_seed);
    v_json := public.open_mystery_box(v_day, v_token);
    v_m := v_json->'mystery';
    raise notice 'B2 +1 paid seed=% mystery=%', v_seed, v_m;
    if (v_m->>'result')::int is distinct from 5
       or v_m->>'reward_kind' is distinct from 'free_paid_request'
       or coalesce((v_m->>'reward_amount')::int, 0) is distinct from 1
       or coalesce((v_m->>'reward_votes')::int, 0) is distinct from 0 then
      raise exception 'B2 smoke: expected result 5 / +1 free paid request, got %', v_m;
    end if;
    select coalesce(bonus_requests, 0), coalesce(bonus_credits, 0)
      into v_after_r, v_after_c from public.profiles where id = v_paid1;
    if v_after_r is distinct from v_before_r + 1 then
      raise exception 'B2 smoke: +1 free paid did not increment bonus_requests (% → %)', v_before_r, v_after_r;
    end if;
    if v_after_c is distinct from v_before_c then
      raise exception 'B2 smoke: +1 free paid must not change bonus_credits (% → %)', v_before_c, v_after_c;
    end if;
    if exists (
      select 1 from public.reward_events
       where user_id = v_paid1 and day = v_day and source = 'mystery_box'
    ) then
      raise exception 'B2 smoke: +1 free paid must not write mystery_box ledger (outside cap)';
    end if;
    select coalesce(sum(amount), 0)::int into v_ledger
      from public.reward_events where user_id = v_paid1 and day = v_day;
    if v_ledger is distinct from v_used then
      raise exception 'B2 smoke: +1 free paid changed vote ledger (% → %)', v_used, v_ledger;
    end if;
  else
    select result, reward_kind, reward_amount into v_result, v_kind, v_amount
      from public.mystery_opens where user_id = v_paid1 and day = v_day;
    if v_result is distinct from 5 or v_kind is distinct from 'free_paid_request' or v_amount is distinct from 1 then
      raise exception 'B2 smoke: paid1 replay row is %, %, % — expected 5/free_paid_request/1',
        v_result, v_kind, v_amount;
    end if;
    raise notice 'B2 +1 paid already committed today — skip re-open';
  end if;

  -- 3. Forced +2 free paid requests (roll 999).
  perform pg_temp.b2_session(v_paid2);
  perform public.claim_daily_login_calendar(v_day);
  if not exists (select 1 from public.mystery_opens where user_id = v_paid2 and day = v_day) then
    select coalesce(bonus_requests, 0), coalesce(bonus_credits, 0)
      into v_before_r, v_before_c from public.profiles where id = v_paid2;
    v_seed := pg_temp.b2_find_seed(999, 999);
    perform setseed(v_seed);
    v_json := public.open_mystery_box(v_day, v_token);
    v_m := v_json->'mystery';
    raise notice 'B2 +2 paid seed=% mystery=%', v_seed, v_m;
    if (v_m->>'result')::int is distinct from 6
       or v_m->>'reward_kind' is distinct from 'free_paid_request'
       or coalesce((v_m->>'reward_amount')::int, 0) is distinct from 2 then
      raise exception 'B2 smoke: expected result 6 / +2 free paid requests, got %', v_m;
    end if;
    select coalesce(bonus_requests, 0), coalesce(bonus_credits, 0)
      into v_after_r, v_after_c from public.profiles where id = v_paid2;
    if v_after_r is distinct from v_before_r + 2 then
      raise exception 'B2 smoke: +2 free paid did not increment bonus_requests (% → %)', v_before_r, v_after_r;
    end if;
    if v_after_c is distinct from v_before_c then
      raise exception 'B2 smoke: +2 free paid must not change bonus_credits';
    end if;
    if exists (
      select 1 from public.reward_events
       where user_id = v_paid2 and day = v_day and source = 'mystery_box'
    ) then
      raise exception 'B2 smoke: +2 free paid must not write mystery_box ledger (outside cap)';
    end if;
  else
    select result, reward_kind, reward_amount into v_result, v_kind, v_amount
      from public.mystery_opens where user_id = v_paid2 and day = v_day;
    if v_result is distinct from 6 or v_kind is distinct from 'free_paid_request' or v_amount is distinct from 2 then
      raise exception 'B2 smoke: paid2 replay row is %, %, % — expected 6/free_paid_request/2',
        v_result, v_kind, v_amount;
    end if;
    raise notice 'B2 +2 paid already committed today — skip re-open';
  end if;

  -- 4. Cap 30: fill the day, force a vote prize, paid votes must be 0.
  perform pg_temp.b2_session(v_cap);
  perform public.claim_daily_login_calendar(v_day);
  if not exists (select 1 from public.mystery_opens where user_id = v_cap and day = v_day) then
    select public.reward_votes_used_on(v_cap, v_day) into v_used;
    v_fill := greatest(0, 30 - v_used);
    if v_fill > 0 then
      insert into public.reward_events (user_id, day, source, ref, amount)
      values (v_cap, v_day, 'daily_spin', 'b2-cap-fill', v_fill)
      on conflict (source, user_id, day, ref) do nothing;
    end if;
    if public.reward_votes_used_on(v_cap, v_day) <> 30 then
      raise exception 'B2 smoke: failed to fill cap to 30, used=%', public.reward_votes_used_on(v_cap, v_day);
    end if;
    select coalesce(bonus_credits, 0) into v_before_c from public.profiles where id = v_cap;
    v_seed := pg_temp.b2_find_seed(700, 859);
    perform setseed(v_seed);
    v_json := public.open_mystery_box(v_day, v_token);
    v_m := v_json->'mystery';
    raise notice 'B2 cap seed=% mystery=%', v_seed, v_m;
    if v_m->>'reward_kind' is distinct from 'votes'
       or (v_m->>'result')::int is distinct from 1 then
      raise exception 'B2 smoke: cap probe expected votes result 1, got %', v_m;
    end if;
    if coalesce((v_m->>'reward_votes')::int, -1) is distinct from 0 then
      raise exception 'B2 smoke: cap 30 must clip vote prize to 0, got %', v_m;
    end if;
    select coalesce(bonus_credits, 0) into v_after_c from public.profiles where id = v_cap;
    if v_after_c is distinct from v_before_c then
      raise exception 'B2 smoke: clipped vote prize moved bonus_credits (% → %)', v_before_c, v_after_c;
    end if;
  else
    select result, reward_kind, reward_votes into v_result, v_kind, v_votes
      from public.mystery_opens where user_id = v_cap and day = v_day;
    if v_kind is distinct from 'votes' or v_result is distinct from 1 or v_votes is distinct from 0 then
      raise exception 'B2 smoke: cap replay row is %, %, % — expected 1/votes/0',
        v_result, v_kind, v_votes;
    end if;
    raise notice 'B2 cap already committed today — skip re-open';
  end if;
  if public.reward_votes_used_on(v_cap, v_day) > 30 then
    raise exception 'B2 smoke: vote ledger exceeded cap 30';
  end if;

  raise notice 'B2 smoke OK — live open, +1/+2 free paid, cap clip';
end
$smoke$;
