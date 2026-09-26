-- ============================================================
--  COLOR CODED LYRICS — REQUEST BOARD  ·  (c) @chaereve
--  Schema v3: admin, duyet request, vote credits, paid request
--  File GỘP để đối chiếu / chạy bằng psql; KHÔNG dán cả file vào SQL Editor.
--  DB MỚI: xem supabase/setup/README.md, chạy 01 → 08 từng file nhỏ.
--  DB ĐÃ CÓ DỮ LIỆU: backup rồi chỉ chạy migration còn thiếu theo thứ tự;
--  KHÔNG chạy lại schema.sql hay các file setup trên database đang dùng.
-- ============================================================

-- Bản gộp này giữ nguyên các bước trung gian và migration để cài mới ra
-- trạng thái cuối; các file setup được cắt nguyên văn từ đây (không sửa SQL).
-- Chạy lại toàn bộ trên production vừa nặng vừa có thể thay đổi dữ liệu/cấu
-- hình trung gian. Xem supabase/setup/README.md trước khi chạy bất cứ SQL nào.

-- =========================================================
-- 1. PROFILES (tu tao khi dang nhap Google)
-- =========================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null default 'Anonymous',
  avatar_url    text,
  is_admin      boolean not null default false,
  vote_credits  int not null default 0,      -- vote da mua, con lai (khong tinh bonus tu vong quay)
  bonus_credits int not null default 0,      -- bonus tu vong quay, reset ve 0 vao 31/10 hang nam
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles as profile (id, name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email,'@',1), 'Anonymous'),
    coalesce(new.raw_user_meta_data->>'avatar_url',
             new.raw_user_meta_data->>'picture')
  )
  /* Login can update auth.users after the user has edited their profile.
     Never overwrite a custom display name or avatar with provider metadata. */
  on conflict (id) do update
     set name = case
       when profile.name is null or profile.name = 'Anonymous'
         then excluded.name else profile.name end,
         avatar_url = coalesce(profile.avatar_url, excluded.avatar_url);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- 2. REQUESTS
-- =========================================================
create table if not exists public.requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null default 'Color Coded Lyrics'
                 check (kind in ('Color Coded Lyrics','Full Album','1 Hour Loop','Short')),
  artist         text not null,
  title          text not null,                -- ten bai hat, hoac ten album neu kind='Full Album'
  link           text,                         -- link bai hat / album
  note           text,
  requester      text not null default 'Anonymous',
  status         text not null default 'pending'
                 check (status in ('pending','queued','in_progress','completed','denied')),
  deny_reason    text,
  progress       int  not null default 0 check (progress between 0 and 100),
  votes          int  not null default 0,
  is_paid        boolean not null default false,
  payment_status text not null default 'none'
                 check (payment_status in ('none','awaiting','paid')),
  done_layout    boolean not null default false,   -- moc 40%
  done_lyrics    boolean not null default false,   -- moc 40%
  done_edit      boolean not null default false,   -- moc 20%
  video_url      text,                         -- link video da hoan thanh
  picked_at      timestamptz,                   -- cron/admin chot vao Up next luc nao; null = chua chot
  expired_at     timestamptz,                   -- admin expiry queue: old, never-picked request
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists requests_status_idx  on public.requests (status);
create index if not exists requests_votes_idx   on public.requests (votes desc);
create index if not exists requests_created_idx on public.requests (created_at desc);
create index if not exists requests_user_idx    on public.requests (user_id);
create index if not exists requests_picked_idx  on public.requests (picked_at) where picked_at is not null;
create index if not exists requests_expired_idx on public.requests (expired_at) where expired_at is not null;
alter table public.requests add column if not exists picked_at timestamptz;

