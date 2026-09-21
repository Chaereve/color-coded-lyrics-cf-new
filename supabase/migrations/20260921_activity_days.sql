-- =========================================================
-- ACTIVITY DAYS — nền của chuỗi ngày hoạt động (streak) và badge 7/30/100
-- ---------------------------------------------------------
-- Vì sao bảng này tồn tại: streak "Duolingo-style" cần MỘT nguồn sự thật trả
-- lời "người này có hoạt động vào ngày X không" cho BẤT KỲ ai đọc (trang cá
-- nhân công khai). Những nguồn đã có đều thiếu một vế:
--   · requests / request_comments — đọc công khai được, nhưng quá thưa để
--     nuôi một chuỗi ngày (không ai gửi request bảy ngày liền);
--   · votes — có created_at theo user nhưng RLS chỉ cho đọc HÀNG CỦA MÌNH;
--   · daily_spins — khoá theo device_hash, không phải tài khoản.
-- Nên thay vì suy diễn streak từ bốn nguồn lệch nhau ở client, mỗi hành động
-- cộng đồng (gửi request · vote · bình luận · quay spin) tự in một DẤU NGÀY
-- vào đây bằng trigger. Client chỉ việc đếm ngày liên tiếp.
--
-- Additive và chạy lại an toàn: create if not exists + drop if exists trước
-- mọi trigger/function. Không sửa bảng nào cũ, không khoá gì thêm.
-- =========================================================

create table if not exists public.activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
create index if not exists activity_days_day_idx on public.activity_days (day);

alter table public.activity_days enable row level security;
-- Streak là thống kê công cộng như bảng xếp hạng: ai cũng đọc được.
drop policy if exists "read activity days" on public.activity_days;
create policy "read activity days" on public.activity_days for select using (true);
-- Ghi CHỈ qua trigger (security definer) — giống votes/requests, không một
-- đường insert/update/delete nào từ browser, kể cả admin.
revoke insert, update, delete on public.activity_days from anon, authenticated;

-- Mốc ngày tính theo LỊCH VIỆT NAM (Asia/Ho_Chi_Minh), cùng múi giờ với
-- daily spin và mùa giải của leaderboard: một "ngày hoạt động" của cộng đồng
-- này bắt đầu và kết thúc lúc nửa đêm giờ VN, không phải UTC.
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

-- daily_spins.user_id nullable (account deletion set null) — dấu ngày chỉ in
-- khi còn biết là của ai.
drop trigger if exists activity_on_spin on public.daily_spins;
create trigger activity_on_spin after insert on public.daily_spins
for each row when (new.user_id is not null) execute function public.touch_activity_day();
