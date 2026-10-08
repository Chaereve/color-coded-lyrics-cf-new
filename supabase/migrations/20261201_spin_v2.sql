-- DAILY SPIN v2 (approved 2026-10 plan) — seven weighted sectors.
-- Run AFTER 20261111_shared_ip_spin.sql (the 6-arg spin_daily in force).
-- One transaction, rerunnable: create or replace functions only — no table
-- change, no data change, nothing destructive.
--
-- Approved wheel (single unit: VOTES; prizes still land in bonus_credits):
--     +1   30%   | +2  25%   | +3  20%   | +5  12%
--     +8    8%   | +10  4%   | +20  1%  (jackpot, opposite the pointer)
--   average 3.24 votes per spin (6.48/day at two spins). Every spin wins.
--   The browser renders public.daily_spin_prizes() + daily_spin_weights() and
--   animates to the returned sector; it never picks the reward.
--
-- WHY the draw changed shape. Sixteen equal sectors could stay uniform with one
-- byte (256 % 16 = 0). Seven sectors with 30/25/20/12/8/4/1 odds cannot: a raw
-- `byte % 7` overpays sector 0 by +2.6 points and silently re-weights the whole
-- wheel. So the draw goes through rejection sampling with TWO bytes:
--   raw = byte0*256 + byte1   (0..65535)
--   accept only raw < 65536 - (65536 % v_total)  →  r = raw % v_total is EXACTLY
--   uniform over 0..v_total-1 (for v_total = 100: discard the top 36 values,
--   ~0.05% of draws; a fresh two-byte draw replaces a rejected one, 8 tries max
--   — the leftover fallback is uniform over the allowed sectors, so any bias is
--   bounded and only ever reachable below ~1e-4 probability).
--   r then walks the cumulative bands 30 | 55 | 75 | 87 | 95 | 99 | 100.
-- Every sector the player sees is exactly as fat as its approved weight: the
-- slice on screen IS the real chance, same doctrine as the 16-sector wheel.
--
-- KHÔNG LẶP QUÁ 2 LẦN (luật chủ dự án chốt 19/09) giữ nguyên và ĐƠN GIẢN đi:
-- hai lượt gần nhất của CÙNG một thiết bị trùng số thưởng thì lượt kế không
-- được ra số đó. Với 7 ô, mỗi giá trị sở hữu ĐÚNG MỘT ô, nên "bị chặn" = loại
-- đúng một dải: cùng phép rút r (đúng trọng số) chạy tiếp và dải mang số bị
-- chặn được rút lại — lấy mẫu loại bỏ đúng nghĩa, phân phối còn lại đúng bằng
-- phân phối cũ có điều kiện. Fallback 8 lượt vẫn là "đều trên các ô hợp lệ".
--
-- Not touched: quotas (2/device, 2/account, 2/fingerprint, IP shield), the
-- edge gate, advisory locks, device→account binding, the ledger schema, the
-- segment CHECK (0..15 still fits: historical rows keep 7..15, new draws only
-- produce 0..6). An old bundle keeps working: it renders the rewards array it
-- knows and ignores the extra `weights` payload key.

begin;

-- The ledger was created with an inline `check (reward in (1, 2, 3, 5))` —
-- the 20260908 widening only touched segment because the 16-sector wheel
-- still paid 1..5. Widen reward the same way 20260908 did for segment: drop
-- whatever the check is called on THIS project, then add the named one.
-- Existing rows pay 1..5, all still in the set, so validating cannot fail.
do $$
declare v_con record;
begin
  for v_con in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'daily_spins' and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%reward%'
  loop
    execute format('alter table public.daily_spins drop constraint %I', v_con.conname);
  end loop;
end $$;

alter table public.daily_spins
  add constraint daily_spins_reward_check check (reward in (1, 2, 3, 5, 8, 10, 20));

-- Seven sectors, one per value, ascending. Display order on the wheel equals
-- draw order (payload segment = index in this array); the +20 jackpot stays
-- opposite the pointer at six o'clock (the browser rotates the layout, not
-- this array).
create or replace function public.daily_spin_prizes()
returns int[] language sql immutable set search_path = public as $$
  select array[1, 2, 3, 5, 8, 10, 20];
$$;

-- Approved odds in percent, same length as prizes. spin_daily refuses to draw
-- unless the two tables agree and sum to exactly 100 (err.spinSetup) — a
-- hand-edited project must fail loudly, never pay by the wrong odds.
create or replace function public.daily_spin_weights()
returns int[] language sql immutable set search_path = public as $$
  select array[30, 25, 20, 12, 8, 4, 1];
$$;

revoke all on function public.daily_spin_weights() from public, anon, authenticated;