-- =========================================================
-- 3. VOTES
-- =========================================================
create table if not exists public.votes (
  id          bigserial primary key,
  request_id  uuid not null references public.requests(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  used_credit boolean not null default false,   -- true = tieu vote da mua
  created_at  timestamptz not null default now()
);
-- Truoc day moi nguoi chi vote 1 lan / request. Nay bo gioi han do.
-- Dong nay de nang cap cac project da chay schema cu:
alter table public.votes drop constraint if exists votes_request_id_user_id_key;
create index if not exists votes_user_request_idx on public.votes (user_id, request_id);

-- Cac moc cong viec cua mot request (cho project da chay schema cu)
alter table public.requests add column if not exists done_layout boolean not null default false;
alter table public.requests add column if not exists done_lyrics boolean not null default false;
alter table public.requests add column if not exists done_edit   boolean not null default false;

-- Them loai video 'Short'. Dong duoi de nang cap cac project da chay schema cu:
-- rang buoc CHECK cu khong tu doi khi chay lai 'create table if not exists'.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.requests'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%1 Hour Loop%';
  if c is not null then
    execute format('alter table public.requests drop constraint %I', c);
  end if;
  alter table public.requests add constraint requests_kind_check
    check (kind in ('Color Coded Lyrics','Full Album','1 Hour Loop','Short'));
exception when duplicate_object then null;
end $$;
create index if not exists votes_user_day_idx on public.votes (user_id, created_at desc);
create index if not exists votes_created_idx on public.votes (created_at);

-- =========================================================
-- 3b. PHIẾU NHẬN TRONG MÙA — cho khoi "This week" (trang chu) va bang xep
--     hang mua (tuan/thang) dem "vote nhan trong mua" (luat + cua so nam o
--     src/lib/season.js).
--     Vi sao la ham SECURITY DEFINER thay cho SELECT thang: RLS tren votes
--     chi cho doc hang CUA MINH (xem khoi 07), ma "bai nao nhan duoc bao nhieu
--     phieu trong tuan" la so cua CA CONG DONG. Ham chi tra hai truong cong
--     khai — request_id (da cong khai tren bang requests) + created_at — KHONG
--     BAO GIHO user_id, nen khong lo nguoi nao da vote bai nao.
--     p_since la moc do client gui (luon ~ "hom nay - 31 ngay"); ham cat tran
--     10.000 hang de mot project lon khong tra ve payload khong lo cho moi lan
--     tai bang.
-- =========================================================
create or replace function public.votes_received(p_since timestamptz)
returns table (request_id uuid, created_at timestamptz)
language sql security definer set search_path = public as $$
  select v.request_id, v.created_at
    from public.votes v
   where v.created_at >= p_since
     and v.created_at < greatest(p_since, now())
   order by v.created_at
   limit 10000
$$;
revoke all on function public.votes_received(timestamptz) from public, anon, authenticated;
grant execute on function public.votes_received(timestamptz) to anon, authenticated;

-- =========================================================
-- 4. ORDERS — mua vote / tra phi paid request
-- =========================================================
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('votes','paid_request')),
  pack        text,                               -- ma goi vote
  qty         int not null default 0,             -- so vote se duoc cong
  amount_usd  numeric(10,2) not null default 0,
  amount_vnd  int not null default 0,
  request_id  uuid references public.requests(id) on delete set null,
  status      text not null default 'awaiting'
              check (status in ('awaiting','paid','rejected')),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

-- =========================================================
-- 5. HAM TIEN ICH
-- =========================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Con bao nhieu luot vote hom nay. Tra rieng vote da mua (purchased) va
-- bonus tu vong quay (bonus); credits = tong cua hai loai, giu de client
-- chua cap nhat va cast_vote van dung.
create or replace function public.my_vote_status()
returns table (free_used int, free_limit int, credits int, purchased int, bonus int)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  return query
    select
      (select count(*)::int from public.votes
        where user_id = v_uid and used_credit = false
          and created_at >= date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh')
                             at time zone 'Asia/Ho_Chi_Minh'),
      3,
      (select vote_credits + bonus_credits from public.profiles where id = v_uid),
      (select vote_credits from public.profiles where id = v_uid),
      (select bonus_credits from public.profiles where id = v_uid);
end $$;

