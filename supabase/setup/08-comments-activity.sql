
-- BEGIN COMMENTS / SPIN FIXES: mirror 20261107_comments_spin_fixes.sql
-- Follow 20261106_security_audit.sql. Rerunnable; no data is deleted on upgrade.
begin;

-- The previous DELETE policy selected profiles.is_admin directly, which fails
-- after column-level profile hardening. is_admin() is the authorized definer RPC.
drop policy if exists request_comments_owner_delete on public.request_comments;
drop policy if exists request_comments_owner_or_admin_delete on public.request_comments;
create policy request_comments_owner_or_admin_delete
  on public.request_comments for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());
grant delete on public.request_comments to authenticated;
-- Admins can also delete moderated/hidden rows; public readers still cannot.
drop policy if exists request_comments_admin_read on public.request_comments;
create policy request_comments_admin_read on public.request_comments for select to authenticated
  using (public.is_admin());

-- Clients cannot backdate comments to evade the existing 10/minute rate limit,
-- move a reply, choose its id, or hide/unhide a thread through an UPDATE.
revoke insert, update on public.request_comments from anon, authenticated;
grant insert (request_id, user_id, parent_id, body) on public.request_comments to authenticated;

create unique index if not exists request_comments_id_request_idx
  on public.request_comments (id, request_id);
-- NOT VALID preserves any historical bad rows without allowing NEW cross-
-- request links. Trigger validation also rejects hidden and missing parents.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'request_comments_parent_request_fk'
                 and conrelid = 'public.request_comments'::regclass) then
    alter table public.request_comments add constraint request_comments_parent_request_fk
      foreign key (parent_id, request_id) references public.request_comments (id, request_id)
      on delete cascade not valid;
  end if;
end $$;

drop policy if exists request_comments_authenticated_insert on public.request_comments;
create policy request_comments_authenticated_insert
  on public.request_comments for insert to authenticated
  with check (
    auth.uid() = user_id and deleted_at is null
    and (parent_id is null or exists (
      select 1 from public.request_comments p
       where p.id = request_comments.parent_id
         and p.request_id = request_comments.request_id
         and p.deleted_at is null
    ))
  );

create or replace function public.enforce_comment_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent public.request_comments;
  v_parent_id uuid := new.parent_id;
  v_seen uuid[] := array[new.id];
begin
  -- Preserve the existing per-author serialization, window, and limit.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 20260922));
  if (
    select count(*) from public.request_comments
     where user_id = new.user_id and created_at >= now() - interval '1 minute'
  ) >= 10 then
    raise exception 'err.commentRate';
  end if;
  -- Validate the whole chain as well: legacy rows may predate the composite
  -- FK. Do not let a new reply extend a hidden/cross-request/cyclic chain.
  while v_parent_id is not null loop
    if v_parent_id = any(v_seen) then raise exception 'err.commentParent'; end if;
    select * into v_parent from public.request_comments p
      where p.id = v_parent_id and p.request_id = new.request_id
        and p.deleted_at is null
      for share;
    if not found then raise exception 'err.commentParent'; end if;
    v_seen := array_append(v_seen, v_parent_id);
    v_parent_id := v_parent.parent_id;
  end loop;
  -- No root-only restriction and no rewriting of new.parent_id.
  return new;
end $$;
revoke all on function public.enforce_comment_limits() from public, anon, authenticated;
drop trigger if exists request_comments_limits on public.request_comments;
create trigger request_comments_limits before insert on public.request_comments
  for each row execute function public.enforce_comment_limits();

-- Hard delete cascades via the parent FK. Soft moderation hides the ENTIRE
-- subtree too; unhide is intentionally explicit (never resurrect descendants).
-- Immutable ancestry prevents cycles and cross-request chains via UPDATE.
create or replace function public.guard_comment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id or new.parent_id is distinct from old.parent_id
     or new.request_id is distinct from old.request_id or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'err.commentParent';
  end if;
  if new.deleted_at is null and old.deleted_at is not null and new.parent_id is not null then
    perform 1 from public.request_comments p
      where p.id = new.parent_id and p.request_id = new.request_id and p.deleted_at is null
      for share;
    if not found then raise exception 'err.commentParent'; end if;
  end if;
  return new;
end $$;
create or replace function public.hide_comment_subtree()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The outer invocation updates every descendant. Skip nested invocations.
  if pg_trigger_depth() > 1 then return new; end if;
  with recursive descendants(id) as (
    select id from public.request_comments where parent_id = new.id
    union
    select c.id from public.request_comments c join descendants d on c.parent_id = d.id
  )
  update public.request_comments set deleted_at = new.deleted_at
    where id in (select id from descendants) and deleted_at is null;
  return new;