-- Re-declared in full (a plpgsql body cannot be patched). Identical to the
-- 20261111 version EXCEPT the marked draw block; grants survive
-- `create or replace` and are restated anyway.
create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid,
  p_fp_hash text default null, p_ip_hash text default null,
  p_gate_token text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_now timestamptz;
  v_day date;
  v_device_used int;
  v_account_used int;
  v_fp_used int;
  v_fp_slot smallint;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_sectors int := array_length(public.daily_spin_prizes(), 1);
  -- v2: approved odds per sector, in percent
  v_weights int[] := public.daily_spin_weights();
  v_total int := 0;
  v_bytes bytea;
  v_raw int;
  v_r int;
  v_acc int;
  -- Luật "không lặp quá 2 lần": hai số thưởng gần nhất của thiết bị này
  v_recent int[];
  v_block int;
  v_allowed int[];
  v_byte int;
  v_tries int;
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- ★ Cổng Edge: bật rồi thì gọi thẳng RPC (không qua Worker) bị từ chối, nên
  -- Turnstile + KV + hạn mức vân tay không còn đi vòng được nữa.
  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.spinGate'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.spinAccountChanged'; end if;
  if p_request_id is null then raise exception 'err.spinRequest'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);

  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

  perform 1 from public.daily_spin_devices where device_hash = v_hash for update;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  select * into v_spin from public.daily_spins
    where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_spin.device_hash <> v_hash then raise exception 'err.spinRequest'; end if;
    v_replayed := true;
  else
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;

    if p_fp_hash is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_fp_hash, 1));
    end if;

    -- The first successful spin binds this browser identity to ONE account
    -- for the VN day, even if that account has only used one of its two spins.
    -- The existing device row + fingerprint advisory locks serialize races.
    if exists (
      select 1 from public.daily_spins
       where spin_day = v_day and user_id is distinct from v_uid
         and (device_hash = v_hash or (p_fp_hash is not null and fp_hash = p_fp_hash))
    ) then raise exception 'err.spinDeviceAccount'; end if;

    select count(*)::int into v_device_used from public.daily_spins
      where device_hash = v_hash and spin_day = v_day;
    select count(*)::int into v_account_used from public.daily_spins
      where user_id = v_uid and spin_day = v_day;
    if v_device_used >= 2 then raise exception 'err.spinDeviceLimit'; end if;
    if v_account_used >= 2 then raise exception 'err.spinAccountLimit'; end if;

    v_fp_used := 0;
    v_fp_slot := null;
    if p_fp_hash is not null then
      select count(*)::int into v_fp_used from public.daily_spins
        where fp_hash = p_fp_hash and spin_day = v_day;
      if v_fp_used >= 2 then raise exception 'err.spinEdgeFp'; end if;
      v_fp_slot := v_fp_used + 1;
    end if;

    -- vvv CHANGED (v2): weighted draw over seven sectors. The prize table and
    -- the weight table must agree (same length, every weight >= 1, total
    -- 1..65536) or the wheel refuses to spin at all — err.spinSetup beats a
    -- silently wrong payout table.
    if v_sectors is null or v_weights is null
       or coalesce(array_length(v_weights, 1), 0) <> v_sectors then
      raise exception 'err.spinSetup';
    end if;
    for i in 1 .. v_sectors loop
      if v_weights[i] is null or v_weights[i] < 1 then
        raise exception 'err.spinSetup';
      end if;
      v_total := v_total + v_weights[i];
    end loop;
    if v_total < 1 or v_total > 65536 then raise exception 'err.spinSetup'; end if;

    -- KHÔNG LẶP QUÁ 2 LẦN (luật chủ dự án chốt 19/09): hai lượt gần nhất của
    -- thiết bị này mà trùng số thưởng thì lượt này không được ra số đó. Với 7 ô
    -- mỗi giá trị là đúng một dải, nên chặn = bỏ đúng một dải khỏi phép rút.
    select array_agg(reward) into v_recent from (
      select reward from public.daily_spins
        where device_hash = v_hash
        order by created_at desc, device_slot desc
        limit 2
    ) recent;
    v_block := null;
    if v_recent is not null and array_length(v_recent, 1) = 2
       and v_recent[1] = v_recent[2] then
      v_block := v_recent[1];
    end if;

    -- Một r đều 0..v_total-1 từ HAI byte, lấy mẫu loại bỏ: phần 65536 % v_total
    -- giá trị thừa bị vứt nên không dải nào béo hơn trọng số đã duyệt. Dải mang
    -- số bị chặn thì rút lại (vẫn đúng trọng số của các dải còn lại), tối đa
