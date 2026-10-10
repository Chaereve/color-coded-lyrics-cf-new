-- B3 smoke: two spins on dedicated accounts. Stop on error. No other users.
\set ON_ERROR_STOP on

create or replace function pg_temp.b3_ensure_user(p_email text, p_name text)
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
      raise exception 'B3 smoke: could not insert auth.users for %', p_email;
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    insert into public.profiles (id, name) values (v_uid, p_name)
    on conflict (id) do nothing;
  end if;
  return v_uid;
end $$;

create or replace function pg_temp.b3_session(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

do $smoke$
declare
  v_day     date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_yest    date := v_day - 1;
  v_token   text := nullif(current_setting('b3.gate_token', true), '');
  v_hash    text;
  v_live    uuid;
  v_nr      uuid;
  v_dev     text;
  v_dhash   text;
  v_req     uuid;
  v_json    jsonb;
  v_spin    jsonb;
  v_st      jsonb;
  v_n       int;
  v_r1      int;
  v_r2      int;
  v_ok      boolean;
  v_prizes  int[] := array[1,2,3,5,8,10,20];
begin
  select token_hash into v_hash from public.edge_gate where id;
  if v_hash is not null and (v_token is null or length(v_token) < 32) then
    raise exception 'B3 smoke: edge_gate is armed and CI has no EDGE_GATE_TOKEN — cannot spin_daily';
  end if;

  v_live := pg_temp.b3_ensure_user('b3-deploy-smoke@invalid.ccl', 'B3 deploy smoke');
  v_nr   := pg_temp.b3_ensure_user('b3-norepeat-smoke@invalid.ccl', 'B3 norepeat smoke');

  -- 1. Live: register device, spin twice, replay, third refused.
  perform pg_temp.b3_session(v_live);
  select count(*)::int into v_n from public.daily_spins
   where user_id = v_live and spin_day = v_day;
  v_dev := public.register_daily_spin_device();
  v_st := public.my_daily_spin_status(v_dev, null);
  if v_st->'rewards' is distinct from to_jsonb(v_prizes)
     or v_st->'weights' is distinct from to_jsonb(array[30,25,20,12,8,4,1]) then
    raise exception 'B3 smoke: payload prizes/weights not v2: %', v_st;
  end if;
  if coalesce((v_st->>'limit')::int, 0) is distinct from 2 then
    raise exception 'B3 smoke: quota limit is %, expected 2', v_st->>'limit';
  end if;

  if v_n < 2 then
    v_req := gen_random_uuid();
    v_json := public.spin_daily(v_dev, v_req, v_live, null, null, v_token);
    v_spin := v_json->'spin';
    raise notice 'B3 spin1 replayed=% reward=% segment=% remaining=%',
      v_json->>'replayed', v_spin->>'reward', v_spin->>'segment', v_json->'status'->>'remaining';
    if coalesce((v_json->>'replayed')::boolean, true)
       or (v_spin->>'reward')::int <> all (v_prizes)
       or (v_spin->>'segment')::int not between 0 and 6 then
      raise exception 'B3 smoke: first spin not a v2 win: %', v_json;
    end if;
    v_r1 := (v_spin->>'reward')::int;
    -- Replay same request_id.
    v_json := public.spin_daily(v_dev, v_req, v_live, null, null, v_token);
    if coalesce((v_json->>'replayed')::boolean, false) is not true
       or (v_json->'spin'->>'reward')::int is distinct from v_r1 then
      raise exception 'B3 smoke: replay re-rolled: %', v_json;
    end if;

    v_json := public.spin_daily(v_dev, gen_random_uuid(), v_live, null, null, v_token);
    v_spin := v_json->'spin';
    raise notice 'B3 spin2 replayed=% reward=% remaining=%',
      v_json->>'replayed', v_spin->>'reward', v_json->'status'->>'remaining';
    if coalesce((v_json->>'replayed')::boolean, true)
       or (v_spin->>'reward')::int <> all (v_prizes) then
      raise exception 'B3 smoke: second spin not a v2 win: %', v_json;
    end if;
    v_r2 := (v_spin->>'reward')::int;
    if coalesce((v_json->'status'->>'remaining')::int, -1) is distinct from 0
       or coalesce((v_json->'status'->>'account_used')::int, 0) < 2 then
      raise exception 'B3 smoke: after 2 spins remaining/account_used wrong: %', v_json->'status';
    end if;
  else
    raise notice 'B3 live account already used 2 spins today — skip new draws';
    v_st := public.my_daily_spin_status(v_dev, null);
    if coalesce((v_st->>'remaining')::int, -1) is distinct from 0 then
      raise exception 'B3 smoke: account has 2 rows but remaining=%', v_st->>'remaining';
    end if;
  end if;

  v_ok := false;
  begin
    v_json := public.spin_daily(v_dev, gen_random_uuid(), v_live, null, null, v_token);
  exception
    when others then
      if sqlerrm like '%err.spinDeviceLimit%' or sqlerrm like '%err.spinAccountLimit%' then
        v_ok := true;
      else
        raise;
      end if;
  end;
  if not v_ok then
    raise exception 'B3 smoke: third spin was not refused (quota 2/day)';
  end if;

  -- 2. No-repeat: two +20 on this device yesterday → today must not be +20.
  perform pg_temp.b3_session(v_nr);
  select count(*)::int into v_n from public.daily_spins
   where user_id = v_nr and spin_day = v_day;
  v_dev := public.register_daily_spin_device();
  v_dhash := public.daily_spin_device_hash(v_dev);
  if v_n = 0 then
    insert into public.daily_spins
      (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward, created_at)
    values
      (gen_random_uuid(), v_nr, v_dhash, v_yest, 1, 1, 6, 20, v_yest + time '09:00'),
      (gen_random_uuid(), v_nr, v_dhash, v_yest, 2, 2, 6, 20, v_yest + time '10:00');
    v_json := public.spin_daily(v_dev, gen_random_uuid(), v_nr, null, null, v_token);
    raise notice 'B3 norepeat spin reward=%', v_json->'spin'->>'reward';
    if (v_json->'spin'->>'reward')::int is not distinct from 20 then
      raise exception 'B3 smoke: no-repeat failed — +20 after two +20';
    end if;
    if (v_json->'spin'->>'reward')::int <> all (v_prizes) then
      raise exception 'B3 smoke: norepeat spin not a v2 prize: %', v_json;
    end if;
  else
    select reward into v_r1 from public.daily_spins
     where user_id = v_nr and spin_day = v_day
     order by created_at limit 1;
    raise notice 'B3 norepeat already spun today reward=%', v_r1;
  end if;

  raise notice 'B3 smoke OK — 2 spins, quota, weights, no-repeat';
end
$smoke$;
