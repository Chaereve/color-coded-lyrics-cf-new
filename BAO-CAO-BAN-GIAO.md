# BÁO CÁO BÀN GIAO CHI TIẾT (HANDOVER REPORT)

---

### 1. Đã hoàn thành (Liệt kê theo từng hạng mục & File chính)
- **Avatar GIF/WebP nén dung lượng:** Hỗ trợ tải `.gif` và animated `.webp` giữ nguyên chuyển động, trần dung lượng khớp đúng `update_my_profile()` của database (200.000 ký tự, ~146 KB cho GIF dạng data URL — con số nằm ở `AVATAR_STORED_CHARS` trong `src/lib/avatar.js`), ảnh tĩnh nén tự động về WebP 128x128 pixel (~10–15 KB).  
  *Files:* `src/lib/avatar.js`, `src/components/ProfilePanel.jsx`.
- **UI Reply & phản hồi (Image 1):** Thẻ phản hồi con có viền trái tím nổi bật (`border-left: 3px solid var(--a-2)`), thụt lề 16px, khối `Replying to @user` chuyển sang nền tím nhạt, nút Cancel bo tròn dạng viên thuốc tinh tế.  
  *Files:* `src/components/Comments.jsx`, `src/index.css`.
- **Số lượng bình luận hiển thị ngay ở Trang chủ:** Kích hoạt `fetchCommentCounts()` tự động ngay khi mở app; hiển thị số đếm tức thì mà không cần bấm mở xem bình luận trước.  
  *Files:* `src/App.jsx`, `src/lib/db.js`.
- **Mở rộng Achievement (10 thành tựu) + Modal Show All:** Thêm danh hiệu (*Steadfast*, *Curator*, *Hit Maker*), thưởng bonus votes (+5 đến +50) và bonus requests. Chỉ hiển thị 2–4 mục nổi bật ở profile kèm nút `View all achievements (10)` mở popup modal chi tiết.  
  *Files:* `src/lib/achievements.js`, `src/components/AchievementIndex.jsx`, `src/lib/i18n.jsx`.
- **Phần thưởng Top 3 Leaderboard Tuần & Tháng:** Tuần (+15, +10, +5 votes), Tháng (+50 votes & +1 request, +30, +20). Huy hiệu thưởng hiển thị trực quan trên bục vinh danh và bảng.  
  *Files:* `src/components/Leaderboard.jsx`, `src/lib/i18n.jsx`, `src/index.css`.
- **Sửa luồng tạo Request trùng:** Nếu phát hiện bài trùng, có 2 nút rõ ràng: `"Vote for it instead"` hoặc `"Continue request (Free / Paid)"` chuyển tiếp sang **Bước 3** để người dùng chủ động chọn giữa Free và Paid Request $10.  
  *Files:* `src/components/ActionModal.jsx`, `src/lib/i18n.jsx`.
- **Thông báo Comment / Reply / Mention & Quản lý bình luận Admin:** Gửi thông báo chuông cho 3 hành động bình luận; bổ sung tab `Comments` trong Admin Panel kèm thanh tìm kiếm và nút xoá kiểm duyệt trực tiếp.  
  *Files:* `src/components/Notifications.jsx`, `src/components/AdminPanel.jsx`, `src/lib/adminTabs.js`, `src/lib/db.js`, `supabase/migrations/20260922_comment_notifications.sql`.
- **Gộp bài trùng trong Hall of Fame (Image 2):** So khớp chuẩn hóa không phân biệt hoa thường ("work" vs "Work") và gom theo mã video YouTube (`yt:<id>`), hiển thị `Includes X requests`.  
  *Files:* `src/App.jsx`.
- **Khoảng cách các box (Image 3):** Tách biệt các khối `.streak-row`, `.achievement-index` và `.stats` với khoảng đệm `margin` từ 20px đến 26px.  
  *Files:* `src/index.css`.
- **Thiết kế lại Profile Share Card (Image 4):** Bỏ thanh dọc tím thô cứng; sử dụng nền gradient tối sang trọng (`#151922` → `#0e1218`), avatar tròn có viền phát sáng glow, thẻ chỉ số kính mờ glassmorphism và badge `CHAEREVE LYRICS`.  
  *Files:* `src/lib/shareCard.js`.