-- =========================================================
-- 6. VOTE / BO VOTE
--    3 vote mien phi / ngay, het thi tru vote da mua
-- =========================================================
-- Bo phieu: p_delta = +1 them mot vote, -1 rut lai mot vote.
-- Mot nguoi vote bao nhieu lan cho cung mot request cung duoc,
-- moi lan van tru mot luot (mien phi truoc, het thi tru vote da mua).
create or replace function public.cast_vote(p_request_id uuid, p_delta int default 1)
returns table (votes int, my_votes int, free_used int, credits int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_new      int;
  v_free     int;
  v_credit   int;
  v_status   text;
  v_picked   timestamptz;
  v_mine     int;
  v_n        int;
  v_freeLeft int;
  v_useFree  int;
  v_useCred  int;
  v_refund   int;
begin
  if v_uid is null then raise exception 'err.voteAuth'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'err.voteQty'; end if;

  select r.status, r.picked_at into v_status, v_picked from public.requests r where r.id = p_request_id;
  if v_status is null then raise exception 'err.requestMissing'; end if;
  if v_status not in ('queued','in_progress') then
    raise exception 'err.voteClosed';
  end if;
  -- Up next khoa vote ca hai chieu (vote them lan rut lai): so vote luc chot
  -- la con so lam viec, khong cho doi nua.
  if v_picked is not null then
    raise exception 'err.voteLocked';
  end if;

  v_n := abs(p_delta);
  select s.free_used, s.credits into v_free, v_credit from public.my_vote_status() s;

  if p_delta < 0 then
    ------------------------------------------------------------------
    -- Rut lai v_n vote gan nhat cua chinh minh
    ------------------------------------------------------------------
    select count(*) into v_mine from public.votes
     where request_id = p_request_id and user_id = v_uid;
    if v_mine < v_n then raise exception 'err.notVoted'; end if;

    with doomed as (
      select id, used_credit from public.votes
       where request_id = p_request_id and user_id = v_uid
       order by created_at desc, id desc
       limit v_n
    ), gone as (
      delete from public.votes v using doomed d where v.id = d.id
      returning v.used_credit
    )
    select count(*) filter (where used_credit) into v_refund from gone;

    if v_refund > 0 then
      update public.profiles set vote_credits = vote_credits + v_refund where id = v_uid;
    end if;
    update public.requests r set votes = greatest(r.votes - v_n, 0), updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  else
    ------------------------------------------------------------------
    -- Them v_n vote: tieu vote mien phi truoc, thieu bao nhieu lay tu vote da mua
    ------------------------------------------------------------------
    v_freeLeft := greatest(3 - v_free, 0);
    v_useFree  := least(v_n, v_freeLeft);
    v_useCred  := v_n - v_useFree;

    if v_useCred > v_credit then
      RAISE EXCEPTION 'Not enough votes. % left.', (v_freeLeft + v_credit);
    end if;

    if v_useCred > 0 then
      -- Tieu bonus (tu vong quay) truoc, thieu moi lay tu vote da mua.
      update public.profiles
         set bonus_credits = greatest(0, bonus_credits - v_useCred),
             vote_credits  = vote_credits - greatest(0, v_useCred - bonus_credits)
       where id = v_uid;
    end if;

    insert into public.votes (request_id, user_id, used_credit)
    select p_request_id, v_uid, g.i > v_useFree
      from generate_series(1, v_n) as g(i);

    update public.requests r set votes = r.votes + v_n, updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  end if;

  select count(*)::int into v_mine from public.votes
   where request_id = p_request_id and user_id = v_uid;
  select s.free_used, s.credits into v_free, v_credit from public.my_vote_status() s;
  return query select v_new, v_mine, v_free, v_credit;
end $$;

drop function if exists public.toggle_vote(uuid);

-- Reset bonus tu vong quay ve 0 (chay bang pg_cron vao 31/10, hoac thu cong).
create or replace function public.reset_bonus_votes()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.profiles set bonus_credits = 0 where bonus_credits <> 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.reset_bonus_votes() from public, anon, authenticated;
grant execute on function public.reset_bonus_votes() to service_role;

-- =========================================================
-- 7. TAO REQUEST — toi da 3 / gio / tai khoan
-- =========================================================
create or replace function public.create_request(
  p_kind text, p_artist text, p_title text,
  p_link text, p_note text, p_paid boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_cnt  int;
  r      public.requests;
begin
  if v_uid is null then raise exception 'err.requestAuth'; end if;

  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'err.needFields';
  end if;

  -- Gioi han 3 request/gio chi ap dung cho request mien phi.
  -- Paid request duoc gui bat cu luc nao va cung khong tinh vao han muc.
  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests
     where user_id = v_uid and is_paid = false
       and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then
      raise exception 'Up to 3 requests per hour.';
    end if;
  end if;

  select name into v_name from public.profiles where id = v_uid;

  insert into public.requests (user_id, kind, artist, title, link, note, requester,
                               is_paid, payment_status, status)
  values (
    v_uid,
    coalesce(nullif(p_kind,''), 'Color Coded Lyrics'),
    left(trim(p_artist),120), left(trim(p_title),160),
    left(coalesce(p_link,''),500), left(coalesce(p_note,''),500),
    coalesce(v_name,'Anonymous'),
    coalesce(p_paid,false),
    case when p_paid then 'awaiting' else 'none' end,
    'pending'
  )
  returning * into r;

  -- paid request ($0.75 / 20.000d) -> tao don hang cho admin xac nhan
  if p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id)
    values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;

  return r;
end $$;

-- =========================================================
-- 8. NGUOI DUNG XOA REQUEST CUA MINH
-- =========================================================
create or replace function public.delete_my_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text; v_owner uuid; v_picked timestamptz;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select user_id, status, picked_at into v_owner, v_status, v_picked from public.requests where id = p_id;
  if v_owner is null then raise exception 'err.requestMissing'; end if;
  if v_owner <> v_uid and not public.is_admin() then
    raise exception 'err.notOwner';
  end if;
  if v_status in ('in_progress','completed') and not public.is_admin() then
    raise exception 'err.deleteLocked';
  end if;
  -- hang da chot Up next thi khoa ca xoa (user tu xoa lam vo ke hoach lam viec)
  if v_picked is not null and not public.is_admin() then
    raise exception 'err.deleteLocked';
  end if;
  delete from public.requests where id = p_id;
end $$;

-- =========================================================
-- 9. HAM ADMIN
-- =========================================================
drop function if exists public.admin_review(uuid,boolean,text);
create or replace function public.admin_review(p_id uuid, p_approve boolean, p_reason text default null, p_video_url text default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_video_url is not null and (length(p_video_url) > 500 or p_video_url !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$') then
    raise exception 'err.denyVideo';
  end if;
  update public.requests
     set status      = case when p_approve then 'queued' else 'denied' end,
         deny_reason = case when p_approve then null else left(coalesce(p_reason,''),300) end,
         video_url   = case when p_approve then null else nullif(trim(p_video_url), '') end,
         updated_at  = now()
   where id = p_id
  returning * into r;
  return r;
end $$;

-- Tien do tinh tu 3 moc: Layout 40% + Lyrics 40% + Edit 20%
create or replace function public.admin_update(
  p_id uuid, p_status text default null, p_progress int default null, p_video_url text default null,
  p_layout boolean default null, p_lyrics boolean default null, p_edit boolean default null,
  p_artist text default null, p_title text default null
) returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests; v_pct int;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  -- ten bai / nghe si: truyen null = giu nguyen; truyen chuoi trang = loi
  if p_artist is not null and length(trim(p_artist)) = 0 then
    raise exception 'err.needFields';
  end if;
  if p_title is not null and length(trim(p_title)) = 0 then
    raise exception 'err.needFields';
  end if;

  update public.requests
     set status      = coalesce(p_status, status),
         video_url   = coalesce(p_video_url, video_url),
         done_layout = coalesce(p_layout, done_layout),
         done_lyrics = coalesce(p_lyrics, done_lyrics),
         done_edit   = coalesce(p_edit,   done_edit),
         artist      = coalesce(nullif(trim(p_artist), ''), artist),
         title       = coalesce(nullif(trim(p_title), ''), title),
         updated_at  = now()
   where id = p_id
  returning * into r;

  -- % luon suy ra tu cac moc, tru khi goi ham truyen thang p_progress
  v_pct := (case when r.done_layout then 40 else 0 end)
         + (case when r.done_lyrics then 40 else 0 end)
         + (case when r.done_edit   then 20 else 0 end);
  if p_progress is not null then v_pct := p_progress; end if;
  if r.status = 'completed' then v_pct := 100; end if;

  update public.requests set progress = v_pct where id = p_id returning * into r;

  -- xong / bi tu choi thi tu roi khoi Up next (picked_at xoa, lich su vote giu nguyen)
  if r.status in ('completed','denied') and r.picked_at is not null then
    update public.requests set picked_at = null where id = p_id returning * into r;
  end if;
  return r;
end $$;

drop function if exists public.admin_update(uuid,text,int,text);
-- xoa ban 7 tham so cu de PostgREST khong thay 2 overload giong ten (loi 300 ambiguous)
drop function if exists public.admin_update(uuid,text,int,text,boolean,boolean,boolean);

-- Chot / go mot request khoi Up next. Chi admin. Hang da chot thi cast_vote
-- tu choi (ke ca goi thang RPC), giao dien chi la lop khoa dau tien.
create or replace function public.admin_pick(p_id uuid, p_picked boolean default true)
returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  update public.requests
     set picked_at  = case when p_picked then coalesce(picked_at, now()) else null end,
         updated_at = now()
   where id = p_id
     and status in ('queued','in_progress')
  returning * into r;
  if r.id is null then raise exception 'err.requestMissing'; end if;
  return r;
end $$;

-- Chot ca cum trung bai len Up next (khoa gom cum giong src/lib/board.js).
create or replace function public.admin_pick_group(p_id uuid, p_picked boolean default true)
returns setof public.requests language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_artist text;
  v_title  text;
  v_status text;
  r        public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  select artist, title, status into v_artist, v_title, v_status
    from public.requests where id = p_id;
  if v_artist is null then raise exception 'err.requestMissing'; end if;

  if p_picked then
    update public.requests
       set picked_at  = coalesce(picked_at, now()),
           updated_at = now()
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress');
  else
    update public.requests
       set picked_at  = null,
           updated_at = now()
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress');
  end if;

  for r in
    select * from public.requests
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress')
     order by picked_at asc nulls last, created_at asc
  loop
    return next r;
  end loop;
end $$;

revoke all on function public.admin_pick_group(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_pick_group(uuid, boolean) to authenticated;
