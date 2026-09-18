# Theo dõi bài + thông báo — thiết kế cho bản thật

Ngày 2026-09-08 · trạng thái: **prototype trong trình duyệt đã chạy được**, phần database
đã viết vào `supabase/schema.sql` (khối "THEO DÕI BÀI + THÔNG BÁO" ở cuối file, đúng thiết kế
mục 3 + 4 dưới đây). **Chưa nối frontend**: `src/lib/watch.js` vẫn đọc localStorage cho tới khi
chủ repo duyệt (xem mục 5).

## 1. Prototype hiện có (code đã nằm trong repo)

| Chỗ | Việc |
|---|---|
| `src/lib/watch.js` | Toàn bộ logic: theo dõi theo **bài** (`groupKey`), `pickLadder()` mô phỏng đúng `pick_top_request`, so snapshot sinh tin, dồn ưu tiên, trần 60 bài + 60 tin, chống trùng id, `syncOwnRequests` tự theo dõi bài của mình |
| `src/components/Notifications.jsx` | Chuông + **bảng thông báo mở tại chỗ** (kiểu FB/IG/X): tin gom theo trạng thái, mỗi dòng có sẵn nút Vote / Watch / ×, "Mark all read" ở đầu bảng (chân bảng đã bỏ cùng mọi dòng chú thích), ⚙ mở sang bảng cài đặt — chỉ 4 công tắc loại tin (danh sách *Following* để ở tab *Following* của bảng, nhét vào đây là thừa). Đầu nhóm *Needs your votes* có nut **Vote now** thay cho dong dem nguoc; bam mot tin la **nhay thang toi dong request tren bang** (lam sáng hàng), khong mo hop thoai trung gian |
| `src/components/Standing.jsx` | Dòng "còn 2 vote nữa là tới lượt chốt" dưới mỗi bài / trong *Bài của bạn* — **chỉ hiện với bài đang theo dõi** (đã chốt 08/09: người ngoài chỉ xem bảng không cần thấy hạng near/lead) |
| (chuông nằm trong `Notifications.jsx`) | Huy hiệu số tin chưa đọc trên nút chuông — không còn mục "Updates" trong sidebar |
| `src/components/Countdown.jsx` | Đồng hồ "còn bao lâu tới lượt chốt", **một nguồn duy nhất** — khối Up next trên bảng; đọc thẳng `settings.key='pick'` (`interval_days` mặc định 4). Trong hộp thư **không** bày đồng hồ nữa: một dòng chỉ để đọc mà bấm không ra việc gì thì người dùng muốn nút *Vote now* hơn (họ yêu cầu đúng ý đó) |
| `src/components/FollowBtn.jsx` | Chuông **mờ** ở cuối dòng meta (hàng lẻ) và ở cột phải đầu cụm: ẩn → hiện khi rê/focus, đang bật thì thành chấm 4px. Một công tắc cho **cả bài**, nên dòng trong cụm không có nút |
| `src/App.jsx` | Nạp theo tài khoản, đối chiếu mỗi lần `rows` đổi, một toast gộp cho cả đợt, nhảy tới bài và làm sáng hàng, tab lọc **Following**. Thay đổi do **chính tay admin** tick (duyệt / mốc tiến độ / chốt / duyệt đơn paid) thì bỏ qua tự-thông-báo cho mình (`selfActRef` chặn cả toast lẫn mục hộp thư — đã chốt 08/09) |
| `src/lib/watch.test.js` · `src/components/Notifications.test.js` | 29 + 11 ca, chạy bằng `npm test` |
| `src/index.css` (khối `NOTIFICATIONS`) | Kiểu của chuông + bảng. Lưu ý: phải **reset lại** rule phần tử toàn cục (`input`, `label`) — xem mục 6.6 |

Những gì prototype đang dùng thay cho database: `localStorage`, theo khóa
`ccl3_watch:<uid>` / `ccl3_box:<uid>` / `ccl3_pref:<uid>` / `ccl3_woff:<uid>`
(danh sách bài của mình mà người dùng **tự tay** tắt, để tự động không bật lại).