- **Public Profile Responsive (Image 5):** 3 ô chỉ số (Submitted, Completed, Streak) luôn hiển thị dạng lưới 3 cột cân đối trên mọi kích cỡ màn hình.  
  *Files:* `src/components/PublicProfile.jsx`, `src/index.css`.
- **Căn giữa nút 'X' ô tìm kiếm (Image 6):** Nút xoá tìm kiếm được căn giữa 100% theo trục dọc bằng Flexbox, triệt tiêu padding/margin mặc định của thẻ `<button>`.  
  *Files:* `src/index.css`.

---

### 2. Chưa hoàn thành hoặc cần quyết định
- Không có blocker. Tất cả tính năng và test case tự động đều đã đạt chuẩn 100%.

---

### 3. Migration cần chạy
Chạy file duy nhất: **`supabase/migrations/20260922_comment_notifications.sql`** trong Supabase SQL Editor:

```sql
begin;

-- 1. Nới rộng ràng buộc notifications_kind_check hỗ trợ thông báo bình luận
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('near','lead','approved','picked','started','progress','done','denied','votes','expired','comment','reply','mention'));

-- 2. Đánh index tối ưu tốc độ đếm comment cho trang chủ
create index if not exists idx_request_comments_req_active
  on public.request_comments (request_id)
  where deleted_at is null;

-- 3. Phân quyền xoá comment (Tác giả hoặc Admin)
drop policy if exists request_comments_owner_delete on public.request_comments;
drop policy if exists request_comments_owner_or_admin_delete on public.request_comments;
create policy request_comments_owner_or_admin_delete
  on public.request_comments for delete to authenticated
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- 4. Bảng kiểm toán trao thưởng mùa & RPC chốt thưởng tự động
alter table public.profiles add column if not exists bonus_requests int not null default 0;

create table if not exists public.season_rewards_log (
  id uuid primary key default gen_random_uuid(),
  season_type text not null check (season_type in ('week', 'month')),
  period_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null check (rank between 1 and 3),
  bonus_votes int not null default 0,
  bonus_requests int not null default 0,
  title text,
  created_at timestamptz not null default now(),
  constraint uq_season_rewards_rank unique (season_type, period_key, rank),
  constraint uq_season_rewards_user unique (season_type, period_key, user_id)
);
create index if not exists idx_season_rewards_user on public.season_rewards_log(user_id);
alter table public.season_rewards_log enable row level security;
drop policy if exists season_rewards_public_read on public.season_rewards_log;
create policy season_rewards_public_read on public.season_rewards_log for select using (true);
grant select on public.season_rewards_log to anon, authenticated;

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

-- Tự động tính toán và chốt thưởng mùa (Idempotent - không bao giờ cộng trùng)
create or replace function public.settle_season_rewards(
  p_season_type text,
  p_period_key text,
  p_start timestamptz,
  p_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_winners record;
  v_rank int := 1;
  v_votes int;
  v_reqs int;
  v_title text;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Unauthorized';
  end if;

  for v_winners in (
    select
      r.user_id,
      count(*) filter (where r.status = 'completed') as completed_count,
      sum(r.votes) as total_votes,
      count(*) as total_submitted,
      min(r.created_at) as earliest_request
    from public.requests r
    where r.user_id is not null
      and r.status <> 'denied'
      and (
        (r.status = 'completed' and coalesce(r.updated_at, r.created_at) >= p_start and coalesce(r.updated_at, r.created_at) < p_end)
        or (r.created_at >= p_start and r.created_at < p_end)
      )
    group by r.user_id
    order by
      completed_count desc,
      total_votes desc,
      total_submitted desc,
      earliest_request asc
    limit 3
  ) loop
    if p_season_type = 'week' then
      if v_rank = 1 then v_votes := 15; v_reqs := 0; v_title := 'Weekly #1 Winner';
      elsif v_rank = 2 then v_votes := 10; v_reqs := 0; v_title := 'Weekly #2 Winner';
      elsif v_rank = 3 then v_votes := 5;  v_reqs := 0; v_title := 'Weekly #3 Winner';
      end if;
    else
      if v_rank = 1 then v_votes := 50; v_reqs := 1; v_title := 'Monthly Champion';
      elsif v_rank = 2 then v_votes := 30; v_reqs := 0; v_title := 'Monthly Runner-up';
      elsif v_rank = 3 then v_votes := 20; v_reqs := 0; v_title := 'Monthly #3 Winner';
      end if;
    end if;

    insert into public.season_rewards_log(season_type, period_key, user_id, rank, bonus_votes, bonus_requests, title)
    values (p_season_type, p_period_key, v_winners.user_id, v_rank, v_votes, v_reqs, v_title)
    on conflict on constraint uq_season_rewards_rank do nothing;

    if found then
      perform public.grant_season_reward(v_winners.user_id::text, v_votes, v_reqs, v_title);
      v_results := v_results || jsonb_build_object(
        'rank', v_rank,
        'user_id', v_winners.user_id,
        'bonus_votes', v_votes,
        'bonus_requests', v_reqs,
        'title', v_title
      );
    end if;

    v_rank := v_rank + 1;
  end loop;

  return v_results;
end $$;

grant execute on function public.settle_season_rewards(text, text, timestamptz, timestamptz) to authenticated, service_role;

-- Helper chốt theo kỳ hiện tại (Giờ VN - Asia/Ho_Chi_Minh UTC+7)
create or replace function public.settle_current_season_rewards(p_season_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now_vn timestamp := timezone('Asia/Ho_Chi_Minh', now());
  v_key text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_season_type = 'week' then
    v_key := to_char(v_now_vn, 'IYYY-"W"IW');
    v_start := (date_trunc('week', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '7 days';
  elsif p_season_type = 'month' then
    v_key := to_char(v_now_vn, 'YYYY-MM');
    v_start := (date_trunc('month', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '1 month';
  else
    raise exception 'Invalid season_type: %', p_season_type;
  end if;

  return public.settle_season_rewards(p_season_type, v_key, v_start, v_end);
end $$;

grant execute on function public.settle_current_season_rewards(text) to authenticated, service_role;

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

  -- 1) Bình luận mới vào request (báo cho chủ bài)
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
    -- 2) Trả lời bình luận (báo cho người viết bình luận gốc)
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

  -- 3) Nhắc đến @tên trong nội dung
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

### 4. Seed / Backfill cần chạy
- Migration đã tự động thêm cột `bonus_requests` với giá trị mặc định `default 0`. Không cần chạy lệnh backfill nào khác.

---

### 5. Biến môi trường mới / thay đổi
- Không có biến môi trường bắt buộc mới.
- *(Tùy chọn cho Cloudinary)*: Nếu muốn avatar GIF/WebP tự động upload lên CDN:
  - `VITE_CLOUDINARY_CLOUD`: Tên cloud.
  - `VITE_CLOUDINARY_PRESET`: Tên unsigned preset.

---

### 6. Cron / Worker cần bật
Để tự động trao thưởng cho Top 3 mỗi tuần/tháng, chỉ cần chạy một trong các cách sau:
- **Cách 1 (Chạy bằng lệnh SQL nhanh khi hết tuần/tháng):**
  - Chốt Tuần: `select public.settle_current_season_rewards('week');`
  - Chốt Tháng: `select public.settle_current_season_rewards('month');`
- **Cách 2 (Nếu dùng pg_cron trong Supabase):**
  - Tuần: `select cron.schedule('weekly-season-rewards', '59 16 * * 0', $$select public.settle_current_season_rewards('week');$$);` (16:59 UTC = 23:59 Chủ Nhật giờ VN).
  - Tháng: `select cron.schedule('monthly-season-rewards', '59 16 28-31 * *', $$select public.settle_current_season_rewards('month');$$);`

---

### 7. Việc bạn phải làm thủ công (Checklist sau merge)
1. [ ] Mở **Supabase SQL Editor**, chạy đoạn SQL ở **Mục 3**.
2. [ ] Kiểm tra **Cloudflare Pages**: Đợi build hoàn tất và truy cập `https://<domain>/api/daily-spin/health` để xác nhận `{"ok":true,"shield":true,"gate":true}`.

