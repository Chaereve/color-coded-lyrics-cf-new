-- B1 smoke: one check-in on a dedicated smoke account (idempotent same VN day).
-- Writes ONLY that account. Stop on error. Do not touch other users.
\set ON_ERROR_STOP on

do $smoke$
declare
  v_uid     uuid;
  v_day     date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_before  int;
  v_after   int;
  v_json    jsonb;
  v_email   text := 'b1-deploy-smoke@invalid.ccl';
  v_replay  boolean;
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    )
    select u.instance_id, gen_random_uuid(), 'authenticated', 'authenticated', v_email,
           '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
           clock_timestamp(), clock_timestamp(), clock_timestamp(),
           '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
      from auth.users u
     limit 1
    returning id into v_uid;
    if v_uid is null then
      raise exception 'B1 smoke: could not insert auth.users (no instance_id donor)';
    end if;
  end if;

  if not exists (select 1 from public.profiles where id = v_uid) then
    insert into public.profiles (id, name) values (v_uid, 'B1 deploy smoke')
    on conflict (id) do nothing;
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_uid::text, 'role', 'authenticated', 'email', v_email)::text,
    true);

  select coalesce(bonus_credits, 0) into v_before from public.profiles where id = v_uid;
  v_json := public.claim_daily_login_calendar(v_day);
  v_replay := coalesce((v_json->>'replayed')::boolean, false);
  select coalesce(bonus_credits, 0) into v_after from public.profiles where id = v_uid;

  raise notice 'B1 smoke claim json=% before=% after=%', v_json, v_before, v_after;

  if not v_replay then
    if v_after < v_before + 2 then
      raise exception 'B1 smoke: expected +2 bonus votes, before=% after=%', v_before, v_after;
    end if;
    if not exists (
      select 1 from public.reward_events
       where user_id = v_uid and source = 'daily_login' and day = v_day and amount >= 2
    ) then
      raise exception 'B1 smoke: missing reward_events daily_login row';
    end if;
  else
    if not exists (
      select 1 from public.reward_events
       where user_id = v_uid and source = 'daily_login' and day = v_day
    ) then
      raise exception 'B1 smoke: replay but no daily_login ledger row for today';
    end if;
  end if;
end
$smoke$;