Bốn quyết định đã thay so với bản đầu, vì bản đầu là nhật ký trạng thái chứ không phải
thứ người dùng cần:
1. bài mình gửi được theo dõi **tự động** (không phải đi tìm chuông trong danh sách);
2. tin phải **làm được gì** — vì vậy mới có `pickLadder()` và hai loại `near` / `lead`;
3. thông báo là **bảng mở tại chỗ dưới chuông** (kiểu FB/IG/X): không có "trang thông
   báo" riêng trong sidebar, nhưng khác popover bản đầu ở chỗ dữ liệu nằm trong hộp thư —
   đóng bảng bằng Esc/click ngoài là đóng giao diện, không phải xoá tin;
4. **phạm vi báo = đang theo dõi ∪ đã bỏ phiếu**, và bài mình gửi thì luôn luôn (kể cả
   tiến độ): người bỏ phiếu có quyền biết kết quả lượt chốt;
5. hết trần thì **báo và từ chối**, không im lặng bỏ bài cũ nhất ra khỏi danh sách.

## 2. Vì sao phải xuống database

Bảng đã có realtime (`src/App.jsx`, channel `live`), nên **khi đang mở tab** thì
thông báo hiện gần như tức thì. Vấn đề còn lại là lúc **đóng tab** — mà đó mới là lúc
người dùng cần được gọi quay lại (bài được duyệt, bài vào Up next, bài đã có video).
Vậy cần ba thứ mà localStorage không thay được:

1. `watches` — danh sách theo dõi nằm ở server, đổi máy là vẫn còn;
2. `notifications` — hộp thư, và là chỗ để gửi ra Discord/Telegram/email;
3. một job gộp tin, vì gửi riêng từng dòng thì thành spam.

## 3. Schema

```sql
-- 3.1 theo dõi: khóa theo BÀI (artist + title đã chuẩn hoá), không theo dòng.
--     Khớp đúng groupKey() trong src/lib/board.js để một bài bị xé lẻ vẫn là MỘT mục.
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
-- KHÔNG có policy ghi: mọi thay đổi đi qua RPC, giống các bảng còn lại (xem RA-SOAT 2.x)

create or replace function public.song_key(p_artist text, p_title text)
returns text language sql immutable as $$
  select lower(trim(coalesce(p_artist,''))) || E'\n' || lower(trim(coalesce(p_title,'')))
$$;

create index if not exists watches_song_key_idx on public.watches (song_key);

-- 3.2 hộp thư
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  song_key   text,
  request_id uuid,
  kind       text not null check (kind in
               ('near','lead','approved','picked','started','progress','done','denied','votes')),
  /* chu ky chot — de 'near'/'lead' chi duoc ghi DUNG MOT LAN moi dot chot */
  cycle      text,
  title      text, artist text, url text, pct int, votes int,
  /* ly do tu choi — in NGUYEN VAN deny_reason ra dong tin (Item trong
     Notifications.jsx render n.reason, khong duoc cat xen) */
  reason     text,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  sent_at    timestamptz
);
alter table public.notifications enable row level security;
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select using (auth.uid() = user_id);
drop policy if exists notif_read_own on public.notifications;
-- chỉ được tự đánh dấu đã đọc, không được sửa gì khác: policy + grant chỉ cột read_at
create policy notif_read_own on public.notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id and read_at is not null);
revoke update on public.notifications from public, anon, authenticated;
grant  update (read_at) on public.notifications to authenticated;
create index if not exists notif_user_new_idx
  on public.notifications (user_id, created_at desc) where read_at is null;
/* Mot dong tin = mot (nguoi, chu) — day la ban DB cua cai `id` ma
   pushNotices() trong prototype dung de chong realtime day trung. */
alter table public.notifications add column if not exists sig text;
create unique index if not exists notif_sig_uidx on public.notifications (user_id, sig)
  where sig is not null;
-- moi dot chot chi mot tin "gan toi luot" cho mot bai: that la khi cu moi
-- la phieu lai thay "con 2 vote nua"
create unique index if not exists notif_one_near_per_cycle on public.notifications
  (user_id, song_key, kind, cycle) where kind in ('near','lead');
revoke insert, delete on public.notifications from public, anon, authenticated;

-- 3.3 toggle_watch: trần 60 bài/tài khoản, chống dựng danh sách để spam
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

-- 3.4 bai cua minh duoc theo doi tu dong. Trong prototype,viec nay can
--     `syncOwnRequests()` doi chieu CA BANG moi lan nap va mot danh sach
--     `ccl3_woff` rieng de "tat thi tat han". Xuong DB thi don gian hon nhieu:
--     chi can ghi mot dong vao `watches` luc INSERT request, khong co vong lap
--     doi chieu nao ca, va bo theo doi la sach — khong co ai ghi no tro lai.
alter table public.watches add column if not exists own boolean not null default false;

-- Ghi tu dong luc mot request duoc tao — bang voi "gui xong la duoc theo doi"
create or replace function public.requests_selfwatch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    insert into watches(user_id, song_key, artist, title, own)
      values (new.user_id, public.song_key(new.artist, new.title), new.artist, new.title, true)
    on conflict (user_id, song_key) do nothing;   -- nguoi da tat thi khong bat lai
  end if;
  return new;
end $$;
create trigger requests_selfwatch_tri after insert on public.requests
  for each row execute function public.requests_selfwatch();
```