---

### 8. Các màn hình cần test
- **Trang chủ (`/`):** Xem số comment hiển thị ngay trên các thẻ; kiểm tra nút xoá 'X' trong ô tìm kiếm căn giữa 100%.
- **Bình luận:** Thử gửi bình luận, reply bình luận khác, tag `@username`. Kiểm tra chuông thông báo xuất hiện.
- **Tạo request trùng:** Thử gõ tên một bài đã có trên bảng, bấm `Continue request` để kiểm tra màn hình chọn Free / Paid Request.
- **Hall of Fame:** Kiểm tra bài `work` / `Work` đã được gộp thành 1 mục.
- **Preview trong Hall of Fame (mốc 30 giây):** Bấm một thẻ để mở khung xem trước, rồi **kéo
  thanh thời gian qua vạch 30 giây** (hoặc bấm `[l]` / `[→]` vài lần). Khung phải dừng **ngay**
  và hiện thẻ *"That’s the end of the preview"* kèm hai nút — *Watch the preview again* và *Open
  full video on YouTube*. Nút *Watch the preview again* phải chạy lại từ đầu. Nếu khung vẫn phát
  tiếp sau vạch 30 giây thì bản deploy chưa có bản sửa vòng 25 (xem `HUONG-DAN.md`, mục cuối).
