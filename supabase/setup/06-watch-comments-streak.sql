
-- =========================================================
-- THEO DÕI BÀI + THÔNG BÁO  (2026-09-08)
--   Thiết kế: docs/THEO-DOI-THONG-BAO.md (mục 3 + 4).
--   Phần nhìn đã chạy bằng localStorage (src/lib/watch.js); khối này là bản DB
--   thay chỗ lưu. CHƯA nối frontend: src/lib/watch.js vẫn đọc localStorage cho
--   tới khi chủ repo duyệt (xem mục 5 của tài liệu). Additive, chạy lại an toàn:
--   chỉ CREATE/ALTER/CREATE OR REPLACE, không DROP/TRUNCATE bảng.
-- =========================================================

-- 3.1 theo dõi: khóa theo BÀI (artist + title đã chuẩn hoá), không theo dòng.
--     Khớp đúng groupKey() trong src/lib/board.js (trim + lower + nối '\n') để
--     một bài bị nhiều người gửi lẻ vẫn chỉ là MỘT mục theo dõi.
create table if not exists public.watches (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  song_key   text not null,
  artist     text not null,
  title      text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, song_key)
);
alter table public.watches enable row level security;
drop policy if exists watches_read on public.watches;
create policy watches_read on public.watches for select using (auth.uid() = user_id);
-- KHÔNG có policy ghi: mọi thay đổi đi qua RPC, giống các bảng còn lại (RA-SOAT 2.x).
revoke insert, update, delete on public.watches from public, anon, authenticated;
grant select on public.watches to authenticated;

create or replace function public.song_key(p_artist text, p_title text)
returns text language sql immutable as $$
  select lower(trim(coalesce(p_artist,''))) || E'\n' || lower(trim(coalesce(p_title,'')))
$$;
revoke all on function public.song_key(text, text) from public, anon, authenticated;

create index if not exists watches_song_key_idx on public.watches (song_key);

-- 3.2 hộp thư
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  song_key   text,
  request_id uuid,
  kind       text not null check (kind in
               ('near','lead','approved','picked','started','progress','done','denied','votes','expired')),
  /* chu kỳ chốt — để 'near'/'lead' chỉ được ghi ĐÚNG MỘT LẦN mỗi đợt chốt */
  cycle      text,
  title      text, artist text, url text, pct int, votes int,
  /* lý do từ chối — in NGUYÊN VĂN deny_reason ra dòng tin (Item trong
     Notifications.jsx render n.reason, không được cắt xén) */
  reason     text,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  sent_at    timestamptz
);
alter table public.notifications add column if not exists reason text;
alter table public.notifications add column if not exists dismissed_at timestamptz;
alter table public.notifications enable row level security;
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select
  using (auth.uid() = user_id and dismissed_at is null);
-- chỉ được tự đánh dấu đã đọc, không được sửa gì khác: grant update chỉ cột read_at
drop policy if exists notif_read_own on public.notifications;
create policy notif_read_own on public.notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id and read_at is not null);
revoke update on public.notifications from public, anon, authenticated;
grant  update (read_at) on public.notifications to authenticated;
grant select on public.notifications to authenticated;
create index if not exists notif_user_new_idx
  on public.notifications (user_id, created_at desc) where read_at is null;
/* Một dòng tin = một (người, chữ ký) — đây là bản DB của cái `id` mà
   pushNotices() trong prototype dùng để chống realtime đẩy trùng. */
alter table public.notifications add column if not exists sig text;
create unique index if not exists notif_sig_uidx on public.notifications (user_id, sig)
  where sig is not null;
-- mỗi đợt chốt chỉ một tin "gần tới lượt" cho một bài: thật là khi cứ mỗi
-- lá phiếu lại thấy "còn 2 vote nữa"
create unique index if not exists notif_one_near_per_cycle on public.notifications
  (user_id, song_key, kind, cycle) where kind in ('near','lead');
revoke insert, delete on public.notifications from public, anon, authenticated;
revoke update (dismissed_at) on public.notifications from public, anon, authenticated;