`err.watchLimit` **phải** có trong `src/lib/i18n.jsx` — quy ước của repo (mục 1.4 của
`docs/RA-SOAT-2026-09-08.md`): mọi key `raise` trong SQL phải có mặt trong từ điển,
key này đã thêm sẵn từ prototype.

## 4. Trigger + ống gửi

```sql
-- Chỉ khi cột liên quan đổi; chỉ ghi cho người thật theo dõi bài đó.
-- Thứ tự case = thứ tự ưu tiên PRIORITY trong src/lib/watch.js (trừ near/lead do
-- cron lo): một lần UPDATE chỉ sinh MỘT tin cho một bài và phải chọn tin đáng đọc
-- nhất — khớp diffNotices() chọn theo PRIORITY. Vì vậy 'picked' đứng TRƯỚC 'started'
-- (cùng lúc lên in_progress + được chốt thì báo "Up next"), và 'started' chỉ khi
-- status THỰC SỰ đổi sang in_progress (không phải mỗi lần progress nhích).
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
    -- PHAM VI = dang theo doi U NGUOI DA BO PHIEU CHO BAI DO.
    -- Ket qua cuoc chot phai toi tay nguoi da vote, ke ca khi ho chang bam
    -- chuong nao — do la luong bang moi giu duoc ho quay lai.
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
create trigger requests_notify_tri after update of status, picked_at, video_url, progress, votes
  on public.requests for each row execute function public.requests_notify();
```

> **Hai thứ không được đặt trong trigger này.**
>
> * Mốc "+5 vote": mỗi lá phiếu là một `UPDATE requests`, nên 40 người vote = 40 tin.
>   Cho `flush_notifications()` tự gom `count(*)` của `votes` theo bài thì đúng và rẻ.
> * **Tiến độ của bài chính chủ nhân gửi** thì bỏ qua mọi tuỳ chọn: `progress` luôn ghi
>   khi `requests.user_id = notifications.user_id`. Công tắc `progress` trong prefs chỉ áp
>   dụng cho bài người khác theo dõi.
> * `near` / `lead` ("còn 2 vote nữa là tới lượt chốt"): nó KHÔNG gắn với một lần
>   update nào, mà là hệ quả của cả bảng. Prototype tính bằng `pickLadder(rows)` rồi
>   để `diffNotices()` phát hiện *lúc bước vào* vùng 3 phiếu. Xuống DB thì để cron
>   `notify-flush` tính lại bằng đúng truy vấn của `pick_top_request` và ghi có
>   `cycle = (select value->>'last_pick_at' from settings where key='pick')`,
>   `notif_one_near_per_cycle` ở mục 3.2 chặn ghi trùng.
>
> Và nhớ luật mà `pickLadder` đã mô phỏng: **bài trả tiền đứng trước**, nên khi trong
> hàng còn một bài paid mà bài đang theo dõi không paid thì `gap` chỉ là số trang trí —
> prototype im lặng (không hứa suông), bản DB cũng vậy.