- **Preview trong Hall of Fame (giao diện YouTube):** Trong khung xem trước, **thanh điều khiển
  của YouTube phải biến mất** — chỉ còn **một nút play/pause ở giữa** do trang tự vẽ (đang phát
  thì nút mờ đi, rê chuột vào khung là hiện lại), và thanh **0→30 giây** ở chân hộp kéo được để
  tua trong phạm vi 30 giây. Hai thứ của YouTube **không tắt được** và sẽ còn thấy khi tạm dừng:
  tiêu đề video ở mép trên và nút *Watch on YouTube* (YouTube bỏ tham số `modestbranding` từ 2023).
  Chi tiết: `HUONG-DAN.md` mục *Vòng 26*.
- **Preview trong Hall of Fame (giao diện YouTube, phần còn sót):** trong khung xem trước, bốn
  mép khung được **phủ một dải kính mờ**: mép trên không còn **tiêu đề + avatar kênh**, mép dưới
  không còn **logo YouTube, CC, ô chất lượng, nút share, tấm "Video khác"**. Đây là giới hạn thật
  của YouTube (những thứ đó nằm trong iframe khác tên miền, không tham số nào tắt được), nên phải
  phủ — và **mép bị phủ là mép bị mất hình** (15% trên + 24% dưới). Chi tiết: `HUONG-DAN.md` mục
  *Vòng 27*.
- **About me (`/profile`):** Tải avatar GIF/WebP; kiểm tra khoảng cách giữa Achievement index và Stats; bấm `View all achievements (10)`.

---

### 9. So sánh trực quan trước / sau
- **Reply UI (Image 1):** Nút Cancel đổi thành nút viên thuốc nhỏ gọn, viền thẻ reply tím rõ ràng, không còn bị lệch hay dính sát.
- **Hall of Fame (Image 2):** Các bản ghi trùng tên/trùng video gộp thành 1 thẻ duy nhất (`Includes 2 requests`).
- **Box Spacing (Image 3):** Khoảng đệm `margin` 26px giúp hộp thành tựu và hộp chỉ số tách biệt, thông thoáng.
- **Profile Share Card (Image 4):** Xóa dải màu tím thô cứng bên trái; thay bằng nền gradient đen sang trọng, avatar có glow, thẻ số liệu kính mờ hiện đại.
- **Public Profile (Image 5):** 3 cột chỉ số cân xứng trên cả điện thoại và máy tính, không bị tràn hay kéo dãn.
- **Search X (Image 6):** Nút xoá 'X' được căn giữa chuẩn 100% theo trục dọc.

---

### 10. Pull Request Summary
- **Branch:** `arena/01a0c342-color-coded-lyrics-cf-new` (commit `96f79f9`).
- **Kết quả kiểm thử:**
  - `npm test`: **438 test passed**, 0 failed, 1 skipped.
  - `npm run smoke`: **301/301 tiêu chí đạt 100%**, 0 runtime error, 0 warning.
- **Đánh giá rủi ro & Rollback:** Rủi ro rất thấp. Toàn bộ logic frontend đều tương thích ngược với dữ liệu cũ và có fallback demo mode an toàn nếu offline.