-- 8 lượt; quá đó rơi về phương án đều trên các ô hợp lệ — lệch có chặn,
-- xác suất dưới 1e-4.
    v_segment := null;
    v_tries := 0;
    while v_segment is null and v_tries < 8 loop
      v_tries := v_tries + 1;
      v_bytes := extensions.gen_random_bytes(2);
      v_raw := get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1);
      if v_raw < 65536 - (65536 % v_total) then
        v_r := v_raw % v_total;
        v_acc := 0;
        for i in 1 .. v_sectors loop
          v_acc := v_acc + v_weights[i];
          if v_r < v_acc then
            if v_prizes[i] is distinct from v_block then v_segment := i - 1; end if;
            exit;
          end if;
        end loop;
      end if;
    end loop;
    if v_segment is null then
      -- Fallback (xác suất < 1e-4): đều trên các ô hợp lệ, vẫn lấy mẫu loại bỏ
      -- với 256 % n đúng như luật 20261104. Bảng một giá trị duy nhất (mọi ô
      -- đều bị chặn) thì giữ ô đầu tiên — phải trả một thưởng, không có ô khác.
      select array_agg(i) into v_allowed
        from generate_subscripts(v_prizes, 1) as i
        where v_prizes[i] is distinct from v_block;
      if v_allowed is null or array_length(v_allowed, 1) = 0 then
        v_segment := 0;
      else
        v_byte := 0;
        v_tries := 0;
        loop
          v_byte := get_byte(extensions.gen_random_bytes(1), 0);
          v_tries := v_tries + 1;
          exit when v_byte < 256 - (256 % array_length(v_allowed, 1)) or v_tries >= 8;
        end loop;
        v_segment := v_allowed[(v_byte % array_length(v_allowed, 1)) + 1] - 1;
      end if;
    end if;
    -- ^^^ CHANGED
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at, fp_hash, ip_hash, fp_slot
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now, p_fp_hash, p_ip_hash, v_fp_slot
    ) returning * into v_spin;

    update public.profiles set bonus_credits = bonus_credits + v_spin.reward where id = v_uid;
  end if;

  return jsonb_build_object(
    'spin', jsonb_build_object(
      'request_id', v_spin.request_id, 'reward', v_spin.reward,
      'segment', v_spin.segment, 'created_at', v_spin.created_at, 'day', v_spin.spin_day
    ),
    'replayed', v_replayed,
    'status', public.daily_spin_payload(v_hash, v_uid, clock_timestamp())
  );
end $$;

revoke all on function public.spin_daily(text, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text, text) to authenticated;

-- Same shape as 20261107 plus ONE key: `weights` (percent per sector, same
-- order as `rewards`). The browser uses it to draw arcs and the odds list;
-- old bundles ignore it.
create or replace function public.daily_spin_payload(p_hash text, p_uid uuid, p_now timestamptz)
returns jsonb language sql security definer set search_path = public as $$
  with d as (
    select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day
  ), usage as (
    select d.day,
      (select count(*)::int from public.daily_spins s
       where s.device_hash = p_hash and s.spin_day = d.day) as device_used,
      (select count(*)::int from public.daily_spins s
       where s.user_id = p_uid and s.spin_day = d.day) as account_used
      ,exists (select 1 from public.daily_spins s
        where s.device_hash = p_hash and s.spin_day = d.day and s.user_id is distinct from p_uid) as device_account_blocked
    from d
  )
  select jsonb_build_object(
    'user_id', p_uid,
    'day', u.day,
    'server_now', p_now,
    'reset_at', (u.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'limit', 2,
    'device_used', u.device_used,
    'account_used', u.account_used,
    'device_account_blocked', u.device_account_blocked,
    'remaining', case when u.device_account_blocked then 0 else greatest(0, 2 - greatest(u.device_used, u.account_used)) end,
    'credits', (select p.vote_credits + p.bonus_credits from public.profiles p where p.id = p_uid),
    'purchased', (select p.vote_credits from public.profiles p where p.id = p_uid),
    'bonus', (select p.bonus_credits from public.profiles p where p.id = p_uid),
    'rewards', public.daily_spin_prizes(),
    'weights', public.daily_spin_weights(),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'request_id', s.request_id, 'reward', s.reward,
        'segment', s.segment, 'created_at', s.created_at, 'day', s.spin_day
      ) order by s.created_at desc, s.id)
      from public.daily_spins s where s.user_id = p_uid and s.spin_day = u.day
    ), '[]'::jsonb)
  ) from usage u;
$$;
revoke all on function public.daily_spin_payload(text, uuid, timestamptz) from public, anon, authenticated;

-- The segment CHECK stays 0..15 on purpose: rows written by the 16-sector wheel
-- keep their meaning, v2 draws only land in 0..6. Say so next to the constraint.
comment on constraint daily_spins_segment_check on public.daily_spins is
  '0..15 covers historical 16-sector rows; the 20261201 v2 wheel draws 0..6 only';

notify pgrst, 'reload schema';
commit;
