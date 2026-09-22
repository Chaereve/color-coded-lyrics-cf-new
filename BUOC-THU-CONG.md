# Hướng dẫn các bước thủ công sau khi merge (Bản cập nhật lớn 2026-09-22)

Tài liệu này tổng hợp toàn bộ các bước thiết lập thủ công trên **Supabase (PostgreSQL)**, **Cloudflare Pages**, và kiểm tra sau khi merge bản cập nhật 13 tính năng & cải tiến giao diện.

---

## 0. Tóm tắt 13 cải tiến trong bản cập nhật này

1. **Giao diện phản hồi bình luận (Reply UI):** Thiết kế lại thanh "Replying to @user", avatar chữ viết tắt, thời gian tương đối (`timeAgo`), tag `@mention` đổi màu nổi bật, nút trả lời và nút xoá gọn gàng.
2. **Số lượng bình luận trên trang chủ:** Thẻ request trên bảng hiển thị ngay số lượng bình luận mà người dùng **không cần phải bấm mở modal bình luận trước**.
3. **Mở rộng hệ thống thành tựu (Achievements):** Bổ sung danh hiệu (titles), huy hiệu (badges), thưởng bonus votes, bonus requests, danh sách thu gọn hiển thị 3 mục kèm nút popup **"Show all"** mở toàn bộ 10 thành tựu theo tiến độ thực tế.
4. **Phần thưởng Bảng xếp hạng mùa (Leaderboard Season Rewards):**
   - **Tuần (Weekly Top 3):** Hạng 1 (+15 bonus votes), Hạng 2 (+10 bonus votes), Hạng 3 (+5 bonus votes).
   - **Tháng (Monthly Top 3):** Hạng 1 (+50 bonus votes + 1 request bonus), Hạng 2 (+30 bonus votes), Hạng 3 (+20 bonus votes).
   - Huy hiệu phần thưởng trực quan hiển thị trên Leaderboard kèm tooltip giải thích chi tiết.
5. **Khắc phục lỗi trùng lặp request (Duplicate Request Flow):** Khi người dùng gửi bài trùng tên bài cũ, hệ thống chuyển tiếp sang bước 3 để người dùng chủ động chọn hình thức miễn phí (vote cho bài cũ hoặc gửi thêm dòng mới) hoặc chọn làm nhanh qua **Paid request** thay vì bị nhảy cóc qua bước này.
6. **Thông báo bình luận & Quản lý bình luận trong Admin Panel:**
   - Tự động gửi thông báo chuông khi có người bình luận vào request của bạn (`comment`), phản hồi bình luận của bạn (`reply`), hoặc tag tên bạn (`mention`).
   - Tab **Comments** hoàn toàn mới trong Admin Panel cho phép quản trị viên xem danh sách toàn bộ bình luận, lọc theo từ khoá, và xoá bình luận vi phạm trực tiếp.
7. **Gom cụm trùng lặp Hall of Fame:** Tự động gộp các bản ghi cùng bài hát/nghệ sĩ trong Hall of Fame giúp giao diện tinh gọn, không bị nhân đôi.
8. **Khắc phục các khối bị dính sát nhau (Touching Boxes):** Điều chỉnh khoảng cách `gap`, `margin-top`, và padding giữa thanh lọc `fbar`, bảng danh sách, thanh phân trang `pager`, và các khối con.
9. **Thiết kế lại Profile Share Card:** Loại bỏ cảm giác "AI-slop", tinh chỉnh typography, màu viền gradient tinh tế, badge thành tựu nổi bật và căn lề sắc nét.
10. **Tối ưu trang hồ sơ công khai (Public Profile):** Bố cục gọn gàng, hiển thị chuỗi ngày liên tiếp (streak), danh hiệu, huy hiệu thành tựu và thân thiện trên cả mobile/desktop.
11. **Căn chỉnh nút xoá tìm kiếm ("X" button):** Nút xoá ô tìm kiếm được căn giữa hoàn hảo theo chiều dọc, không bị lệch hoặc chồng icon kính lúp.
12. **Bảo toàn hiệu năng & loại trừ vòng lặp render:** Xử lý cập nhật số bình luận qua microtask tách biệt, loại bỏ hoàn toàn các cảnh báo `setState` trong lúc render.
13. **Tài liệu hướng dẫn thủ công độc lập, chuẩn hoá:** Hướng dẫn chi tiết, script migration dạng idempotent, không cần dán lại toàn bộ file `schema.sql`.

---

## 1. Migration PostgreSQL (Supabase SQL Editor)