```sql
-- Gộp theo đợt: một tin cho một người, không gửi từng dòng.
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
    -- chỗ gọi ra ngoài: Discord webhook / Telegram sendMessage / Resend
    -- (net fetch chỉ chạy ở Edge, nên hàm này thường CHỈ ghi dấu "cần gửi";
    --  việc gọi API để một Workers cron hoặc một Edge Function làm)
    update notifications set sent_at = now() where user_id = r.user_id and sent_at is null;
    v := v + 1;
  end loop;
  return v;
end $$;

-- pg_cron đã bật cho auto-pick-top → dùng lại cùng hạ tầng:
-- select cron.schedule('notify-flush', '*/30 * * * *', $$select public.flush_notifications()$$);
```

`'*/30 * * * *'` chạy mỗi 30 phút, lệch pha với `auto-pick-top` (cũng `*/30`) một nhịp
thì đặt `*/30` thành `5,35 * * * *` để hai job không dành nhau.

## 5. Nối frontend (thứ tự an toàn)

1. Chạy SQL mục 3 + 4 trên **project staging** trước (repo này từng có bài học:
   migration chưa chạy thật — xem mục "Kiểm chứng" của `docs/RA-SOAT-2026-09-08.md`).
2. Trong `src/lib/watch.js`: đổi `loadWatched/saveWatched`, `loadInbox/saveInbox`,
   `loadPrefs/savePrefs`, `loadOff/saveOff` thành `supabase.rpc('toggle_watch'…)` /
   `from('notifications').select()…`, **giữ nguyên** `diffNotices`, `pushNotices`,
   `snapOf`, `toastOf`, `pickLadder`, thứ tự ưu tiên — đó là phần đã có test và không
   biết gì về nơi lưu. Rieng `syncOwnRequests`/`loadOff` thi **xoa** duoc khi trigger
   3.4 đã chạy (đừng để hai chỗ cùng ghi `watches`).
3. `src/components/Notifications.jsx` khong can doi: chi nhận
   `notices/watched/prefs/rank` qua props — do App nap bang RPC la xong.
   Dong request ma tin nhay toi van tu `rows` ma ra, nen khong them SQL nao. Nho
   `groupNotices()` o `src/lib/watch.js` cho thu tu nhom (do la thu UI dang lam, khong
   phai loi the o database).
4. Muốn có email/Telegram thật: thêm secret `DISCORD_WEBHOOK_URL` (hoặc `RESEND_API_KEY`)
   cho một Edge Function đọc bảng `notifications` — đừng đặt key vào Postgres.

> **Hai điểm dễ sót khi nối:**
>
> * Tin đọc từ bảng `notifications` KHÔNG có cột `own`, nhưng `Notifications.jsx`
>   tách "Của bạn" / "Đang theo dõi" bằng `n.own`. Khi nạp từ DB, App phải gắn lại
>   `own` cho từng tin (tra `watches.own` theo `song_key`, hoặc join
>   `requests.user_id = uid` qua `request_id`) — `own` nằm ở bảng `watches`, không
>   phải bảng tin.
> * Bốn công tắc (`auto`/`near`/`progress`/`votes`) hiện nằm ở localStorage
>   (`ccl3_pref`). Trigger mục 4 ghi `progress` cho MỌI người trong phạm vi (trigger
>   không thấy prefs); khi nối, giữ `diffNotices` (đã lọc theo prefs) cho tin realtime
>   và lọc non-own `progress` theo công tắc ở lúc đọc. Công tắc `auto` liên quan
>   trigger 3.4 (tự theo dõi bài của mình) — cần chốt: để trigger luôn tự theo dõi
>   (bỏ hẳn `auto`), hay chuyển prefs xuống DB để trigger đọc được.

