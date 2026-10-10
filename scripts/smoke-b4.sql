-- B4 smoke: dedicated accounts + B4-SMOKE requests only. Stop on error.
\set ON_ERROR_STOP on

create or replace function pg_temp.b4_ensure_user(p_email text, p_name text)
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
      raise exception 'B4 smoke: could not insert auth.users for %', p_email;
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    insert into public.profiles (id, name) values (v_uid, p_name)
    on conflict (id) do nothing;
  end if;
  return v_uid;
end $$;

create or replace function pg_temp.b4_session(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.b4_request(p_owner uuid, p_title text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.requests
   where user_id = p_owner and artist = 'B4-SMOKE' and title = p_title
   order by created_at desc limit 1;
  if v_id is null then
    insert into public.requests (user_id, artist, title, status, requester)
    values (p_owner, 'B4-SMOKE', p_title, 'queued', 'B4 smoke')
    returning id into v_id;
  end if;
  return v_id;
end $$;

do $smoke$
declare
  v_day     date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_gate    text := nullif(current_setting('b4.gate_token', true), '');
  v_hash    text;
  v_owner   uuid;
  v_voter   uuid;
  v_admin   uuid;
  v_capo    uuid;
  v_capv    uuid;
  v_flago   uuid;
  v_id      uuid;
  v_id30    uuid;
  v_id50    uuid;
  v_idflag  uuid;
  v_bo      int;
  v_bv      int;
  v_ao      int;
  v_av      int;
  v_n       int;
  v_ok      boolean;
  v_latched boolean;
begin
  select token_hash into v_hash from public.edge_gate where id;
  if v_hash is not null and (v_gate is null or length(v_gate) < 32) then
    raise exception 'B4 smoke: edge_gate armed and CI has no EDGE_GATE_TOKEN';
  end if;

  -- Always leave the flag on if a previous run died mid flag-off.
  update public.reward_config
     set value = 'true'::jsonb
   where key = 'vote_back_enabled' and value is distinct from 'true'::jsonb;

  v_owner := pg_temp.b4_ensure_user('b4-owner-smoke@invalid.ccl', 'B4 owner smoke');
  v_voter := pg_temp.b4_ensure_user('b4-voter-smoke@invalid.ccl', 'B4 voter smoke');
  v_admin := pg_temp.b4_ensure_user('b4-admin-smoke@invalid.ccl', 'B4 admin smoke');
  v_capo  := pg_temp.b4_ensure_user('b4-capo-smoke@invalid.ccl', 'B4 capo smoke');
  v_capv  := pg_temp.b4_ensure_user('b4-capv-smoke@invalid.ccl', 'B4 capv smoke');
  v_flago := pg_temp.b4_ensure_user('b4-flag-smoke@invalid.ccl', 'B4 flag smoke');
  update public.profiles set is_admin = true where id = v_admin and is_admin is distinct from true;

  -- 1. 10% : 10 votes from voter → owner floor(10/10)=1, voter greatest(1,1)=1
  v_id := pg_temp.b4_request(v_owner, 'pct-' || v_day::text);
  select vote_back_paid_at is not null into v_latched from public.requests where id = v_id;
  if not v_latched then
    insert into public.votes (request_id, user_id, used_credit, credit_kind)
    select v_id, v_voter, true, 'purchased' from generate_series(1, 10);
    update public.requests set votes = votes + 10 where id = v_id;
    select coalesce(bonus_credits, 0) into v_bo from public.profiles where id = v_owner;
    select coalesce(bonus_credits, 0) into v_bv from public.profiles where id = v_voter;
    update public.requests
       set picked_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = v_id;
    select coalesce(bonus_credits, 0) into v_ao from public.profiles where id = v_owner;
    select coalesce(bonus_credits, 0) into v_av from public.profiles where id = v_voter;
    if v_ao is distinct from v_bo + 1 then
      raise exception 'B4 smoke: owner 10%% expected +1 (% → %)', v_bo, v_ao;
    end if;
    if v_av is distinct from v_bv + 1 then
      raise exception 'B4 smoke: voter 10%% expected +1 min1 (% → %)', v_bv, v_av;
    end if;
    if not exists (
      select 1 from public.reward_events
       where user_id = v_owner and source = 'vote_back_owner' and ref = v_id::text and amount = 1
    ) then
      raise exception 'B4 smoke: missing vote_back_owner 1';
    end if;
    if not exists (
      select 1 from public.reward_events
       where user_id = v_voter and source = 'vote_back_voter' and ref = v_id::text and amount = 1
    ) then
      raise exception 'B4 smoke: missing vote_back_voter 1';
    end if;
    raise notice 'B4 10pct owner+1 voter+1 request=%', v_id;
  else
    raise notice 'B4 10pct already latched today — skip pick';
  end if;

  -- Idempotency: second pick + pay_vote_back do not pay again.
  select coalesce(bonus_credits, 0) into v_bo from public.profiles where id = v_owner;
  select coalesce(bonus_credits, 0) into v_bv from public.profiles where id = v_voter;
  update public.requests set picked_at = clock_timestamp() where id = v_id;
  perform public.pay_vote_back(v_id);
  select coalesce(bonus_credits, 0) into v_ao from public.profiles where id = v_owner;
  select coalesce(bonus_credits, 0) into v_av from public.profiles where id = v_voter;
  if v_ao is distinct from v_bo or v_av is distinct from v_bv then
    raise exception 'B4 smoke: replay pick paid again';
  end if;
  select count(*)::int into v_n from public.reward_events
   where ref = v_id::text and source in ('vote_back_owner','vote_back_voter');
  if v_n <> 2 then
    raise exception 'B4 smoke: expected 2 ledger rows for 10pct request, got %', v_n;
  end if;

  -- Unpick locked.
  perform pg_temp.b4_session(v_admin);
  v_ok := false;
  begin
    perform public.admin_pick(v_id, false);
  exception when others then
    if sqlerrm like '%err.unpickLocked%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'B4 smoke: unpick was not err.unpickLocked';
  end if;

  -- Manual unpick + re-pick still no extra pay (latch survives).
  update public.requests set picked_at = null where id = v_id;
  select coalesce(bonus_credits, 0) into v_bo from public.profiles where id = v_owner;
  update public.requests
     set picked_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = v_id;
  select coalesce(bonus_credits, 0) into v_ao from public.profiles where id = v_owner;
  if v_ao is distinct from v_bo then
    raise exception 'B4 smoke: unpick+re-pick paid again';
  end if;
  if exists (select 1 from public.requests where id = v_id and vote_back_paid_at is null) then
    raise exception 'B4 smoke: latch cleared on unpick';
  end if;

  -- cast_vote after pick → voteLocked (gate first).
  perform pg_temp.b4_session(v_voter);
  -- re-pick so picked_at is set
  update public.requests
     set picked_at = coalesce(picked_at, clock_timestamp())
   where id = v_id;
  v_ok := false;
  begin
    perform public.cast_vote(v_id, 1, null, null, v_gate);
  exception when others then
    if sqlerrm like '%err.voteLocked%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'B4 smoke: cast_vote after pick was not err.voteLocked';
  end if;

  -- 2. Cap 30 / day: fill owner, 20 votes → owner_raw=2 clipped to 0, voter +2
  v_id30 := pg_temp.b4_request(v_owner, 'cap30-' || v_day::text);
  select vote_back_paid_at is not null into v_latched from public.requests where id = v_id30;
  if not v_latched then
    insert into public.votes (request_id, user_id, used_credit, credit_kind)
    select v_id30, v_voter, true, 'purchased' from generate_series(1, 20);
    update public.requests set votes = votes + 20 where id = v_id30;
    v_n := public.reward_votes_used_on(v_owner, v_day);
    if v_n < 30 then
      perform public.grant_reward_event(v_owner, v_day, 'daily_login', 'b4-cap-fill', 30 - v_n);
    end if;
    if public.reward_votes_used_on(v_owner, v_day) <> 30 then
      raise exception 'B4 smoke: failed to fill owner cap to 30, used=%',
        public.reward_votes_used_on(v_owner, v_day);
    end if;
    select coalesce(bonus_credits, 0) into v_bo from public.profiles where id = v_owner;
    select coalesce(bonus_credits, 0) into v_bv from public.profiles where id = v_voter;
    update public.requests
       set picked_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = v_id30;
    select coalesce(bonus_credits, 0) into v_ao from public.profiles where id = v_owner;
    select coalesce(bonus_credits, 0) into v_av from public.profiles where id = v_voter;
    if v_ao is distinct from v_bo then
      raise exception 'B4 smoke: cap30 owner should be clipped to 0 extra (% → %)', v_bo, v_ao;
    end if;
    if v_av is distinct from v_bv + 2 then
      raise exception 'B4 smoke: cap30 voter expected +2 (% → %)', v_bv, v_av;
    end if;
    if exists (
      select 1 from public.reward_events
       where user_id = v_owner and source = 'vote_back_owner' and ref = v_id30::text
    ) then
      raise exception 'B4 smoke: cap30 owner still got a ledger row';
    end if;
    raise notice 'B4 cap30 owner clipped, voter+2';
  else
    raise notice 'B4 cap30 already latched — skip';
  end if;

  -- 3. Cap 50 / request: 450 votes → owner_raw=45, voter_raw=45, sum>50
  --    owner keeps 45 (then daily cap may clip), remain=5 to voter.
  v_id50 := pg_temp.b4_request(v_capo, 'cap50-' || v_day::text);
  select vote_back_paid_at is not null into v_latched from public.requests where id = v_id50;
  if not v_latched then
    insert into public.votes (request_id, user_id, used_credit, credit_kind)
    select v_id50, v_capv, true, 'purchased' from generate_series(1, 450);
    update public.requests set votes = votes + 450 where id = v_id50;
    select coalesce(bonus_credits, 0) into v_bv from public.profiles where id = v_capv;
    update public.requests
       set picked_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = v_id50;
    select coalesce(sum(amount), 0)::int into v_n
      from public.reward_events
     where ref = v_id50::text and source in ('vote_back_owner','vote_back_voter');
    if v_n > 50 then
      raise exception 'B4 smoke: cap50 request paid % > 50', v_n;
    end if;
    if not exists (
      select 1 from public.reward_events
       where user_id = v_capo and source = 'vote_back_owner' and ref = v_id50::text
         and (meta ? 'capped50') and (meta->>'capped50')::boolean
    ) then
      raise exception 'B4 smoke: cap50 owner row missing capped50 meta';
    end if;
    select coalesce(bonus_credits, 0) into v_av from public.profiles where id = v_capv;
    if v_av is distinct from v_bv + 5 then
      raise exception 'B4 smoke: cap50 voter remain expected +5 (% → %)', v_bv, v_av;
    end if;
    if public.reward_votes_used_on(v_capo, v_day) > 30 then
      raise exception 'B4 smoke: capo exceeded daily cap 30';
    end if;
    raise notice 'B4 cap50 request total paid=% (≤50), voter+5, daily cap ok', v_n;
  else
    raise notice 'B4 cap50 already latched — skip';
  end if;

  -- 4. Flag off still latches, pays nothing; restore flag.
  v_idflag := pg_temp.b4_request(v_flago, 'flagoff-' || v_day::text);
  select vote_back_paid_at is not null into v_latched from public.requests where id = v_idflag;
  if not v_latched then
    insert into public.votes (request_id, user_id, used_credit, credit_kind)
    select v_idflag, v_voter, true, 'purchased' from generate_series(1, 10);
    update public.requests set votes = votes + 10 where id = v_idflag;
    update public.reward_config set value = 'false'::jsonb where key = 'vote_back_enabled';
    begin
      update public.requests
         set picked_at = clock_timestamp(), updated_at = clock_timestamp()
       where id = v_idflag;
      if exists (
        select 1 from public.requests where id = v_idflag and vote_back_paid_at is null
      ) then
        raise exception 'B4 smoke: flag off did not latch';
      end if;
      if exists (
        select 1 from public.reward_events
         where ref = v_idflag::text and source in ('vote_back_owner','vote_back_voter')
      ) then
        raise exception 'B4 smoke: flag off still paid ledger';
      end if;
      raise notice 'B4 flag-off latched with no pay';
    exception when others then
      update public.reward_config set value = 'true'::jsonb where key = 'vote_back_enabled';
      raise;
    end;
    update public.reward_config set value = 'true'::jsonb where key = 'vote_back_enabled';
  else
    raise notice 'B4 flagoff already latched — skip';
  end if;

  if (select value from public.reward_config where key = 'vote_back_enabled') is distinct from 'true'::jsonb then
    raise exception 'B4 smoke: vote_back_enabled not restored to true';
  end if;

  raise notice 'B4 smoke OK — 10pct, idempotent, unpickLocked, voteLocked, cap30, cap50, flag-off latch';
end
$smoke$;