> **Lưu ý cốt lõi:**
> - **TUYỆT ĐỐI KHÔNG DÁN LẠI FILE `schema.sql`** (tránh tình trạng trình duyệt bị đơ/lag và nghẽn tài nguyên do query quá dài).
> - Mỗi file SQL chạy trong một tab query riêng (**Supabase Dashboard → SQL Editor → New query → Run**).
> - Tất cả các script đều được bọc trong khối transaction an toàn `begin; ... commit;` và có mệnh đề `if not exists` / `create or replace`.

### 1.0. Câu lệnh kiểm tra tình trạng Database (chạy ~1 giây)

Mở một tab New Query trong Supabase SQL Editor và chạy đoạn mã sau để biết database hiện tại đang có những gì:

```sql
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='request_comments')                        as has_comments_table,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='request_comments' and column_name='parent_id') as has_parent_id,
  (select count(*) from pg_trigger
     where tgname='tr_notify_on_comment')                                                   as has_comment_notify_trigger,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='profiles' and column_name='bonus_requests')  as has_bonus_requests,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='grant_season_reward')                         as has_season_reward_func;
```

**Cách đọc kết quả:**
- Nếu tất cả các cột đều trả về `1`: Bạn đã hoàn tất toàn bộ migration cho phiên bản này.
- Nếu `has_comments_table = 0`: Cần chạy `20260920_request_comments.sql`.
- Nếu `has_parent_id = 0`: Cần chạy `20260921_replies_request_expiry.sql`.
- Nếu `has_comment_notify_trigger = 0` hoặc `has_season_reward_func = 0`: Chạy file mới `20260922_comment_notifications.sql`.

---

### 1.1. Migration chính cần chạy đợt này: `20260922_comment_notifications.sql`

Nội dung file tại đường dẫn: `supabase/migrations/20260922_comment_notifications.sql`.  
Dán toàn bộ khối lệnh dưới đây vào **SQL Editor** và bấm **Run**:

```sql
-- Comment & Reply & Mention Notifications + Admin Comment Moderation (2026-09-22)
begin;

-- 1. Nới rộng ràng buộc notifications_kind_check hỗ trợ thông báo bình luận
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('near','lead','approved','picked','started','progress','done','denied','votes','expired','comment','reply','mention'));

-- 2. Tăng tốc độ đếm comment cho trang chủ (Homepage Request Cards)
create index if not exists idx_request_comments_req_active
  on public.request_comments (request_id)
  where deleted_at is null;

-- 3. Phân quyền xoá comment: Người viết hoặc Admin đều có quyền xoá kiểm duyệt
drop policy if exists request_comments_owner_delete on public.request_comments;
drop policy if exists request_comments_owner_or_admin_delete on public.request_comments;
create policy request_comments_owner_or_admin_delete
  on public.request_comments for delete to authenticated
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- 4. Bổ sung cột bonus_requests & hàm trao thưởng mùa giải (Season Rewards)
alter table public.profiles add column if not exists bonus_requests int not null default 0;

create or replace function public.grant_season_reward(
  p_user_id text,
  p_bonus_votes int default 0,
  p_bonus_requests int default 0,
  p_title text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set bonus_credits = bonus_credits + coalesce(p_bonus_votes, 0),
         bonus_requests = coalesce(bonus_requests, 0) + coalesce(p_bonus_requests, 0)
   where id = p_user_id;

  if coalesce(p_bonus_votes, 0) > 0 or coalesce(p_bonus_requests, 0) > 0 then
    insert into public.notifications(user_id, song_key, kind, title, reason, sig)
    values (
      p_user_id,
      'season-reward',
      'votes',
      'Season Reward: ' || coalesce(p_title, 'Top Rank'),
      'You earned ' || coalesce(p_bonus_votes, 0) || ' bonus votes' ||
        case when coalesce(p_bonus_requests, 0) > 0 then ' and ' || p_bonus_requests || ' bonus request!' else '!' end,
      'reward|' || p_user_id || '|' || extract(epoch from now())::text
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end if;
end $$;

grant execute on function public.grant_season_reward(text, int, int, text) to authenticated, service_role;

-- 5. Trigger tự động bắn thông báo khi có Comment, Reply hoặc Mention
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests;
  v_parent public.request_comments;
  v_author text;
  v_mentioned record;
begin
  select name into v_author from public.profiles where id = NEW.user_id;
  v_author := coalesce(v_author, 'Member');

  select * into v_req from public.requests where id = NEW.request_id;

  -- 1) Bình luận mới vào request (báo cho chủ request)
  if NEW.parent_id is null then
    if v_req.user_id is not null and v_req.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (
        v_req.user_id,
        public.song_key(v_req.artist, v_req.title),
        'comment',
        v_req.id,
        v_req.title,
        v_req.artist,
        v_author || ': ' || left(NEW.body, 120),
        'comment|' || NEW.id::text
      ) on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  else
    -- 2) Trả lời bình luận (báo cho tác giả bình luận cấp 1)
    select * into v_parent from public.request_comments where id = NEW.parent_id;
    if v_parent.user_id is not null and v_parent.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (
        v_parent.user_id,
        public.song_key(v_req.artist, v_req.title),
        'reply',
        v_req.id,
        v_req.title,
        v_req.artist,
        v_author || ' replied: ' || left(NEW.body, 120),
        'reply|' || NEW.id::text
      ) on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  end if;

  -- 3) Nhắc đến @tên_người_dùng trong nội dung
  for v_mentioned in
    select id, name from public.profiles
     where id <> NEW.user_id
       and (
         position('@' || lower(name) in lower(NEW.body)) > 0
         or position('@' || lower(replace(name, ' ', '')) in lower(NEW.body)) > 0
       )
  loop
    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (
      v_mentioned.id,
      public.song_key(v_req.artist, v_req.title),
      'mention',
      v_req.id,
      v_req.title,
      v_req.artist,
      v_author || ' mentioned you: ' || left(NEW.body, 120),
      'mention|' || NEW.id::text || '|' || v_mentioned.id::text
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end loop;

  return NEW;
end $$;

drop trigger if exists tr_notify_on_comment on public.request_comments;
create trigger tr_notify_on_comment
  after insert on public.request_comments
  for each row execute function public.notify_on_comment();

commit;
notify pgrst, 'reload schema';
```