## 6. Những quyết định sản phẩm nên chốt trước khi làm

- **Ai được theo dõi?** Hiện: mọi tài khoản đã đăng nhập, kể cả không phải người gửi.
  Nếu sau này sợ spam thì giới hạn theo dõi chỉ khi đã vote/request bài đó.
- **Báo những gì?** Mặc định: duyệt · Up next · đang làm · xong · bị từ chối · và
  "sát nút chót" (`near`, tối đa một lần mỗi đợt chốt). Rieng tien do bai CUA MINH thi
  bao bat buoc. Hai loai on (tien do %, moc vote) de nguoi dung tu bat — da lam san
  trong bang Cai dat cua hop thong bao (nut ⚙, 4 cong tac `auto`/`near`/`progress`/`votes`).
- **Gửi ra ngoài lúc nào?** Chỉ khi có tin và user đã chọn kênh; một email/tuần là đủ.
- **Quyền riêng tư:** thông báo chỉ chứa tên bài + trạng thái, không chứa link Telegram,
  không tiết lộ ai đã vote (RLS `read own votes` giữ nguyên).

## 6.6 Bổ sung B6 · vì sao bảng thông báo từng vỡ giao diện

User báo "lỗi tùm lum". Trong sandbox không có browser để chụp màn hình, nên phải lần theo
CSS; thủ phạm luôn là **rule phần tử toàn cục đè lên class cục bộ**:

| Rule toàn cục trong `src/index.css` | Hậu quả trong `.nt-*` | Cách chặn |
|---|---|---|
| `input, select, textarea { width:100%; padding:7px 10px; border; background }` | checkbox ở tab Cài đặt biến thành ô text cao ~32px, dòng giãn nợ | `.nt-pref input` reset `width:auto; padding:0; border:0; background:none` (đúng kiểu `.switch input` đang làm) |
| `label { display:block; margin-bottom:5px }` | mọi dòng cài đặt có 5px thừa, hai dòng cách nhau không đều | `.nt-pref { margin:0 }` |
| `.icon-btn:hover { color: var(--denied) }` | nút × và ⚙ ở header đỏ ửng như nút xoá | `.nt-hbtns .icon-btn:hover` trả về màu trung tính |
| `.nt-grp-h { text-transform:uppercase; letter-spacing }` | component nhúng vào header bị IN HOA hết, chữ cách thưa | bài học còn nguyên: nhúng gì vào `.nt-grp-h` cũng phải reset `text-transform`/`letter-spacing` (con dong `Countdown` trong header đã bị bỏ hẳn, thay bằng nut *Vote now* nên khong co rule doi chieu nua) |
| flex column + `overflow:hidden` mà thiếu `min-height:0` | tin thứ 8 bị cắt mất hẳn, không có thanh cuộn | `.nt-list { flex:1 1 auto; min-height:0 }` |

Quy trình cho lần sau: trước khi viết một popover/bảng mới, grep `^input`, `^label`,
`^button` trong `src/index.css` và quyết định cái gì cần reset; rồi dùng `renderToStaticMarkup`
in cấu trúc DOM ra (xem `src/components/Notifications.test.js`) để soát tổ hợp thẻ — ví dụ
`.nt` từng là `<span>` chứa `<div>`, sửa thành `<div>`.

Demo: nút trình diễn trong bảng Cài đặt đã bỏ theo yêu cầu; muốn xem thử tin nhắn thì dùng
**AdminPanel** — đổi trạng thái / `next_pick_at` / thêm phiếu, bảng cập nhật ngay vì mọi thứ
tính lại từ `rows`.