end $$;
revoke all on function public.guard_comment_update() from public, anon, authenticated;
revoke all on function public.hide_comment_subtree() from public, anon, authenticated;
drop trigger if exists request_comments_update_guard on public.request_comments;
create trigger request_comments_update_guard before update on public.request_comments
  for each row execute function public.guard_comment_update();
drop trigger if exists request_comments_hide_subtree on public.request_comments;
create trigger request_comments_hide_subtree after update of deleted_at on public.request_comments
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.hide_comment_subtree();

create or replace function public.comment_mention_handle(p_name text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', '_', 'g'));
$$;
revoke all on function public.comment_mention_handle(text) from public, anon, authenticated;

-- Keep canonical schema/fresh installs aligned with the notification migration.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('near','lead','approved','picked','started','progress','done','denied','votes','expired','comment','reply','mention'));

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests;
  v_parent public.request_comments;
  v_author text;
  v_mentioned record;
begin
  if new.deleted_at is not null then return new; end if;
  select name into v_author from public.profiles where id = new.user_id;
  v_author := coalesce(v_author, 'Member');
  select * into v_req from public.requests where id = new.request_id;
  if new.parent_id is null then
    if v_req.user_id is not null and v_req.user_id <> new.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (v_req.user_id, public.song_key(v_req.artist, v_req.title), 'comment',
              v_req.id, v_req.title, v_req.artist,
              v_author || ': ' || left(new.body, 120), 'comment|' || new.id::text)
      on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  else
    -- Notify the immediate parent author, not the root author.
    select * into v_parent from public.request_comments
      where id = new.parent_id and request_id = new.request_id and deleted_at is null;
    if v_parent.user_id is not null and v_parent.user_id <> new.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (v_parent.user_id, public.song_key(v_req.artist, v_req.title), 'reply',
              v_req.id, v_req.title, v_req.artist,
              v_author || ' replied: ' || left(new.body, 120), 'reply|' || new.id::text)
      on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  end if;
  -- Exact normalized tokens, not substring matches (@ann must not match @anna).
  -- Names with spaces are mentioned as @park_ssaem. Self mentions stay visible
  -- in the comment but do not notify the sender. Keep the five-recipient cap.
  for v_mentioned in
    select p.id from public.profiles p
      where p.id <> new.user_id
        and p.id is distinct from v_parent.user_id
        and public.comment_mention_handle(p.name) in (
          select lower(m[2]) from regexp_matches(new.body, '(^|[^[:alnum:]_.@-])@([[:alnum:]_.-]+)', 'g') m
        )
      order by p.id limit 5
  loop
    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (v_mentioned.id, public.song_key(v_req.artist, v_req.title), 'mention',
            v_req.id, v_req.title, v_req.artist,
            v_author || ' mentioned you: ' || left(new.body, 120),
            'mention|' || new.id::text || '|' || v_mentioned.id::text)
    on conflict (user_id, sig) where sig is not null do nothing;
  end loop;
  return new;
end $$;
revoke all on function public.notify_on_comment() from public, anon, authenticated;
drop trigger if exists tr_notify_on_comment on public.request_comments;
create trigger tr_notify_on_comment after insert on public.request_comments
  for each row execute function public.notify_on_comment();

-- ONE account per browser/day (not physical-device identification).
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
  v_ip_distinct int;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_sectors int := array_length(public.daily_spin_prizes(), 1);
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
    if p_ip_hash is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 2));
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

    if p_ip_hash is not null then
      select count(distinct fp_hash)::int into v_ip_distinct from public.daily_spins
        where ip_hash = p_ip_hash and spin_day = v_day
          and fp_hash is not null
          and fp_hash is distinct from p_fp_hash;
      if v_ip_distinct >= 5 then raise exception 'err.spinEdgeIp'; end if;
    end if;

    if v_sectors is null or v_sectors < 1 or 256 % v_sectors <> 0 then
      raise exception 'err.spinSetup';
    end if;
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % v_sectors;

    -- KHÔNG LẶP QUÁ 2 LẦN (luật chủ dự án chốt 19/09): HAI lượt gần nhất của
    -- thiết bị này mà đã ra cùng một số thưởng thì lượt này không được ra số đó
    -- nữa. Ô vẫn rút đều trên 16 ô; chỉ khi luật bật thì tập ô hợp lệ mới hẹp
    -- lại, và vì tập đó (7 hoặc 12 ô) không chia hết 256 nên phải LẤY MẪU LOẠI
    -- BỎ — dùng `byte % n` trần là lệch xác suất, phá đúng cái cam kết "ô nào
    -- cũng thật" của bảng thưởng.
    select array_agg(reward) into v_recent from (
      select reward from public.daily_spins
        where device_hash = v_hash
        order by created_at desc, device_slot desc
        limit 2
    ) recent;
    if v_recent is not null and array_length(v_recent, 1) = 2
       and v_recent[1] = v_recent[2] and v_prizes[v_segment + 1] = v_recent[1] then
      v_block := v_recent[1];
      select array_agg(i) into v_allowed
        from generate_subscripts(v_prizes, 1) as i
        where v_prizes[i] <> v_block;
      if v_allowed is not null and array_length(v_allowed, 1) > 0 then
        v_tries := 0;
        loop
          v_byte := get_byte(extensions.gen_random_bytes(1), 0);
          v_tries := v_tries + 1;
          exit when v_byte < 256 - (256 % array_length(v_allowed, 1)) or v_tries >= 8;
        end loop;
        v_segment := v_allowed[(v_byte % array_length(v_allowed, 1)) + 1] - 1;
      end if;
    end if;
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