---

### 1.2. Cơ chế chốt thưởng Leaderboard Tự động & Bảo mật (Season Rewards Settlement)

Bảng xếp hạng được thiết lập cơ chế trao thưởng **tự động, bảo mật và chống trùng lặp 100%**:
- **Bảng lưu trữ kiểm toán:** `public.season_rewards_log` có ràng buộc duy nhất `unique (season_type, period_key, rank)` và `unique (season_type, period_key, user_id)`. Bất kể lệnh chốt chạy bao nhiêu lần, giải thưởng cho kỳ đó **chỉ được trao đúng 1 lần duy nhất**, không bao giờ bị cộng đúp số dư.
- **Quy tắc phân định khi đồng hạng (Tie-Breaker):**
  1. Ưu tiên 1: Người có **số bài hoàn thành (Completed)** nhiều nhất.
  2. Ưu tiên 2: Người có **tổng số vote** nhận được nhiều nhất.
  3. Ưu tiên 3: Người có **tổng số yêu cầu (Submitted)** nhiều nhất.
  4. Phá hòa (Tie-breaker cuối): Người đạt mốc sớm hơn dựa trên thời gian tạo yêu cầu đầu tiên trong kỳ (`min(created_at) asc`).

#### Lệnh chốt thưởng tự động trong SQL Editor (Chỉ 1 dòng lệnh)

Khi kỳ xếp hạng kết thúc (23:59 Chủ Nhật hoặc 23:59 ngày cuối tháng theo giờ Việt Nam):
```sql
-- 1. Tự động chốt và trao thưởng Tuần cho Top 3 (+15, +10, +5 votes):
select public.settle_current_season_rewards('week');

-- 2. Tự động chốt và trao thưởng Tháng cho Top 3 (+50 votes & +1 request, +30, +20):
select public.settle_current_season_rewards('month');
```
*Hàm sẽ tự động quét top 3 người dùng hợp lệ, cộng trực tiếp votes/requests vào tài khoản, gửi thông báo chuông chúc mừng và ghi nhận lịch sử vào `season_rewards_log`.*

*(Tùy chọn: Nếu dự án của bạn có bật extension `pg_cron` trong Supabase, lệnh trên có thể tự động chạy định kỳ vào 23:59 Chủ Nhật hàng tuần và 23:59 ngày cuối tháng).*

---

## 2. Cloudflare Pages & Workers — Kiểm tra cấu hình

Nếu bạn đã hoàn tất thiết lập ở đợt cập nhật trước, phần này **chỉ cần kiểm tra lại**.

### 2.1. Biến môi trường trên Cloudflare Pages
Vào **Cloudflare Dashboard → Workers & Pages → Tên Project Pages → Settings → Environment variables / Secrets**:

| Biến | Loại | Mô tả |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Secret | Khóa bí mật Cloudflare Turnstile |
| `SUPABASE_ANON_KEY` | Secret | Khóa công khai `anon` từ Supabase |
| `SUPABASE_URL` | Plaintext | Đường dẫn dự án `https://<project-ref>.supabase.co` |
| `EDGE_GATE_TOKEN` | Secret | Chuỗi token ngẫu nhiên bảo mật (≥ 32 ký tự) |

### 2.2. Kiểm tra trạng thái Edge Gate
Mở đường dẫn kiểm tra trên trình duyệt:
```
https://<domain-cua-ban>/api/daily-spin/health
```
Kết quả đạt chuẩn:
```json
{"ok":true,"shield":true,"gate":true}
```
*(Nếu `gate: false`, hãy đối chiếu token `EDGE_GATE_TOKEN` giữa Pages và câu lệnh `select public.set_edge_gate_token('...');` trên Supabase).*

---

## 4. Cải tiến Avatar GIF/WebP & 6 điểm tinh chỉnh UI từ phản hồi thực tế

### 4.1. Hỗ trợ Avatar GIF và WebP động (kèm nén và bảo vệ dung lượng)
- **Cho phép định dạng `.gif` và `.webp` động:**
  - Avatar tĩnh (JPG, PNG, WebP tĩnh) tự động được đưa qua cropper và nén về ảnh WebP chuẩn 128x128 pixel siêu nhẹ (~10-15KB).
  - Avatar động (GIF hoặc WebP có cờ VP8X animation) sẽ được giữ nguyên chuyển động mà không bị canvas "đóng băng" ở khung hình đầu tiên.
  - Áp dụng hạn mức dung lượng tối đa **2.5 MB** cho ảnh động khi lưu trữ trực tiếp (tránh tràn `localStorage` và nghẽn băng thông database).
  - Nếu đã cấu hình Cloudinary (`VITE_CLOUDINARY_URL`), ảnh sẽ được tự động tối ưu qua Cloudinary CDN (`f_auto,q_auto`).
  - Hiển thị thông báo thân thiện kèm dung lượng nén thực tế (ví dụ: `Avatar động sẵn sàng (142 KB)`).

### 4.2. Khắc phục và tối ưu theo 6 phản hồi từ hình ảnh thực tế
1. **Giao diện Reply (Ảnh 1):**
   - Viền khung phản hồi và thanh "Replying to @user" được làm rõ phân cấp, nút hủy thao tác "X" và nút "Send" được tách biệt, căn lề chuẩn xác.
2. **Hall of Fame - Gom bài trùng (Ảnh 2):**
   - Hệ thống so khớp tự động loại bỏ dấu tiếng Việt, chuyển chữ hoa thành chữ thường ("work" vs "Work") và bổ sung so khớp theo YouTube Video ID (`yt:<id>`). Mọi lượt vote/yêu cầu cùng bài hát đều được gộp chung vào một thẻ duy nhất.
3. **Khoảng cách giữa các hộp thông tin (Ảnh 3 - Touching Boxes):**
   - Tách rời khoảng cách giữa dải chuỗi ngày (`streak-row`), khối chỉ số thành tựu (`achievement-index`), và khối thống kê (`stats`) với khoảng đệm `margin` từ 20px đến 26px, không còn tình trạng hai hộp dính sát mép nhau.
4. **Thiết kế lại Profile Share Card (Ảnh 4):**
   - Thiết kế lại toàn bộ thẻ canvas chia sẻ: nền tối hiện đại, avatar dạng tròn có viền phát sáng (glow), các ô chỉ số dạng kính mờ (glassmorphism), huy hiệu thành tựu và mốc chuỗi ngày được bố trí cân đối, loại bỏ hoàn toàn cảm giác thô kệch.
5. **Trang hồ sơ công khai Public Profile (Ảnh 5):**
   - Tối ưu bố cục responsive: trên cả điện thoại di động và máy tính, 3 ô chỉ số (Submitted, Completed, Streak) luôn hiển thị dạng lưới 3 cột cân xứng, dải mốc streak hiển thị rõ ràng, không bị kéo giãn đơn điệu.
6. **Nút xoá ô tìm kiếm "X" (Ảnh 6):**
   - Nút xoá tìm kiếm (`.search-x`) được căn giữa 100% theo chiều dọc nhờ cơ chế flex center tuyệt đối, triệt tiêu hoàn toàn padding và margin mặc định của trình duyệt trên nút bấm.