create or replace function public.dismiss_notification(p_id bigint default null, p_sig text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sig text := nullif(btrim(coalesce(p_sig, '')), '');
begin
  if v_uid is null then
    raise exception 'err.signin';
  end if;
  if v_sig is not null and length(v_sig) > 500 then
    v_sig := null;
  end if;
  if p_id is null and v_sig is null then
    return;
  end if;
  update public.notifications
     set dismissed_at = coalesce(dismissed_at, now())
   where user_id = v_uid
     and dismissed_at is null
     and (
       (p_id is not null and id = p_id)
       or (v_sig is not null and sig = v_sig)
     );
end $$;

revoke all on function public.dismiss_notification(bigint, text) from public, anon;
grant execute on function public.dismiss_notification(bigint, text) to authenticated;

-- 3.3 toggle_watch: trần 60 bài/tài khoản (WATCH_LIMIT trong src/lib/watch.js),
--     chống dựng danh sách để spam. Chạm trần là BÁO VÀ TỪ CHỐI, không im lặng
--     bỏ bài cũ — khớp toggleWatched().
create or replace function public.toggle_watch(p_artist text, p_title text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); k text := public.song_key(p_artist, p_title); v_has boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'err.needFields';
  end if;
  select exists (select 1 from watches where user_id = v_uid and song_key = k) into v_has;
  if v_has then
    delete from watches where user_id = v_uid and song_key = k;
    return false;
  end if;
  if (select count(*) from watches where user_id = v_uid) >= 60 then
    raise exception 'err.watchLimit';
  end if;
  insert into watches(user_id, song_key, artist, title)
    values (v_uid, k, trim(p_artist), trim(p_title))
  on conflict (user_id, song_key) do nothing;
  return true;
end $$;
grant execute on function public.toggle_watch(text, text) to authenticated;

-- 3.4 bài của mình được theo dõi tự động. Trong prototype việc này cần
--     syncOwnRequests() đối chiếu CẢ BẢNG mỗi lần nạp và một danh sách
--     ccl3_woff riêng để "tắt thì tắt hẳn". Xuống DB thì đơn giản hơn nhiều:
--     chỉ cần ghi một dòng vào watches lúc INSERT request, không có vòng lặp
--     đối chiếu nào cả, và bỏ theo dõi là sạch — không có ai ghi nó trở lại.
alter table public.watches add column if not exists own boolean not null default false;

create or replace function public.requests_selfwatch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    insert into watches(user_id, song_key, artist, title, own)
      values (new.user_id, public.song_key(new.artist, new.title), new.artist, new.title, true)
    on conflict (user_id, song_key) do nothing;   -- người đã tắt thì không bật lại
  end if;
  return new;
end $$;
drop trigger if exists requests_selfwatch_tri on public.requests;
create trigger requests_selfwatch_tri after insert on public.requests
  for each row execute function public.requests_selfwatch();

-- 4. Trigger sinh tin khi một request đổi trạng thái / được chốt / nhích tiến độ.
--     Thứ tự case = thứ tự ưu tiên PRIORITY trong src/lib/watch.js (trừ near/lead
--     do cron lo): một lần UPDATE chỉ sinh MỘT tin cho một bài và phải chọn tin
--     đáng đọc nhất — khớp diffNotices() chọn theo PRIORITY. Vì vậy 'picked'
--     đứng TRƯỚC 'started' (cùng lúc lên in_progress + được chốt thì báo "Up
--     next", không báo "Moved into production"), và 'started' chỉ khi status
--     THỰC SỰ đổi sang in_progress (không phải mỗi lần progress nhích).
create or replace function public.requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := public.song_key(old.artist, old.title); v_kind text;
begin
  v_kind := case
    when new.status = 'completed'   and old.status <> 'completed'   then 'done'
    when new.status = 'denied'      and old.status <> 'denied'      then 'denied'
    when new.picked_at is not null and old.picked_at is null
         and new.status <> 'completed'                              then 'picked'
    when new.status = 'in_progress' and old.status <> 'in_progress' then 'started'
    when old.status = 'pending'     and new.status = 'queued'       then 'approved'
    when new.status = 'in_progress' and new.progress > old.progress then 'progress'
    else null end;
  if v_kind is not null then
    -- PHẠM VI = đang theo dõi ∪ NGƯỜI ĐÃ BỎ PHIẾU CHO BÀI ĐÓ.
    -- Kết quả cuộc chốt phải tới tay người đã vote, kể cả khi họ chẳng bấm
    -- chuông nào — đó là luồng bằng mới giữ được họ quay lại.
    insert into notifications(user_id, song_key, kind, request_id, title, artist, url, pct, votes, reason, sig)
    select u.user_id, k, v_kind, new.id, new.title, new.artist, new.video_url, new.progress, new.votes,
           case when new.status = 'denied' then new.deny_reason end,
           k || '|' || v_kind || ':' || case v_kind
             when 'done' then coalesce(new.video_url,'')
             when 'progress' then new.progress::text
             else new.status end
      from (
        select user_id from watches where song_key = k
        union
        select v.user_id from votes v join requests r on r.id = v.request_id
         where public.song_key(r.artist, r.title) = k
      ) u
    on conflict (user_id, sig) where sig is not null do nothing;
  end if;
  return new;
end $$;
drop trigger if exists requests_notify_tri on public.requests;
create trigger requests_notify_tri after update of status, picked_at, video_url, progress, votes
  on public.requests for each row execute function public.requests_notify();

/* Hai thứ KHÔNG được đặt trong trigger này (để gộp chứ không spam):
   * Mốc "+5 vote": mỗi lá phiếu là một UPDATE requests, nên 40 người vote = 40
     tin. Cho notify-flush tự gom count(*) của votes theo bài thì đúng và rẻ.
   * near/lead ("còn 2 vote nữa là tới lượt chốt"): không gắn với một lần update
     nào, mà là hệ quả của cả bảng. Prototype tính bằng pickLadder(rows) rồi để
     diffNotices() phát hiện lúc bước vào vùng 3 phiếu. Xuống DB thì để cron
     notify-flush tính lại bằng đúng truy vấn của pick_top_request và ghi có
     cycle = (select value->>'last_pick_at' from settings where key='pick');
     notif_one_near_per_cycle ở 3.2 chặn ghi trùng.
   Nhớ luật pickLadder đã mô phỏng: bài trả tiền đứng trước, nên khi trong hàng
   còn một bài paid mà bài đang theo dõi không paid thì gap chỉ là số trang trí —
   prototype im lặng (không hứa suông), bản DB cũng vậy. */

-- 4b. Gộp theo đợt: một tin cho một người, không gửi từng dòng.
--     KHUNG CHƯA GỬI GÌ: hàm chỉ đánh dấu sent_at; việc gọi ra ngoài (Discord
--     webhook / Telegram sendMessage / Resend) phải do một Edge Function hoặc
--     Workers cron đọc bảng này làm — net fetch không chạy được trong Postgres
--     và không đặt key ngoài vào DB. ĐỪNG cron.schedule('notify-flush') cho tới
--     khi có sender thật, nếu không tin bị đánh dấu sent mà chưa tới tay ai.
create or replace function public.flush_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare v int := 0; r record;
begin
  for r in
    select user_id, jsonb_agg(jsonb_build_object(
             'kind', kind, 'title', title, 'artist', artist, 'url', url, 'pct', pct, 'votes', votes)
             order by created_at) as items
      from notifications
     where sent_at is null and created_at > now() - interval '1 day'
     group by user_id
  loop
    update notifications set sent_at = now() where user_id = r.user_id and sent_at is null;
    v := v + 1;
  end loop;
  return v;
end $$;
revoke all on function public.flush_notifications() from public, anon, authenticated;
grant execute on function public.flush_notifications() to service_role;

-- pg_cron đã bật cho auto-pick-top → dùng lại cùng hạ tầng. Đặt lệch pha với
-- auto-pick-top (cũng */30) một nhịp để hai job không dành nhau:
-- select cron.schedule('notify-flush', '5,35 * * * *', $$select public.flush_notifications()$$);

-- =========================================================
-- SPIN — KHÔNG LẶP QUÁ 2 LẦN (2026-11-04) —
-- migrations/20261104_spin_streak.sql, kept verbatim so a fresh install ends
-- with the same rule a migrated project has.
-- =========================================================
begin;

-- Bản 5 tham số (20261102) đã bị bỏ ở 20261103; drop lại cho chắc trên project
-- còn sót bản cũ — hai hàm trùng tên làm lời gọi 5 tham số thành "not unique".
drop function if exists public.spin_daily(text, uuid, uuid, text, text);

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

notify pgrst, 'reload schema';
commit;

notify pgrst, 'reload schema';


-- Serialise concurrent additions. Hidden and featured entries count as well.
create or replace function public.enforce_media_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(20260919, 20);
  if (select count(*) from public.media) >= 20 then
    raise exception 'err.mediaLimit';
  end if;
  return new;
end $$;
revoke all on function public.enforce_media_limit() from public;
drop trigger if exists media_limit on public.media;
create trigger media_limit before insert on public.media
for each row execute function public.enforce_media_limit();

-- =========================================================
-- 19.5. REQUEST COMMENTS + REPLIES
-- =========================================================
create table if not exists public.request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.request_comments(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 180),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists request_comments_request_created_idx
  on public.request_comments (request_id, created_at desc);
create index if not exists request_comments_parent_idx
  on public.request_comments (parent_id, created_at asc);
alter table public.request_comments enable row level security;
drop policy if exists request_comments_public_read on public.request_comments;
create policy request_comments_public_read on public.request_comments for select using (deleted_at is null);
drop policy if exists request_comments_authenticated_insert on public.request_comments;
create policy request_comments_authenticated_insert on public.request_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and (parent_id is null or exists (
      select 1 from public.request_comments p
       where p.id = request_comments.parent_id
         and p.request_id = request_comments.request_id
    ))
  );
drop policy if exists request_comments_owner_delete on public.request_comments;
create policy request_comments_owner_delete on public.request_comments for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());
grant select on public.request_comments to anon, authenticated;
grant insert, delete on public.request_comments to authenticated;

-- =========================================================
-- 20. ACTIVITY DAYS (streak + badge 7/30/100)
-- keep identical to migrations/20260921_activity_days.sql
-- =========================================================
-- BEGIN ACTIVITY DAYS: keep identical to the migration file, verbatim.
create table if not exists public.activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
create index if not exists activity_days_day_idx on public.activity_days (day);

alter table public.activity_days enable row level security;
drop policy if exists "read activity days" on public.activity_days;
create policy "read activity days" on public.activity_days for select using (true);
revoke insert, update, delete on public.activity_days from anon, authenticated;

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
-- END ACTIVITY DAYS