-- Fingerprint-aware status for a newly issued browser token. Keep the one-arg
-- RPC for old clients; neither endpoint grants a spin or exposes another user's
-- identity/history. Authorization still happens atomically in spin_daily.
create or replace function public.my_daily_spin_status(p_device_token text, p_fp_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status jsonb;
  v_now timestamptz := clock_timestamp();
  v_used int;
  v_blocked boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  v_status := public.daily_spin_payload(public.daily_spin_device_hash(p_device_token), v_uid, v_now);
  if p_fp_hash is not null and p_fp_hash ~ '^[a-f0-9]{64}$' then
    select count(*)::int, coalesce(bool_or(user_id is distinct from v_uid), false)
      into v_used, v_blocked from public.daily_spins
      where fp_hash = p_fp_hash and spin_day = (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
    v_blocked := v_blocked or (v_status->>'device_account_blocked')::boolean;
    v_status := v_status || jsonb_build_object(
      'device_account_blocked', v_blocked,
      'remaining', case when v_blocked then 0 else least((v_status->>'remaining')::int, greatest(0, 2 - v_used)) end
    );
  end if;
  return v_status;
end $$;
revoke all on function public.my_daily_spin_status(text, text) from public, anon, authenticated;
grant execute on function public.my_daily_spin_status(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
-- END COMMENTS / SPIN FIXES

-- A signed-in visit is an activity day.
-- Follows 20260921_activity_days.sql and 20261106_security_audit.sql.
-- Rerunnable. Does not delete rows and does not accept a client-supplied date.
begin;

-- Direct comment inserts run as the caller. The stamp function must be the
-- definer, or the revoked INSERT privilege rolls the comment back and the day
-- is never stored. Action RPCs already run as definer; this keeps both paths.
create or replace function public.touch_activity_day() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_days (user_id, day)
  values (new.user_id, (coalesce(new.created_at, now()) at time zone 'Asia/Ho_Chi_Minh')::date)
  on conflict (user_id, day) do nothing;
  return new;
end $$;
revoke all on function public.touch_activity_day() from public;

drop trigger if exists activity_on_request on public.requests;
create trigger activity_on_request after insert on public.requests
for each row when (new.user_id is not null) execute function public.touch_activity_day();

drop trigger if exists activity_on_vote on public.votes;
create trigger activity_on_vote after insert on public.votes
for each row when (new.user_id is not null) execute function public.touch_activity_day();

drop trigger if exists activity_on_comment on public.request_comments;
create trigger activity_on_comment after insert on public.request_comments
for each row when (new.user_id is not null) execute function public.touch_activity_day();

drop trigger if exists activity_on_spin on public.daily_spins;
create trigger activity_on_spin after insert on public.daily_spins
for each row when (new.user_id is not null) execute function public.touch_activity_day();

-- No arguments: the caller cannot stamp another account or a past/future day.
-- One row per account per Vietnam calendar day. Opening the site again today
-- is a no-op, not a second day.
create or replace function public.touch_my_activity()
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if v_uid is null then
    raise exception 'err.signin';
  end if;
  insert into public.activity_days (user_id, day)
  values (v_uid, v_day)
  on conflict (user_id, day) do nothing;
  return v_day;
end $$;

revoke all on function public.touch_my_activity() from public, anon;
grant execute on function public.touch_my_activity() to authenticated;

-- Repair days that already happened as a request, vote, comment or spin but
-- were never stamped (trigger added later, or a write path that missed it).
-- Pure visits from before this function existed were not stored anywhere, so
-- they cannot be reconstructed. Skip ids that are no longer auth users so one
-- orphan row cannot abort the repair.
insert into public.activity_days (user_id, day)
select src.user_id, src.day
from (
  select r.user_id, (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day
    from public.requests r
   where r.user_id is not null
  union
  select v.user_id, (v.created_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.votes v
   where v.user_id is not null
  union
  select c.user_id, (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.request_comments c
   where c.user_id is not null
  union
  select s.user_id, (s.created_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.daily_spins s
   where s.user_id is not null
) src
where exists (select 1 from auth.users u where u.id = src.user_id)
on conflict (user_id, day) do nothing;

notify pgrst, 'reload schema';
commit;
