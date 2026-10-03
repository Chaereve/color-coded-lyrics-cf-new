-- ============================================================
--  COLOR CODED LYRICS — REQUEST BOARD  ·  (c) @chaereve
--  Schema v3: admin, duyet request, vote credits, paid request
--  File GỘP để đối chiếu / chạy bằng psql; KHÔNG dán cả file vào SQL Editor.
--  DB MỚI: xem supabase/setup/README.md, chạy 01 → 10 từng file nhỏ.
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

-- =========================================================
-- 9b1. CHU KY PICK — giu dong ho "Next pick" luon chay
--      Bat ky duong nao set requests.picked_at (cron pick_top_request,
--      admin_pick / admin_pick_group, SQL truc tiep) khi LUOT DA QUA HAN
--      deu tu ghi last_pick_at + next_pick_at moi (= now + interval_days)
--      vao settings.pick. Chot tay giua ky (chua den gio chot tu dong)
--      khong doi lich cua cong chung. Vi du: dong ho dem ve 0 roi admin
--      chot tay -> ngay lap tuc dem lai tu luc chot, khong ket "any moment…".
-- =========================================================
create or replace function public.pick_cycle_touch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cfg     jsonb;
  last_at timestamptz;
  days    int;
  due     boolean;
begin
  -- Chi quan tam nhung dong vua duoc CHOT (picked_at vua co gia tri, con mo vote).
  if new.picked_at is null or new.status not in ('queued', 'in_progress') then
    return new;
  end if;

  select value into cfg from public.settings where key = 'pick';
  if cfg is null then return new; end if;   -- chua co cau hinh chu ky: de nguyen

  days    := coalesce((cfg->>'interval_days')::int, 4);
  last_at := (cfg->>'last_pick_at')::timestamptz;

  -- Luot da toi ky / qua han thi luot chot nay (tu dong hay tay) la luot chot
  -- cua ky -> ghi moc ke tiep. Nguoc lai la chot tay giua ky: khong doi lich.
  due := last_at is null
      or (cfg->>'next_pick_at')::timestamptz is null
      or (cfg->>'next_pick_at')::timestamptz <= now()
      or now() >= last_at + make_interval(days => days);
  if not due then
    return new;
  end if;

  update public.settings
     set value = cfg || jsonb_build_object(
           'last_pick_at', now(),
           'next_pick_at', now() + make_interval(days => days)),
         updated_at = now()
   where key = 'pick';
  return new;
end $$;

drop trigger if exists trg_pick_cycle_after_pick on public.requests;
create trigger trg_pick_cycle_after_pick
  after update of picked_at on public.requests
  for each row execute function public.pick_cycle_touch();

-- Xac nhan don hang: cong vote hoac duyet thang paid request
create or replace function public.admin_order(p_order_id uuid, p_approve boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  update public.orders set status = case when p_approve then 'paid' else 'rejected' end
   where id = p_order_id returning * into o;

  if p_approve then
    if o.kind = 'votes' then
      update public.profiles set vote_credits = vote_credits + o.qty where id = o.user_id;
    elsif o.kind = 'paid_request' and o.request_id is not null then
      -- paid request: duyet thang, khong can vote
      update public.requests
         set status = 'queued', payment_status = 'paid', updated_at = now()
       where id = o.request_id;
    end if;
  else
    if o.kind = 'paid_request' and o.request_id is not null then
      update public.requests set payment_status = 'none' where id = o.request_id;
    end if;
  end if;

  return o;
end $$;

-- Nguoi dung dat mua vote
create or replace function public.buy_votes(p_pack text, p_qty int, p_usd numeric, p_vnd int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); o public.orders;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_qty <= 0 or p_qty > 1000 then raise exception 'err.qty'; end if;
  insert into public.orders (user_id, kind, pack, qty, amount_usd, amount_vnd)
  values (v_uid, 'votes', left(p_pack,40), p_qty, p_usd, p_vnd)
  returning * into o;
  return o;
end $$;

-- Nguoi dung doi ten hien thi va anh dai dien cua chinh minh
create or replace function public.update_my_profile(p_name text, p_avatar text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_name text; pr public.profiles;
begin
  if v_uid is null then raise exception 'err.signin'; end if;

  v_name := left(btrim(coalesce(p_name,'')), 40);
  if length(v_name) < 2 then raise exception 'err.nameShort'; end if;

  -- chan avatar qua lon (data URI ~ 1.5x kich thuoc anh goc)
  if p_avatar is not null and length(p_avatar) > 200000 then
    raise exception 'err.avatarBig';
  end if;

  update public.profiles
     set name = v_name, avatar_url = p_avatar
   where id = v_uid
  returning * into pr;

  -- ten da luu san trong tung request, phai dong bo lai
  update public.requests set requester = v_name where user_id = v_uid;

  return pr;
end $$;

-- Nguoi dung tu huy don dat mua cua minh (chi khi con 'awaiting')
create or replace function public.cancel_my_order(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  o public.orders;
  v_req_status text;
begin
  if v_uid is null then raise exception 'err.signin'; end if;

  select * into o from public.orders where id = p_id;
  if o.id is null then raise exception 'err.orderMissing'; end if;

  if o.user_id <> v_uid and not public.is_admin() then
    raise exception 'err.orderOwner';
  end if;

  if o.status <> 'awaiting' then
    raise exception 'err.orderLocked';
  end if;

  -- don paid request: chi cho huy khi request van dang cho duyet
  if o.kind = 'paid_request' and o.request_id is not null then
    select status into v_req_status from public.requests where id = o.request_id;
    if v_req_status is not null and v_req_status <> 'pending' and not public.is_admin() then
      raise exception 'err.orderPaidLocked';
    end if;
    delete from public.orders  where id = p_id;
    delete from public.requests where id = o.request_id;
    return;
  end if;

  delete from public.orders where id = p_id;
end $$;

-- =========================================================
-- 9b. SETTINGS — cau hinh chot request dinh ky (doc cong khai)
--     App doc key 'pick' -> { interval_days, last_pick_at, next_pick_at }.
--     Chua co cron thi admin tu dat picked_at bang admin_pick();
--     bang nay chi de hien dem nguoc, thieu cung khong vo app.
-- =========================================================
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select using (true);
grant select on public.settings to anon, authenticated;
insert into public.settings (key, value)
values ('pick', '{"interval_days": 4, "last_pick_at": null, "next_pick_at": null}'::jsonb)
on conflict (key) do nothing;

/* Chot tu dong request nhieu vote nhat (chao cron dinh ky).
   Ghi lich chot ke tiep ngay ca khi khong co request nao de chot —
   nho vay dong ho dem nguoc ngoai trang khong bao gio mat so.
   Ham nay KHOA voi public: chi cron (postgres/service_role) goi duoc.
   Admin chot tay bang admin_pick() nhu cu.
   Xep hang theo TONG vote cua ca bai: cac request trung ten bai + nghe si
   (lower(btrim(...)) — dung khoa gom cum voi src/lib/board.js) duoc cong don
   vote truoc khi so hang, giong bang "Top voted" ngoai trang chu. */
create or replace function public.pick_top_request(force boolean default false)
returns setof public.requests
language plpgsql security definer set search_path = public as $$
declare
  cfg     jsonb;
  last_at timestamptz;
  days    int;
  r       public.requests;
begin
  select value into cfg from public.settings where key = 'pick';
  days    := coalesce((cfg->>'interval_days')::int, 4);
  last_at := (cfg->>'last_pick_at')::timestamptz;

  if not force and last_at is not null
     and now() < last_at + make_interval(days => days) then
    return;
  end if;

  select c.* into r
    from public.requests c
   where c.status = 'queued' and c.picked_at is null
   order by
     c.is_paid desc,
     (select coalesce(sum(g.votes), 0)
        from public.requests g
       where lower(btrim(g.artist)) = lower(btrim(c.artist))
         and lower(btrim(g.title))  = lower(btrim(c.title))
         and g.status in ('queued','in_progress')) desc,
     c.votes desc,
     c.created_at asc
   limit 1;

  if found then
    update public.requests set picked_at = now(), updated_at = now() where id = r.id;
    r.picked_at := now();
  end if;

  update public.settings
     set value = cfg || jsonb_build_object(
           'last_pick_at',    now(),
           'next_pick_at',    now() + make_interval(days => days),
           'last_request_id', r.id),
         updated_at = now()
   where key = 'pick';

  if found then return next r; end if;
end $$;

revoke all on function public.pick_top_request(boolean) from public, anon, authenticated;

-- =========================================================
-- 10. BANG XEP HANG NGUOI REQUEST
-- =========================================================
-- security_invoker = on  →  view chay theo quyen cua NGUOI GOI, khong phai
-- quyen cua nguoi tao view. Khong bat cai nay thi view di vong qua RLS,
-- Supabase Advisor bao loi "Security Definer View".
-- Hai bang ben duoi (requests, profiles) von da cho doc cong khai nen
-- doi sang invoker khong lam thay doi ket qua.
create or replace view public.requester_ranking
  with (security_invoker = on) as
  select
    r.user_id,
    max(r.requester)                                              as name,
    max(p.avatar_url)                                             as avatar_url,
    count(*)::int                                                 as total,
    count(*) filter (where r.status = 'completed')::int            as completed,
    coalesce(sum(r.votes),0)::int                                  as total_votes
  from public.requests r
  left join public.profiles p on p.id = r.user_id
  where r.status <> 'denied'
  group by r.user_id;

-- =========================================================
-- 11. ROW LEVEL SECURITY
-- =========================================================
alter table public.profiles enable row level security;
alter table public.requests enable row level security;
alter table public.votes    enable row level security;
alter table public.orders   enable row level security;

drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select using (true);

drop policy if exists "update own profile" on public.profiles;
-- Profile edits go through update_my_profile(); credits/admin are server-only.
revoke insert, update, delete on public.profiles from public, anon, authenticated;

drop policy if exists "read requests" on public.requests;
create policy "read requests" on public.requests for select using (true);

drop policy if exists "read votes" on public.votes;
create policy "read votes" on public.votes for select using (true);

drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- dam bao ca voi project da tao view tu truoc
alter view public.requester_ranking set (security_invoker = on);

-- Cot vote_credits la thong tin rieng cua tung nguoi (so vote da mua con lai).
-- Bo quyen doc ca bang, chi mo dung nhung cot can cho bang xep hang.
-- Rieng nguoi dung van xem duoc so du cua minh qua ham my_vote_status().
revoke select on public.profiles from anon, authenticated;
grant  select (id, name, avatar_url, is_admin) on public.profiles to anon, authenticated;

grant select on public.requester_ranking to anon, authenticated;
grant execute on function public.cast_vote(uuid,int)                                to authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean)   to authenticated;
grant execute on function public.delete_my_request(uuid)                            to authenticated;
grant execute on function public.my_vote_status()                                   to authenticated;
grant execute on function public.buy_votes(text,int,numeric,int)                    to authenticated;
grant execute on function public.cancel_my_order(uuid)                              to authenticated;
grant execute on function public.update_my_profile(text,text)                       to authenticated;
grant execute on function public.admin_review(uuid,boolean,text,text)                    to authenticated;
grant execute on function public.admin_update(uuid,text,int,text,boolean,boolean,boolean,text,text) to authenticated;
grant execute on function public.admin_pick(uuid,boolean)                           to authenticated;
grant execute on function public.admin_order(uuid,boolean)                          to authenticated;
grant execute on function public.is_admin()                                         to authenticated;

-- =========================================================
-- 12. REALTIME
-- =========================================================
do $$ begin alter publication supabase_realtime add table public.requests;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;

-- =========================================================
-- 13. KENH — VIDEO NOI BAT / VIDEO MOI / PLAYLIST
--     Mot bang dung cho ca 3 loai, phan biet bang cot "kind":
--       featured = video noi bat (hero dau trang)
--       video    = video moi
--       playlist = playlist YouTube
--     Chi admin them/sua/xoa duoc; nguoi dung chi doc.
-- =========================================================
create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'video'
              check (kind in ('featured','video','playlist')),
  title       text not null,
  note        text,                         -- mo ta ngan, hien duoi ten
  url         text not null,                -- link YouTube (watch / youtu.be / shorts / playlist)
  thumb       text,                         -- anh bia tu chon; trong = lay thumbnail YouTube
  position    int not null default 0,       -- thu tu hien thi, nho hon = dung truoc
  is_hidden   boolean not null default false, -- an tam (chi admin thay)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Nang cap cho project da chay schema cu
alter table public.media add column if not exists note      text;
alter table public.media add column if not exists thumb     text;
alter table public.media add column if not exists position  int not null default 0;
alter table public.media add column if not exists is_hidden boolean not null default false;

create index if not exists media_kind_idx on public.media (kind, position);

-- Them moi (p_id = null) hoac sua muc co san
create or replace function public.admin_media_save(
  p_id     uuid    default null,
  p_kind   text    default null,
  p_title  text    default null,
  p_note   text    default null,
  p_url    text    default null,
  p_thumb  text    default null,
  p_hidden boolean default null
) returns public.media language plpgsql security definer set search_path = public as $$
declare v public.media; v_kind text; v_title text; v_url text; v_thumb text; v_pos int;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  v_kind  := coalesce(nullif(btrim(p_kind), ''), 'video');
  v_title := left(btrim(coalesce(p_title, '')), 120);
  v_url   := left(btrim(coalesce(p_url, '')), 300);
  v_thumb := nullif(btrim(coalesce(p_thumb, '')), '');

  if v_kind not in ('featured','video','playlist') then
    raise exception 'err.kindBad';
  end if;
  if length(v_title) < 2 then raise exception 'err.nameShort'; end if;
  -- chan link rac: chi nhan link YouTube that (doi khi admin dan nham link khac)
  if v_url !~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/' then
    raise exception 'err.mediaUrl';
  end if;
  if v_thumb is not null and v_thumb !~* '^https?://' then
    raise exception 'err.mediaThumb';
  end if;

  if p_id is null then
    select coalesce(max(position), -1) + 1 into v_pos from public.media;
    insert into public.media (kind, title, note, url, thumb, is_hidden, position)
    values (
      v_kind, v_title, left(btrim(coalesce(p_note, '')), 200), v_url, v_thumb,
      coalesce(p_hidden, false), v_pos
    )
    returning * into v;
  else
    update public.media
       set kind      = v_kind,
           title     = v_title,
           note      = left(btrim(coalesce(p_note, '')), 200),
           url       = v_url,
           thumb     = v_thumb,
           is_hidden = coalesce(p_hidden, is_hidden),
           updated_at = now()
     where id = p_id
    returning * into v;
    if v.id is null then raise exception 'err.mediaMissing'; end if;
  end if;

  return v;
end $$;

create or replace function public.admin_media_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  delete from public.media where id = p_id;
end $$;

-- Sap xep lai: truyen mang id theo thu tu mong muon, ham danh so lai position
create or replace function public.admin_media_reorder(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_i int := 0;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_ids is null then return; end if;
  foreach v_id in array p_ids loop
    update public.media set position = v_i, updated_at = now() where id = v_id;
    v_i := v_i + 1;
  end loop;
end $$;

alter table public.media enable row level security;

drop policy if exists "read media" on public.media;
-- Nguoi dung chi thay muc dang hien; admin thay het de con sua
create policy "read media" on public.media for select
  using (not is_hidden or public.is_admin());

-- Moi thu ghi/sua/xoa deu di qua ham security definer, khong mo policy ghi nao

grant select on public.media                                                        to anon, authenticated;
grant execute on function public.admin_media_save(uuid,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.admin_media_delete(uuid)                           to authenticated;
grant execute on function public.admin_media_reorder(uuid[])                        to authenticated;

do $$ begin alter publication supabase_realtime add table public.media;
exception when duplicate_object then null; end $$;

-- PostgREST may keep the old schema cache for a short time after an additive
-- migration. Reload it explicitly so the next request sees media/RPCs.
notify pgrst, 'reload schema';
-- =========================================================
-- 14. CAP QUYEN ADMIN CHO CHINH BAN
--     Dang nhap Google 1 lan truoc, roi chay dong duoi
--     (thay bang email Google cua ban)
-- =========================================================
-- update public.profiles set is_admin = true
--  where id = (select id from auth.users where email = 'email-cua-ban@gmail.com');

-- BEGIN DAILY SPIN: keep identical to the daily-spin migrations, in order:
--   migrations/20260907_daily_spin.sql
--   migrations/20260908_daily_spin_prizes.sql
--   migrations/20260909_daily_spin_edge.sql
--   migrations/20261102_spin_fp_quota.sql (appended verbatim at the end of this
--     file; bonus_reset 20261031 + vote_status_split 20261101 are folded into
--     the sections above).

-- Daily Spin (2026-09-07). Additive, safe to run again in Supabase SQL Editor.
-- Requires the base schema (profiles + auth). No Edge Function or secret in Vite.
-- IMPORTANT: a device here is a saved browser token, NOT a hardware identity.
-- Signing out does not replace it. Clearing ALL site data / another browser plus
-- another account cannot be reliably detected by a website. Do not use IP as ID.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Opaque 256-bit tokens are issued by the server; only their SHA-256 hashes are
-- stored. Neither a chosen UUID nor a made-up token can claim a fresh quota.
create table if not exists public.daily_spin_devices (
  device_hash   text primary key check (device_hash ~ '^[a-f0-9]{64}$'),
  registered_by uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default clock_timestamp()
);
create index if not exists daily_spin_registration_idx
  on public.daily_spin_devices (registered_by, created_at);

-- This ledger IS the quota. Slots + unique constraints enforce at most two
-- entries per device/day AND account/day, even if callers race in several tabs.
-- Account deletion must not erase the device's already-used daily slots.
create table if not exists public.daily_spins (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null,
  user_id       uuid references auth.users(id) on delete set null,
  device_hash   text not null references public.daily_spin_devices(device_hash),
  spin_day      date not null,
  device_slot   smallint not null check (device_slot between 1 and 2),
  account_slot  smallint not null check (account_slot between 1 and 2),
  segment       smallint not null check (segment between 0 and 7),
  reward        int not null check (reward in (1, 2, 3, 5)),
  created_at    timestamptz not null default clock_timestamp(),
  unique (user_id, request_id),
  unique (device_hash, spin_day, device_slot),
  unique (user_id, spin_day, account_slot)
);

alter table public.daily_spin_devices enable row level security;
alter table public.daily_spins enable row level security;
-- No direct table access, including by an admin in the browser. RPCs expose only
-- the caller's rewards, never the other accounts using a shared device.
revoke all on public.daily_spin_devices, public.daily_spins from public, anon, authenticated;

-- Older schema versions allowed PATCH profiles.vote_credits / is_admin. Bonus
-- credits must not be editable by a client. Profile edits still use their RPC.
drop policy if exists "update own profile" on public.profiles;
revoke insert, update, delete on public.profiles from public, anon, authenticated;

-- Eight equal-sized sectors, in clockwise order. The browser renders this array;
-- it NEVER picks the production reward. Average: 2 votes/spin, 4 votes/day.
create or replace function public.daily_spin_prizes()
returns int[] language sql immutable set search_path = public as $$
  select array[1, 2, 1, 3, 1, 2, 1, 5];
$$;

-- Internal helpers: no client EXECUTE grants.
create or replace function public.daily_spin_device_hash(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'err.spinDevice';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not exists (select 1 from public.daily_spin_devices where device_hash = v_hash) then
    raise exception 'err.spinDevice';
  end if;
  return v_hash;
end $$;

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
    'remaining', greatest(0, 2 - greatest(u.device_used, u.account_used)),
    'credits', (select p.vote_credits from public.profiles p where p.id = p_uid),
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

create or replace function public.register_daily_spin_device()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_now timestamptz;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- Serialize registrations by the same account and cap storage-abuse attempts.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  if (select count(*) from public.daily_spin_devices
      where registered_by = v_uid
        and created_at >= date_trunc('day', v_now at time zone 'Asia/Ho_Chi_Minh')
                          at time zone 'Asia/Ho_Chi_Minh') >= 5 then
    raise exception 'err.spinRegistration';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.daily_spin_devices (device_hash, registered_by, created_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid, v_now);
  return v_token;
end $$;

create or replace function public.my_daily_spin_status(p_device_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hash text;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);
  return public.daily_spin_payload(v_hash, v_uid, clock_timestamp());
end $$;

create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_now timestamptz;
  v_day date;
  v_device_used int;
  v_account_used int;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- A sign-out/account switch while registering a browser must not give a spin
  -- intended for A to B. The recipient is ALWAYS auth.uid(), never a client ID.
  if p_expected_user_id is distinct from v_uid then raise exception 'err.spinAccountChanged'; end if;
  if p_request_id is null then raise exception 'err.spinRequest'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);

  -- Always lock device, then profile, in that order. Device lock serializes
  -- different accounts; profile lock serializes the same account across devices
  -- and keeps balance updates atomic with other credit operations.
  perform 1 from public.daily_spin_devices where device_hash = v_hash for update;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  -- Retry BEFORE checking today's quota: a lost response, refresh, or midnight
  -- retry must return the original win, not spend another spin or add credits.
  select * into v_spin from public.daily_spins
    where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_spin.device_hash <> v_hash then raise exception 'err.spinRequest'; end if;
    v_replayed := true;
  else
    -- Capture the day AFTER waiting for locks, using server time, not the client.
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
    select count(*)::int into v_device_used from public.daily_spins
      where device_hash = v_hash and spin_day = v_day;
    select count(*)::int into v_account_used from public.daily_spins
      where user_id = v_uid and spin_day = v_day;
    if v_device_used >= 2 then raise exception 'err.spinDeviceLimit'; end if;
    if v_account_used >= 2 then raise exception 'err.spinAccountLimit'; end if;

    -- 256 is divisible by 8: cryptographic random byte, uniform, no modulo bias.
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % 8;
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now
    ) returning * into v_spin;

    -- Same transaction as the ledger. A failure rolls BOTH back. Bonus shares
    -- the existing credit balance (spent after free votes; never expires daily).
    update public.profiles set vote_credits = vote_credits + v_spin.reward where id = v_uid;
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

-- Postgres grants EXECUTE to PUBLIC by default: explicitly revoke on ALL helpers
-- and RPCs, then allow only the three authenticated entry points.
revoke all on function public.daily_spin_prizes() from public, anon, authenticated;
revoke all on function public.daily_spin_device_hash(text) from public, anon, authenticated;
revoke all on function public.daily_spin_payload(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.register_daily_spin_device() from public, anon, authenticated;
revoke all on function public.my_daily_spin_status(text) from public, anon, authenticated;
revoke all on function public.spin_daily(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_daily_spin_device() to authenticated;
grant execute on function public.my_daily_spin_status(text) to authenticated;
grant execute on function public.spin_daily(text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Daily Spin prize table v2 (2026-09-08). Additive, safe to run again.
-- Run AFTER 20260907_daily_spin.sql (a project that already has Daily Spin only
-- needs THIS file). Nothing is deleted and no reward is re-drawn: rows already in
-- the ledger keep their segment/reward, only the sector range widens and the
-- odds of a NEW spin change.
--
-- WHY. Eight equal sectors gave every slice a 1/8 draw, so the +5 jackpot paid
-- exactly as often as the +3 (12.5% each): 2 votes per spin, 4 votes per day,
-- ~20k VND of paid value handed out daily per browser. Sixteen equal sectors keep
-- the draw uniform while the slice the player sees IS the real chance:
--   +1 vote  x9 = 56.25%  |  +2 votes x4 = 25%
--   +3 votes x2 = 12.5%   |  +5 votes x1 = 6.25%
-- Average 1.75 votes/spin (3.5/day, still at most 10/day). No blank sector:
-- every spin wins something, and the jackpot stays worth waiting for.
--
-- 16 divides 256, so ONE cryptographic byte still needs no rejection sampling.
-- The browser renders public.daily_spin_prizes() and animates to the returned
-- sector; it never picks the reward.

begin;

-- The ledger was created with an unnamed `check (segment between 0 and 7)`.
-- Drop whatever that constraint is called on THIS project (a hand-edited install
-- may have renamed it), then widen to the new sector count. Existing rows are
-- 0..7, so validating the new constraint cannot fail on real data.
do $$
declare v_con record;
begin
  for v_con in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'daily_spins' and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%segment%'
  loop
    execute format('alter table public.daily_spins drop constraint %I', v_con.conname);
  end loop;
end $$;

alter table public.daily_spins
  add constraint daily_spins_segment_check check (segment between 0 and 15);

-- Sixteen equal sectors, clockwise from twelve o'clock. Ordered so the four
-- prize tiers keep alternating (no long run of the same value) and the single
-- jackpot sits opposite the pointer, at six o'clock.
create or replace function public.daily_spin_prizes()
returns int[] language sql immutable set search_path = public as $$
  select array[1, 2, 1, 3, 1, 1, 2, 1, 5, 1, 2, 1, 3, 1, 2, 1];
$$;

-- Re-declared in full: a plpgsql body cannot be patched. Identical to the
-- 2026-09-07 version except for the marked sector draw. Grants/revokes survive
-- `create or replace`, so the browser still reaches only the three entry points.
create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_now timestamptz;
  v_day date;
  v_device_used int;
  v_account_used int;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_sectors int := array_length(public.daily_spin_prizes(), 1);
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- A sign-out/account switch while registering a browser must not give a spin
  -- intended for A to B. The recipient is ALWAYS auth.uid(), never a client ID.
  if p_expected_user_id is distinct from v_uid then raise exception 'err.spinAccountChanged'; end if;
  if p_request_id is null then raise exception 'err.spinRequest'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);

  -- Always lock device, then profile, in that order. Device lock serializes
  -- different accounts; profile lock serializes the same account across devices
  -- and keeps balance updates atomic with other credit operations.
  perform 1 from public.daily_spin_devices where device_hash = v_hash for update;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  -- Retry BEFORE checking today's quota: a lost response, refresh, or midnight
  -- retry must return the original win, not spend another spin or add credits.
  select * into v_spin from public.daily_spins
    where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_spin.device_hash <> v_hash then raise exception 'err.spinRequest'; end if;
    v_replayed := true;
  else
    -- Capture the day AFTER waiting for locks, using server time, not the client.
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
    select count(*)::int into v_device_used from public.daily_spins
      where device_hash = v_hash and spin_day = v_day;
    select count(*)::int into v_account_used from public.daily_spins
      where user_id = v_uid and spin_day = v_day;
    if v_device_used >= 2 then raise exception 'err.spinDeviceLimit'; end if;
    if v_account_used >= 2 then raise exception 'err.spinAccountLimit'; end if;

    -- vvv CHANGED (2026-09-08): sector count comes from the prize array, not a
    -- hard-coded 8. Refuse to draw when it no longer divides 256 — a silent
    -- modulo bias would quietly overpay whoever owns the leftover sectors.
    if v_sectors is null or v_sectors < 1 or 256 % v_sectors <> 0 then
      raise exception 'err.spinSetup';
    end if;
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % v_sectors;
    -- ^^^ CHANGED
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now
    ) returning * into v_spin;

    -- Same transaction as the ledger. A failure rolls BOTH back. Bonus shares
    -- the existing credit balance (spent after free votes; never expires daily).
    update public.profiles set vote_credits = vote_credits + v_spin.reward where id = v_uid;
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

-- Restated for safety: helpers stay private even if a superuser granted them
-- away while experimenting, and the three entry points stay callable.
revoke all on function public.daily_spin_prizes() from public, anon, authenticated;
revoke all on function public.spin_daily(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Daily Spin edge audit (2026-09-09). Additive, safe to run again.
-- Run AFTER 20260908_daily_spin_prizes.sql. Adds two AUDIT columns fed by the
-- Cloudflare Worker shield (sha256 of the browser fingerprint, sha256 of the
-- CF-Connecting-IP) and widens spin_daily() with two optional parameters.
--
-- These columns change NOTHING about quota or rewards: the ledger's unique
-- device/account slots stay the source of truth. They exist so a farm incident
-- can be investigated after the fact ("which hashes hit this account today?")
-- without storing raw IPs or reversible fingerprints. Hashes arrive pre-hashed
-- from the Worker; a caller hitting the RPC directly can send nulls or garbage
-- and the function normalises both to NULL.

begin;

alter table public.daily_spins add column if not exists fp_hash text;
alter table public.daily_spins add column if not exists ip_hash text;
alter table public.daily_spins drop constraint if exists daily_spins_fp_hash_check;
alter table public.daily_spins
  add constraint daily_spins_fp_hash_check check (fp_hash is null or fp_hash ~ '^[a-f0-9]{64}$');
alter table public.daily_spins drop constraint if exists daily_spins_ip_hash_check;
alter table public.daily_spins
  add constraint daily_spins_ip_hash_check check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$');

-- Replace the 3-arg overload with the 5-arg one (defaults keep every existing
-- caller — browser, tests, cron — working unchanged).
drop function if exists public.spin_daily(text, uuid, uuid);

create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid,
  p_fp_hash text default null, p_ip_hash text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_now timestamptz;
  v_day date;
  v_device_used int;
  v_account_used int;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_sectors int := array_length(public.daily_spin_prizes(), 1);
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- A sign-out/account switch while registering a browser must not give a spin
  -- intended for A to B. The recipient is ALWAYS auth.uid(), never a client ID.
  if p_expected_user_id is distinct from v_uid then raise exception 'err.spinAccountChanged'; end if;
  if p_request_id is null then raise exception 'err.spinRequest'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);

  -- vvv ADDED (2026-09-09): audit-only columns fed by the Edge Worker. They never
  -- influence quota or rewards; garbage from a direct caller becomes NULL.
  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;
  -- ^^^ ADDED

  -- Always lock device, then profile, in that order. Device lock serializes
  -- different accounts; profile lock serializes the same account across devices
  -- and keeps balance updates atomic with other credit operations.
  perform 1 from public.daily_spin_devices where device_hash = v_hash for update;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  -- Retry BEFORE checking today's quota: a lost response, refresh, or midnight
  -- retry must return the original win, not spend another spin or add credits.
  select * into v_spin from public.daily_spins
    where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_spin.device_hash <> v_hash then raise exception 'err.spinRequest'; end if;
    v_replayed := true;
  else
    -- Capture the day AFTER waiting for locks, using server time, not the client.
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
    select count(*)::int into v_device_used from public.daily_spins
      where device_hash = v_hash and spin_day = v_day;
    select count(*)::int into v_account_used from public.daily_spins
      where user_id = v_uid and spin_day = v_day;
    if v_device_used >= 2 then raise exception 'err.spinDeviceLimit'; end if;
    if v_account_used >= 2 then raise exception 'err.spinAccountLimit'; end if;

    -- vvv CHANGED (2026-09-08): sector count comes from the prize array, not a
    -- hard-coded 8. Refuse to draw when it no longer divides 256 — a silent
    -- modulo bias would quietly overpay whoever owns the leftover sectors.
    if v_sectors is null or v_sectors < 1 or 256 % v_sectors <> 0 then
      raise exception 'err.spinSetup';
    end if;
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % v_sectors;
    -- ^^^ CHANGED
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at, fp_hash, ip_hash
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now, p_fp_hash, p_ip_hash
    ) returning * into v_spin;

    -- Same transaction as the ledger. A failure rolls BOTH back. Bonus from the
    -- wheel goes to its own balance (spent after free votes; reset every Oct 31).
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

-- New signature, same access rule: authenticated callers only.
revoke all on function public.spin_daily(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
-- END DAILY SPIN

-- Vote status split (2026-11-01, migrations/20261101_vote_status_split.sql):
-- my_vote_status() above already returns (free_used, free_limit, credits,
-- purchased, bonus). Re-declare the spin payload in FULL (a plpgsql/sql body
-- cannot be patched) with the matching 'purchased' and 'bonus' keys beside the
-- total 'credits', so a fresh install ends with the same functions a migrated
-- project has.
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
    'remaining', greatest(0, 2 - greatest(u.device_used, u.account_used)),
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

-- =========================================================
-- DAILY SPIN — FINGERPRINT/IP QUOTA IN POSTGRES (2026-11-02)
-- migrations/20261102_spin_fp_quota.sql, kept verbatim so a fresh
-- install ends with the same functions a migrated project has.
-- =========================================================

-- Daily Spin — chốt hạn mức fingerprint/IP NGAY TRONG Postgres (2026-11-02).
-- Chạy SAU 20261031_bonus_reset.sql (spin_daily 5 tham số hiện hành). Additive,
-- chạy lại an toàn: chỉ ALTER/ADD column, CREATE UNIQUE INDEX và CREATE OR
-- REPLACE function. Dữ liệu cũ giữ nguyên.
--
-- Vì sao: trước đây hạn mức chỉ trông vào device_hash (một token ngẫu nhiên cấp
-- cho từng trình duyệt) còn fp_hash/ip_hash chỉ là hai cột "audit" do Edge
-- Worker gửi sang. Đổi trình duyệt / xoá site data / ẩn danh là được cấp token
-- mới → có 2 lượt mới; gọi thẳng RPC thì chẳng gửi fp/ip gì. Migration này biến
-- Postgres thành nguồn sự thật:
--   · Cột fp_slot + unique index (fp_hash, spin_day, fp_slot): cùng một vân tay
--     dù đổi tài khoản/token/thiết bị cũng chỉ 2 lượt/ngày, chống cả đua tài
--     khoản bằng chính ràng buộc của DB.
--   · spin_daily đếm CHUNG mọi tài khoản theo fp_hash (>=2 → err.spinEdgeFp) và
--     theo ip_hash (quá 5 vân tay khác nhau/ngày → err.spinEdgeIp). Gọi thẳng
--     RPC cũng bị chặn như đi qua Worker.
--
-- Giới hạn thật sự: web KHÔNG thể khoá "một máy vật lý". FingerprintJS định danh
-- một TRÌNH DUYỆT: đổi acc/ẩn danh/xoá data trong cùng dòng trình duyệt thì bị
-- chặn; Chrome↔Firefox trên cùng máy có thể ra ID khác và chỉ còn lớp IP (5 vân
-- tay/IP/ngày) chặn sau. Muốn chặt hơn nữa thì cần OTP điện thoại hoặc
-- Fingerprint Pro / attestation.

begin;

-- 1) fp_slot = thứ tự lượt quay (1..2) của MỘT vân tay trong ngày; NULL khi
--    không gửi vân tay. Kèm unique index phía dưới để khoá chặt ngay trong DB.
alter table public.daily_spins add column if not exists fp_slot smallint;
alter table public.daily_spins drop constraint if exists daily_spins_fp_slot_check;
alter table public.daily_spins
  add constraint daily_spins_fp_slot_check check (fp_slot is null or fp_slot between 1 and 2);

-- Ràng buộc cứng: không thể có hai dòng cùng (fp_hash, spin_day, fp_slot) — đây
-- là chốt chặn sau cùng nếu khoá advisory bên dưới bị lách. Dòng fp_hash NULL
-- không được index (người không gửi vân tay giữ hành vi cũ: không có hạn mức fp).
create unique index if not exists daily_spins_fp_quota_idx
  on public.daily_spins (fp_hash, spin_day, fp_slot)
  where fp_hash is not null;

-- 2) spin_daily: kiểm tra hạn mức fp/ip trong CHÍNH transaction ghi ledger + cộng
--    thưởng. Một lỗi hạn mức rollback toàn bộ, không mất lượt, không mất thưởng.
create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid,
  p_fp_hash text default null, p_ip_hash text default null
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
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- A sign-out/account switch while registering a browser must not give a spin
  -- intended for A to B. The recipient is ALWAYS auth.uid(), never a client ID.
  if p_expected_user_id is distinct from v_uid then raise exception 'err.spinAccountChanged'; end if;
  if p_request_id is null then raise exception 'err.spinRequest'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);

  -- fingerprint/IP giờ là đầu vào của hạn mức: chỉ nhận hash 64-hex thật; rác từ
  -- caller gọi thẳng RPC trở thành NULL (không có hạn mức fp/ip). Worker đã băm
  -- trước khi chuyển sang.
  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

  -- Always lock device, then profile, in that order. Device lock serializes
  -- different accounts; profile lock serializes the same account across devices
  -- and keeps balance updates atomic with other credit operations.
  perform 1 from public.daily_spin_devices where device_hash = v_hash for update;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  -- Retry BEFORE checking today's quota: a lost response, refresh, or midnight
  -- retry must return the original win, not spend another spin or add credits.
  select * into v_spin from public.daily_spins
    where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_spin.device_hash <> v_hash then raise exception 'err.spinRequest'; end if;
    v_replayed := true;
  else
    -- Capture the day AFTER waiting for locks, using server time, not the client.
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;

    -- Khoá advisory theo fp_hash/ip_hash để các lượt quay trùng vân tay / trùng
    -- IP (từ thiết bị/tài khoản KHÁC nhau — row lock ở trên không xếp hàng được)
    -- chạy tuần tự. Nhờ vậy "đếm → chọn slot" bên dưới không đua nhau; unique
    -- index chỉ còn là chốt chặn sau cùng. Khoá luôn lấy theo cùng một thứ tự
    -- (fp trước, ip sau) nên không deadlock.
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

    -- Hạn mức fingerprint: đếm CHUNG mọi tài khoản, mọi device token. Đổi
    -- acc/token/thiết bị mà cùng vân tay vẫn chỉ 2 lượt/ngày.
    v_fp_used := 0;
    v_fp_slot := null;
    if p_fp_hash is not null then
      select count(*)::int into v_fp_used from public.daily_spins
        where fp_hash = p_fp_hash and spin_day = v_day;
      if v_fp_used >= 2 then raise exception 'err.spinEdgeFp'; end if;
      v_fp_slot := v_fp_used + 1;
    end if;

    -- Hạn mức IP: một IP đã thấy 5 vân tay KHÁC nhau trong ngày thì từ chối vân
    -- tay mới (dấu hiệu anti-detect browser). Khớp worker/shield.js: vân tay đã
    -- biết giữ nguyên 2 lượt riêng của nó.
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
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at, fp_hash, ip_hash, fp_slot
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now, p_fp_hash, p_ip_hash, v_fp_slot
    ) returning * into v_spin;

    -- Same transaction as the ledger. A failure rolls BOTH back. Bonus from the
    -- wheel goes to its own balance (spent after free votes; reset every Oct 31).
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

-- New signature, same access rule: authenticated callers only.
revoke all on function public.spin_daily(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- =========================================================
-- RLS HARDENING (2026-09-06) — migrations/20260906_rls_hardening.sql,
-- kept verbatim so a fresh install ends with the same policies, constraints
-- and price checks a migrated project has. Trước đây khối này CHỈ nằm trong
-- migration: ai cài mới bằng schema.sql (hoặc chạy lại schema.sql "cho chắc")
-- sẽ mất cả 4 lớp bảo vệ bên dưới. Đừng gỡ nó ra khỏi đây.
-- =========================================================

-- Color Coded Lyrics — RLS hardening (2026-09-06)
--
-- Chay 1 lan trong Supabase SQL Editor. Chay lai cung an toan.
-- Khong DROP/TRUNCATE bang nao, du lieu giu nguyen.
--
-- Tai sao can file nay: Supabase mac dinh cap quyen ghi (insert/update/delete)
-- tren cac bang cho anon/authenticated, RLS + policy moi la thu that su chan.
-- Ra soat thay 1 lo ho nang + 3 cho can cung lai:
--
--   1. [NANG] policy "update own profile" cho phep moi user dang nhap PATCH
--      TRUC TIEP bang profiles — tu set is_admin = true (thanh admin) hoac
--      vote_credits = 999999 (vote mien phi vo han), khong can qua ham nao.
--      Va bang cach: xoa policy do + thu hoi quyen ghi truc tiep tren ca 6 bang.
--      Doi ten/avatar van di qua ham update_my_profile() nhu cu (security
--      definer chay quyen owner, khong bi anh huong). Da kiem tra src/:
--      khong cho nao insert/update/delete truc tiep vao bang.
--
--   2. [RIENG TU] bang votes truoc day ai cung doc duoc: lo user_id cua tung
--      luot vote (ai vote cho bai nao). Thu lai chi cho doc hang cua minh
--      (+ admin). Dem tong vote van lay tu cot requests.votes nhu cu; app
--      chi doc votes cua chinh user (db.js: .eq('user_id', uid)) nen khong
--      vo giao dien.
--
--   3. [CHONG GIAN LAN] vote_credits co the bi tru am neu goi cast_vote dong
--      thoi nhieu lan (check truoc, tru sau). Them rang buoc >= 0.
--
--   4. [CHONG GIAN LAN] buy_votes truoc day tin gia client gui len: user co
--      the tao don qty = 1000 kem amount = 0.01 de lua admin duyet. Gio gia
--      phai khop bang gia server (3 goi v3/v10/v30 + mua le 0.19$/5000d),
--      sai la ham nem loi, khong tao don.

-- 1. khoa ghi truc tiep ----------------------------------------------------
drop policy if exists "update own profile" on public.profiles;

revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.requests from anon, authenticated;
revoke insert, update, delete on public.votes    from anon, authenticated;
revoke insert, update, delete on public.orders   from anon, authenticated;
revoke insert, update, delete on public.settings from anon, authenticated;
revoke insert, update, delete on public.media    from anon, authenticated;

-- 2. votes: chi doc hang cua minh -------------------------------------------
-- Drop both the old policy name and the final policy name so this whole
-- schema remains safe to run again after a previous run reached this block.
drop policy if exists "read votes" on public.votes;
drop policy if exists "read own votes" on public.votes;
create policy "read own votes" on public.votes
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 3. vote_credits khong bao gio am -------------------------------------------
update public.profiles set vote_credits = 0 where vote_credits < 0;
do $$ begin
  alter table public.profiles
    add constraint profiles_credits_nonneg check (vote_credits >= 0);
exception when duplicate_object then null; end $$;

-- 4. buy_votes: server tu quyet gia ------------------------------------------
create or replace function public.buy_votes(p_pack text, p_qty int, p_usd numeric, p_vnd int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); o public.orders;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_qty <= 0 or p_qty > 100 then raise exception 'err.qty'; end if;

  -- khop 1 trong 3 goi co dinh hoac cong thuc mua le (0.19 USD / 5000 VND 1 vote)
  if not (
    (p_pack = 'v3'  and p_qty = 3  and p_usd = 0.49 and p_vnd = 13000) or
    (p_pack = 'v10' and p_qty = 10 and p_usd = 1.29 and p_vnd = 34000) or
    (p_pack = 'v30' and p_qty = 30 and p_usd = 2.99 and p_vnd = 78000) or
    (p_pack = 'custom' and p_usd = round(0.19 * p_qty, 2) and p_vnd = 5000 * p_qty)
  ) then
    raise exception 'err.priceChanged';
  end if;

  insert into public.orders (user_id, kind, pack, qty, amount_usd, amount_vnd)
  values (v_uid, 'votes', left(p_pack,40), p_qty, p_usd, p_vnd)
  returning * into o;
  return o;
end $$;

-- Kiem tra nhanh sau khi chay:
--   select policyname, cmd from pg_policies where tablename in ('profiles','votes');

-- =========================================================
-- VOTE HARDENING (2026-11-03) — migrations/20261103_vote_hardening.sql,
-- kept verbatim. Chống race khi vote, hạn mức theo vân tay, hoàn đúng ví khi
-- rút vote, cổng Edge cho cast_vote/spin_daily, admin_order idempotent.
-- Chạy sau khối fingerprint quota ở trên.
-- =========================================================

-- Color Coded Lyrics — siết chống gian lận VOTE (2026-11-03)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại an toàn: chỉ ADD COLUMN /
-- CREATE INDEX / CREATE OR REPLACE FUNCTION, không DROP/TRUNCATE bảng nào.
-- Chạy SAU 20261102_spin_fp_quota.sql.
--
-- ĐỌC TRƯỚC KHI CHẠY. File này vá 8 lỗ hổng đã tìm thấy trong đợt rà soát
-- 2026-09-08 (xem docs/RA-SOAT-2026-09-08.md):
--
--   1. [NẶNG] cast_vote không khoá hàng profiles trước khi đọc hạn mức. Gửi
--      N lượt cast_vote SONG SONG thì cả N đều thấy free_used = 0 → 3×N vote
--      miễn phí thay vì 3. Sửa bằng khoá hàng + hạn mức nằm trong UNIQUE
--      INDEX (cùng triết lý với daily_spins: ràng buộc giữ hạn mức, không
--      phải logic).
--
--   2. [NẶNG] Vote không có bất kỳ tín hiệu chống đa tài khoản nào, trong khi
--      Daily Spin có đủ device/fingerprint/IP. Nay votes lưu fp_hash + ip_hash
--      và MỘT VÂN TAY chỉ có 3 vote miễn phí/ngày dù đổi bao nhiêu tài khoản.
--
--   3. [NẶNG] Ai cũng gọi thẳng PostgREST bằng anon key, nên Turnstile/KV ở
--      Cloudflare Worker có thể đi vòng. Nay có "cổng Edge": khi đã đặt token
--      (public.set_edge_gate_token), cast_vote và spin_daily CHỈ chấp nhận lời
--      gọi kèm token đó — tức chỉ Worker gọi được. Chưa đặt token = cổng tắt,
--      mọi thứ chạy y như cũ.
--
--   4. [VỪA] Rút vote luôn hoàn về vote_credits (ví "đã mua") kể cả khi lúc
--      tiêu lấy từ bonus → bonus né được đợt reset 31/10. Nay mỗi dòng vote
--      ghi rõ tiêu ví nào (credit_kind) và hoàn về đúng ví đó.
--
--   5. [VỪA] admin_order cộng credit mỗi lần gọi → bấm hai lần là cộng đôi.
--      Nay chỉ đơn đang 'awaiting' mới xử lý được.
--
--   6. [VỪA] Chủ request xoá được bài đang có vote của NGƯỜI KHÁC (kể cả vote
--      đã mua) và không ai được hoàn. Nay chặn, admin vẫn xoá được.
--
--   7. [VỪA] paid request bỏ qua rate limit → spam vô hạn request pending +
--      đơn hàng. Nay tối đa 5 paid request đang chờ thanh toán/tài khoản.
--
--   8. [TIỆN ÍCH] recount_request_votes(): dựng lại requests.votes từ bảng
--      votes. Bắt buộc chạy sau khi xoá vote/tài khoản gian lận, nếu không số
--      vote gian lận vẫn treo trên bảng xếp hạng.
--
-- GIỚI HẠN THẬT SỰ (không hứa quá): fingerprint định danh một TRÌNH DUYỆT,
-- không phải một con người. Khi CHƯA bật cổng Edge, kẻ gọi thẳng RPC có thể
-- không gửi fp_hash và thoát hạn mức vân tay — chỉ còn hạn mức tài khoản
-- (3 free/ngày, giờ đã chống được race). Muốn chặn thật thì phải deploy
-- Worker và bật cổng (mục 1 bên dưới).

begin;

-- =========================================================
-- 1. CỔNG EDGE — chỉ Worker mới gọi được RPC nhạy cảm
-- =========================================================
-- Bảng một dòng giữ SHA-256 của token bí mật. token_hash = null nghĩa là
-- cổng TẮT (hành vi y như trước file này). Bảng không cấp quyền cho ai:
-- chỉ hàm security definer đọc được, kể cả admin ngồi trên trình duyệt.
create table if not exists public.edge_gate (
  id         boolean primary key default true check (id),
  token_hash text,
  updated_at timestamptz not null default now()
);
insert into public.edge_gate (id, token_hash) values (true, null)
  on conflict (id) do nothing;

alter table public.edge_gate enable row level security;
revoke all on public.edge_gate from public, anon, authenticated;

-- Đặt / gỡ token. Chạy trong SQL Editor (quyền postgres):
--   select public.set_edge_gate_token('chuỗi-bí-mật-dài-ít-nhất-32-ký-tự');
--   select public.set_edge_gate_token(null);   -- tắt cổng
-- Rồi đặt đúng chuỗi đó cho Worker:  wrangler secret put EDGE_GATE_TOKEN
-- ⚠ CHỈ bật sau khi Worker đã deploy và app đã build với VITE_SPIN_GATE_URL,
--   nếu không mọi lượt vote/quay đều bị từ chối.
create or replace function public.set_edge_gate_token(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_token is not null and length(btrim(p_token)) < 32 then
    raise exception 'Token phải dài ít nhất 32 ký tự.';
  end if;
  update public.edge_gate
     set token_hash = case
           when p_token is null or btrim(p_token) = '' then null
           else encode(extensions.digest(btrim(p_token), 'sha256'), 'hex') end,
         updated_at = now()
   where id;
end $$;

revoke all on function public.set_edge_gate_token(text) from public, anon, authenticated;
grant execute on function public.set_edge_gate_token(text) to service_role;

-- true = được đi tiếp. Cổng tắt thì luôn true.
create or replace function public.edge_gate_ok(p_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_hash text;
begin
  select token_hash into v_hash from public.edge_gate where id;
  if v_hash is null then return true; end if;
  if p_token is null or length(p_token) < 32 then return false; end if;
  return encode(extensions.digest(p_token, 'sha256'), 'hex') = v_hash;
end $$;

revoke all on function public.edge_gate_ok(text) from public, anon, authenticated;

-- =========================================================
-- 2. BẢNG VOTES — hạn mức nằm trong ràng buộc, không nằm trong logic
-- =========================================================
-- vote_day    : ngày theo giờ VN của lượt vote (khớp my_vote_status).
-- free_slot   : thứ tự 1..3 của vote MIỄN PHÍ trong ngày của một tài khoản.
-- fp_slot     : thứ tự 1..3 của vote MIỄN PHÍ trong ngày của một VÂN TAY.
-- credit_kind : lượt vote này tiêu ví nào — để hoàn đúng ví khi rút lại.
-- fp_hash/ip_hash: dấu vết điều tra (sha256, không lưu IP thô).
alter table public.votes add column if not exists vote_day    date;
alter table public.votes add column if not exists free_slot   smallint;
alter table public.votes add column if not exists fp_slot     smallint;
alter table public.votes add column if not exists credit_kind text;
alter table public.votes add column if not exists fp_hash     text;
alter table public.votes add column if not exists ip_hash     text;

-- Backfill TRƯỚC khi đặt default: nếu thêm cột kèm default thì mọi dòng cũ sẽ
-- mang ngày hôm nay và ăn mất hạn mức free của người dùng trong đúng ngày chạy
-- migration.
update public.votes
   set vote_day = (created_at at time zone 'Asia/Ho_Chi_Minh')::date
 where vote_day is null;

update public.votes
   set credit_kind = case when used_credit then 'purchased' else 'free' end
 where credit_kind is null;

-- Đánh số lại slot cho các vote miễn phí đã có (mỗi tài khoản mỗi ngày 1..3;
-- dòng thứ 4 trở đi của những ngày từng bị khai thác race giữ nguyên null nên
-- không làm vỡ unique index).
with ranked as (
  select id, row_number() over (
           partition by user_id, vote_day order by created_at, id) as rn
  from public.votes
  where used_credit = false and free_slot is null
)
update public.votes v
   set free_slot = r.rn
  from ranked r
 where r.id = v.id and r.rn <= 3;

alter table public.votes alter column vote_day
  set default ((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date);
alter table public.votes alter column vote_day set not null;

alter table public.votes drop constraint if exists votes_free_slot_check;
alter table public.votes add constraint votes_free_slot_check
  check (free_slot is null or free_slot between 1 and 3);

alter table public.votes drop constraint if exists votes_fp_slot_check;
alter table public.votes add constraint votes_fp_slot_check
  check (fp_slot is null or fp_slot between 1 and 3);

alter table public.votes drop constraint if exists votes_credit_kind_check;
alter table public.votes add constraint votes_credit_kind_check
  check (credit_kind is null or credit_kind in ('free', 'bonus', 'purchased'));

-- CHỐT CHẶN CUỐI CÙNG cho hạn mức miễn phí. Kể cả khi khoá hàng bên dưới bị
-- lách (hoặc ai đó sửa hàm), database vẫn không thể chứa vote free thứ 4 của
-- một tài khoản trong một ngày.
create unique index if not exists votes_free_quota_idx
  on public.votes (user_id, vote_day, free_slot)
  where free_slot is not null;

-- Cùng một vân tay = cùng 3 vote miễn phí/ngày, dù đăng nhập bao nhiêu tài
-- khoản. Dòng không có vân tay không bị index (giữ hành vi cũ).
create unique index if not exists votes_fp_free_quota_idx
  on public.votes (fp_hash, vote_day, fp_slot)
  where fp_hash is not null and fp_slot is not null;

create index if not exists votes_day_idx on public.votes (vote_day, user_id);
create index if not exists votes_fp_idx  on public.votes (fp_hash, vote_day)
  where fp_hash is not null;
create index if not exists votes_ip_idx  on public.votes (ip_hash, vote_day)
  where ip_hash is not null;

-- =========================================================
-- 3. MY_VOTE_STATUS — đếm theo vote_day cho khớp hạn mức mới
-- =========================================================
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
          and vote_day = (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date),
      3,
      (select vote_credits + bonus_credits from public.profiles where id = v_uid),
      (select vote_credits from public.profiles where id = v_uid),
      (select bonus_credits from public.profiles where id = v_uid);
end $$;

-- =========================================================
-- 4. CAST_VOTE — khoá hàng, hạn mức vân tay, hoàn đúng ví
-- =========================================================
-- Chữ ký đổi (thêm 3 tham số tuỳ chọn) nên phải bỏ bản 2 tham số, nếu không
-- PostgREST thấy hai overload cùng tên và trả lỗi 300 ambiguous.
drop function if exists public.cast_vote(uuid, int);

create or replace function public.cast_vote(
  p_request_id uuid,
  p_delta int default 1,
  p_fp_hash text default null,
  p_ip_hash text default null,
  p_gate_token text default null
)
returns table (votes int, my_votes int, free_used int, credits int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_day       date;
  v_new       int;
  v_status    text;
  v_picked    timestamptz;
  v_mine      int;
  v_n         int;
  v_purch     int;
  v_bonus     int;
  v_credit    int;
  v_freeUsed  int;
  v_fpUsed    int := 0;
  v_freeLeft  int;
  v_fpLeft    int;
  v_useFree   int;
  v_useCred   int;
  v_useBonus  int;
  v_usePurch  int;
  v_capped    boolean := false;
  v_refBonus  int;
  v_refPurch  int;
begin
  if v_uid is null then raise exception 'err.voteAuth'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'err.voteQty'; end if;

  -- Cổng Edge: khi đã bật, chỉ Worker (giữ token) mới vote được. Kẻ gọi thẳng
  -- PostgREST bằng anon key bị chặn ngay tại đây.
  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.voteGate'; end if;

  -- Chỉ nhận hash 64-hex thật; rác từ caller trở thành NULL (không hạn mức
  -- vân tay, giống cách spin_daily đang làm).
  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

  select r.status, r.picked_at into v_status, v_picked
    from public.requests r where r.id = p_request_id;
  if v_status is null then raise exception 'err.requestMissing'; end if;
  if v_status not in ('queued','in_progress') then raise exception 'err.voteClosed'; end if;
  -- Up next khoá vote cả hai chiều: số vote lúc chốt là con số làm việc.
  if v_picked is not null then raise exception 'err.voteLocked'; end if;

  -- ★ SỬA LỖI CHÍNH ★ Khoá hàng profiles TRƯỚC khi đọc hạn mức. Mọi lượt vote
  -- của cùng một tài khoản từ nay xếp hàng tuần tự, nên "đọc hạn mức → ghi"
  -- không còn đua nhau được. Thứ tự khoá giống spin_daily (profiles trước,
  -- advisory sau) để hai hàm không bao giờ deadlock lẫn nhau.
  select p.vote_credits, p.bonus_credits into v_purch, v_bonus
    from public.profiles p where p.id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  -- Cùng một vân tay từ NHIỀU tài khoản khác nhau thì row lock ở trên không
  -- xếp hàng được; advisory lock lo phần đó. Salt 3 để không đụng spin (1, 2).
  if p_fp_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_fp_hash, 3));
  end if;

  v_n     := abs(p_delta);
  v_day   := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_credit := v_purch + v_bonus;

  if p_delta < 0 then
    ------------------------------------------------------------------
    -- Rút lại v_n vote gần nhất của chính mình
    ------------------------------------------------------------------
    select count(*) into v_mine from public.votes
     where request_id = p_request_id and user_id = v_uid;
    if v_mine < v_n then raise exception 'err.notVoted'; end if;

    with doomed as (
      select id, credit_kind, used_credit from public.votes
       where request_id = p_request_id and user_id = v_uid
       order by created_at desc, id desc
       limit v_n
    ), gone as (
      delete from public.votes v using doomed d where v.id = d.id
      returning v.credit_kind, v.used_credit
    )
    select
      count(*) filter (where credit_kind = 'bonus'),
      -- Dòng cũ (trước migration này) không có credit_kind: hoàn về ví đã mua
      -- như hành vi cũ, không đoán bừa.
      count(*) filter (where credit_kind = 'purchased'
                          or (credit_kind is null and used_credit))
      into v_refBonus, v_refPurch
    from gone;

    -- ★ SỬA LỖI RỬA BONUS ★ hoàn đúng ví: bonus về bonus (vẫn reset 31/10),
    -- vote đã mua về vote đã mua.
    if coalesce(v_refBonus, 0) > 0 or coalesce(v_refPurch, 0) > 0 then
      update public.profiles
         set bonus_credits = bonus_credits + coalesce(v_refBonus, 0),
             vote_credits  = vote_credits  + coalesce(v_refPurch, 0)
       where id = v_uid;
    end if;

    update public.requests r set votes = greatest(r.votes - v_n, 0), updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  else
    ------------------------------------------------------------------
    -- Thêm v_n vote: miễn phí trước, hết thì bonus, hết nữa mới tới vote đã mua
    ------------------------------------------------------------------
    select count(*)::int into v_freeUsed from public.votes
     where user_id = v_uid and used_credit = false and vote_day = v_day;
    v_freeLeft := greatest(3 - v_freeUsed, 0);

    -- Hạn mức vân tay: đếm CHUNG mọi tài khoản. Đổi tài khoản trên cùng một
    -- trình duyệt vẫn chỉ 3 vote miễn phí/ngày.
    v_fpLeft := v_freeLeft;
    if p_fp_hash is not null then
      select count(*)::int into v_fpUsed from public.votes
       where fp_hash = p_fp_hash and used_credit = false and vote_day = v_day;
      v_fpLeft := greatest(3 - v_fpUsed, 0);
      if v_fpLeft < v_freeLeft then v_capped := true; end if;
    end if;

    v_useFree := least(v_n, v_freeLeft, v_fpLeft);
    v_useCred := v_n - v_useFree;

    if v_useCred > v_credit then
      -- Nói đúng lý do: hết lượt vì trình duyệt này đã dùng hết (nhiều tài
      -- khoản chung một máy), hay đơn giản là hết vote.
      if v_capped and v_useCred > 0 then
        raise exception 'err.voteFpLimit' using detail = v_fpLeft::text;
      end if;
      raise exception 'err.notEnoughVotes' using detail = (v_freeLeft + v_credit)::text;
    end if;

    v_useBonus := least(v_useCred, v_bonus);
    v_usePurch := v_useCred - v_useBonus;

    if v_useCred > 0 then
      update public.profiles
         set bonus_credits = bonus_credits - v_useBonus,
             vote_credits  = vote_credits  - v_usePurch
       where id = v_uid;
    end if;

    insert into public.votes (
      request_id, user_id, used_credit, credit_kind,
      vote_day, free_slot, fp_slot, fp_hash, ip_hash
    )
    select
      p_request_id, v_uid, g.i > v_useFree,
      case when g.i <= v_useFree                then 'free'
           when g.i <= v_useFree + v_useBonus   then 'bonus'
           else 'purchased' end,
      v_day,
      case when g.i <= v_useFree then (v_freeUsed + g.i)::smallint end,
      case when g.i <= v_useFree and p_fp_hash is not null
           then (v_fpUsed + g.i)::smallint end,
      p_fp_hash, p_ip_hash
    from generate_series(1, v_n) as g(i);

    update public.requests r set votes = r.votes + v_n, updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  end if;

  select count(*)::int into v_mine from public.votes
   where request_id = p_request_id and user_id = v_uid;
  select s.free_used, s.credits into v_freeUsed, v_credit from public.my_vote_status() s;
  return query select v_new, v_mine, v_freeUsed, v_credit;
end $$;

-- =========================================================
-- 5. XOÁ REQUEST — không đốt vote của người khác
-- =========================================================
create or replace function public.delete_my_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text; v_owner uuid; v_picked timestamptz; v_others int;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select user_id, status, picked_at into v_owner, v_status, v_picked
    from public.requests where id = p_id;
  if v_owner is null then raise exception 'err.requestMissing'; end if;

  if public.is_admin() then
    delete from public.requests where id = p_id;
    return;
  end if;

  if v_owner <> v_uid then raise exception 'err.notOwner'; end if;
  if v_status in ('in_progress','completed') then raise exception 'err.deleteLocked'; end if;
  -- hàng đã chốt Up next thì khoá cả xoá (user tự xoá làm vỡ kế hoạch làm việc)
  if v_picked is not null then raise exception 'err.deleteLocked'; end if;

  -- Người khác đã bỏ vote (có thể là vote MUA BẰNG TIỀN) thì chủ request không
  -- được xoá: xoá là cascade mất sạch vote đó và không ai được hoàn.
  select count(*)::int into v_others from public.votes
   where request_id = p_id and user_id <> v_uid;
  if v_others > 0 then
    raise exception 'err.deleteVoted' using detail = v_others::text;
  end if;

  delete from public.requests where id = p_id;
end $$;

-- =========================================================
-- 6. RECOUNT — dựng lại requests.votes từ bảng votes
-- =========================================================
-- Chạy sau khi xoá vote gian lận hoặc xoá tài khoản (cascade xoá votes nhưng
-- KHÔNG trừ bộ đếm requests.votes).
--   select public.recount_request_votes();
create or replace function public.recount_request_votes()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with dung as (
    select r.id, coalesce(count(v.id), 0)::int as thuc_te
      from public.requests r
      left join public.votes v on v.request_id = r.id
     group by r.id
  )
  update public.requests r
     set votes = d.thuc_te, updated_at = now()
    from dung d
   where d.id = r.id and r.votes <> d.thuc_te;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.recount_request_votes() from public, anon, authenticated;
grant execute on function public.recount_request_votes() to service_role;

-- =========================================================
-- 7. ADMIN_ORDER — duyệt một lần là một lần
-- =========================================================
create or replace function public.admin_order(p_order_id uuid, p_approve boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  -- ★ Chỉ đơn đang chờ mới xử lý được: bấm "Đã nhận" hai lần không còn cộng
  -- credit hai lần (trước đây update không lọc theo trạng thái hiện tại).
  update public.orders set status = case when p_approve then 'paid' else 'rejected' end
   where id = p_order_id and status = 'awaiting'
  returning * into o;

  if o.id is null then
    if exists (select 1 from public.orders where id = p_order_id) then
      raise exception 'err.orderLocked';
    end if;
    raise exception 'err.orderMissing';
  end if;

  if p_approve then
    if o.kind = 'votes' then
      update public.profiles set vote_credits = vote_credits + o.qty where id = o.user_id;
    elsif o.kind = 'paid_request' and o.request_id is not null then
      update public.requests
         set status = 'queued', payment_status = 'paid', updated_at = now()
       where id = o.request_id;
    end if;
  else
    if o.kind = 'paid_request' and o.request_id is not null then
      update public.requests set payment_status = 'none' where id = o.request_id;
    end if;
  end if;

  return o;
end $$;

-- =========================================================
-- 8. CREATE_REQUEST — paid request không còn là cửa spam
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

  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests
     where user_id = v_uid and is_paid = false
       and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then
      -- key i18n + số qua DETAIL, thay cho câu tiếng Anh cứng trước đây
      raise exception 'err.rateLimit' using detail = '3';
    end if;
  else
    -- ★ Paid request trước đây KHÔNG bị giới hạn gì: một script tạo được hàng
    -- nghìn request pending + đơn hàng awaiting, làm ngập bảng Admin. Nay tối
    -- đa 5 đơn paid đang chờ thanh toán; trả tiền hoặc huỷ bớt là gửi tiếp.
    select count(*) into v_cnt from public.orders
     where user_id = v_uid and kind = 'paid_request' and status = 'awaiting';
    if v_cnt >= 5 then
      raise exception 'err.paidPending' using detail = '5';
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

  if p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id)
    values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;

  return r;
end $$;

-- =========================================================
-- 9. SPIN_DAILY — thêm cổng Edge (nội dung còn lại giữ nguyên 20261102)
-- =========================================================
-- Thêm tham số thứ 6 nên phải bỏ bản 5 tham số (tránh 300 ambiguous).
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

-- =========================================================
-- 10. QUYỀN — chữ ký mới, quy tắc cũ: chỉ người đã đăng nhập
-- =========================================================
revoke all on function public.cast_vote(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid, int, text, text, text) to authenticated;

revoke all on function public.spin_daily(text, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text, text) to authenticated;

revoke all on function public.my_vote_status() from public, anon, authenticated;
grant execute on function public.my_vote_status() to authenticated;

grant execute on function public.delete_my_request(uuid) to authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean) to authenticated;
grant execute on function public.admin_order(uuid,boolean) to authenticated;

commit;

-- PostgREST giữ schema cache cũ một lúc sau khi đổi chữ ký hàm.
notify pgrst, 'reload schema';

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
-- Color Coded Lyrics — security audit hardening (2026-09-22)
--
-- Additive and rerunnable. This migration closes the reward-RPC privilege
-- escalation, makes achievement rewards server-authoritative and idempotent,
-- consumes free paid-request rewards atomically, validates avatar URLs, fixes
-- reply ownership checks, and adds a small server-side comment rate limit.
-- No user-data table is dropped or truncated.

begin;

-- =========================================================
-- 1. PROFILE LEAST PRIVILEGE + AVATAR VALIDATION
-- =========================================================
-- `is_admin` is a server-side permission flag, not public profile data. The
-- client now asks the is_admin() RPC for the current user's own role.
revoke select on public.profiles from anon, authenticated;
grant select (id, name, avatar_url) on public.profiles to anon, authenticated;

alter table public.profiles
  add column if not exists bonus_requests int not null default 0;
update public.profiles set bonus_credits = 0 where bonus_credits < 0;
update public.profiles set bonus_requests = 0 where bonus_requests < 0;
alter table public.profiles
  drop constraint if exists profiles_bonus_credits_nonneg;
alter table public.profiles
  add constraint profiles_bonus_credits_nonneg check (bonus_credits >= 0);
alter table public.profiles
  drop constraint if exists profiles_bonus_requests_nonneg;
alter table public.profiles
  add constraint profiles_bonus_requests_nonneg check (bonus_requests >= 0);

create or replace function public.update_my_profile(p_name text, p_avatar text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  pr public.profiles;
begin
  if v_uid is null then raise exception 'err.signin'; end if;

  v_name := left(btrim(coalesce(p_name,'')), 40);
  if length(v_name) < 2 then raise exception 'err.nameShort'; end if;

  -- Only Google/Cloudinary HTTPS URLs or our own processed base64 raster
  -- images are accepted. SVG/HTML/javascript/data URLs cannot be stored.
  if p_avatar is not null and
     p_avatar !~* '^https://([a-z0-9-]+\.)*(googleusercontent\.com|cloudinary\.com)/' and
     p_avatar !~* '^data:image/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$' then
    raise exception 'err.avatarType';
  end if;
  if p_avatar is not null and length(p_avatar) > 200000 then
    raise exception 'err.avatarBig';
  end if;

  update public.profiles
     set name = v_name, avatar_url = p_avatar
   where id = v_uid
  returning * into pr;

  if pr.id is null then raise exception 'err.signin'; end if;
  update public.requests set requester = v_name where user_id = v_uid;
  return pr;
end $$;

revoke all on function public.update_my_profile(text,text) from public, anon, authenticated;
grant execute on function public.update_my_profile(text,text) to authenticated;

-- Keep admin progress input within the invariant used by the UI and reports.
update public.requests set progress = greatest(0, least(100, progress)) where progress < 0 or progress > 100;
alter table public.requests drop constraint if exists requests_progress_range;
alter table public.requests add constraint requests_progress_range check (progress between 0 and 100);

-- =========================================================
-- 2. ACTIVITY PRIVACY: OWNER RAW DAYS, PUBLIC AGGREGATES
-- =========================================================
-- Public profiles need streak totals, not the exact calendar of another user.
-- Keep raw dates for the owner/achievement engine and expose only aggregates.
drop policy if exists "read activity days" on public.activity_days;
drop policy if exists "read own activity days" on public.activity_days;
create policy "read own activity days" on public.activity_days
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke select on public.activity_days from anon, authenticated;
grant select on public.activity_days to authenticated;

create or replace function public.public_streak(p_user_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_latest date;
  v_current int := 0;
  v_longest int := 0;
  v_earned jsonb;
begin
  if p_user_id is null then return jsonb_build_object('current', 0, 'longest', 0, 'earned', '[]'::jsonb); end if;
  select max(day) into v_latest from public.activity_days where user_id = p_user_id;

  select coalesce(max(run_len), 0)::int into v_longest
    from (
      select count(*)::int as run_len
        from (
          select day, day - (row_number() over (order by day))::int as grp
            from public.activity_days where user_id = p_user_id
        ) grouped
       group by grp
    ) runs;

  if v_latest is not null and v_latest >= v_today - 1 then
    select count(*)::int into v_current
      from (
        select day, day + (row_number() over (order by day desc))::int as grp
          from public.activity_days where user_id = p_user_id
      ) tail
     where grp = v_latest + 1;
  end if;

  select coalesce(jsonb_agg(m order by m), '[]'::jsonb) into v_earned
    from unnest(array[7, 30, 100]) as m where m <= v_longest;
  return jsonb_build_object('current', v_current, 'longest', v_longest, 'earned', v_earned);
end $$;
revoke all on function public.public_streak(uuid) from public, anon, authenticated;
grant execute on function public.public_streak(uuid) to anon, authenticated;

-- =========================================================
-- 3. COMMENTS: SAME-REQUEST REPLIES + ANTI-SPAM
-- =========================================================
-- The old unqualified `request_id = request_id` was tautological inside the
-- subquery. Qualify the outer table so a reply cannot attach across requests.
drop policy if exists request_comments_authenticated_insert on public.request_comments;
create policy request_comments_authenticated_insert
  on public.request_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      parent_id is null
      or exists (
        select 1 from public.request_comments p
         where p.id = request_comments.parent_id
           and p.request_id = request_comments.request_id
      )
    )
  );

create or replace function public.enforce_comment_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The RLS policy remains the authority for identity. This lock only makes
  -- count-then-insert deterministic across several tabs of one account.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 20260922));
  if (
    select count(*) from public.request_comments
     where user_id = new.user_id
       and created_at >= now() - interval '1 minute'
  ) >= 10 then
    raise exception 'err.commentRate';
  end if;
  if new.parent_id is not null and not exists (
    select 1 from public.request_comments p
     where p.id = new.parent_id and p.request_id = new.request_id
  ) then
    raise exception 'err.commentParent';
  end if;
  return new;
end $$;

revoke all on function public.enforce_comment_limits() from public, anon, authenticated;
drop trigger if exists request_comments_limits on public.request_comments;
create trigger request_comments_limits
  before insert on public.request_comments
  for each row execute function public.enforce_comment_limits();

-- At most five parsed mentions per comment prevents a short message from
-- becoming a notification fan-out attack.
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests;
  v_parent public.request_comments;
  v_author text;
  v_mentioned record;
  v_mentions int := 0;
begin
  select name into v_author from public.profiles where id = NEW.user_id;
  v_author := coalesce(v_author, 'Member');
  select * into v_req from public.requests where id = NEW.request_id;

  if NEW.parent_id is null then
    if v_req.user_id is not null and v_req.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (v_req.user_id, public.song_key(v_req.artist, v_req.title), 'comment',
              v_req.id, v_req.title, v_req.artist,
              v_author || ': ' || left(NEW.body, 120), 'comment|' || NEW.id::text)
      on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  else
    select * into v_parent from public.request_comments where id = NEW.parent_id;
    if v_parent.user_id is not null and v_parent.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (v_parent.user_id, public.song_key(v_req.artist, v_req.title), 'reply',
              v_req.id, v_req.title, v_req.artist,
              v_author || ' replied: ' || left(NEW.body, 120), 'reply|' || NEW.id::text)
      on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  end if;

  for v_mentioned in
    select id, name from public.profiles
     where id <> NEW.user_id
       and (
         position('@' || lower(name) in lower(NEW.body)) > 0
         or position('@' || lower(replace(name, ' ', '')) in lower(NEW.body)) > 0
       )
     order by id
     limit 5
  loop
    v_mentions := v_mentions + 1;
    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (v_mentioned.id, public.song_key(v_req.artist, v_req.title), 'mention',
            v_req.id, v_req.title, v_req.artist,
            v_author || ' mentioned you: ' || left(NEW.body, 120),
            'mention|' || NEW.id::text || '|' || v_mentioned.id::text)
    on conflict (user_id, sig) where sig is not null do nothing;
  end loop;
  return NEW;
end $$;

revoke all on function public.notify_on_comment() from public, anon, authenticated;
drop trigger if exists tr_notify_on_comment on public.request_comments;
create trigger tr_notify_on_comment after insert on public.request_comments
  for each row execute function public.notify_on_comment();

-- =========================================================
-- 3. SEASON REWARD PRIVILEGE ESCALATION
-- =========================================================
-- A normal authenticated user used to be able to call this low-level helper
-- directly with an arbitrary user_id and amount. Only the trusted scheduler
-- may call it; the public admin entry point remains settle_current_season_rewards.
create or replace function public.grant_season_reward(
  p_user_id text,
  p_bonus_votes int default 0,
  p_bonus_requests int default 0,
  p_title text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  if coalesce(p_bonus_votes, 0) < 0 or coalesce(p_bonus_requests, 0) < 0
     or coalesce(p_bonus_votes, 0) > 1000 or coalesce(p_bonus_requests, 0) > 100 then
    raise exception 'err.rewardInvalid';
  end if;
  v_target := p_user_id::uuid;

  update public.profiles
     set bonus_credits = bonus_credits + coalesce(p_bonus_votes, 0),
         bonus_requests = bonus_requests + coalesce(p_bonus_requests, 0)
   where id = v_target;
  if not found then raise exception 'err.requestMissing'; end if;

  if coalesce(p_bonus_votes, 0) > 0 or coalesce(p_bonus_requests, 0) > 0 then
    insert into public.notifications(user_id, song_key, kind, title, reason, sig)
    values (
      v_target, 'season-reward', 'votes', 'Season Reward: ' || coalesce(p_title, 'Top Rank'),
      'You earned ' || coalesce(p_bonus_votes, 0) || ' bonus votes' ||
        case when coalesce(p_bonus_requests, 0) > 0
             then ' and ' || p_bonus_requests || ' bonus request!' else '!' end,
      'reward|' || v_target::text || '|' || coalesce(p_title, 'Top Rank')
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end if;
end $$;

revoke all on function public.grant_season_reward(text,int,int,text) from public, anon, authenticated;
grant execute on function public.grant_season_reward(text,int,int,text) to service_role;

create table if not exists public.season_rewards_log (
  id uuid primary key default gen_random_uuid(),
  season_type text not null check (season_type in ('week', 'month')),
  period_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null check (rank between 1 and 3),
  bonus_votes int not null default 0 check (bonus_votes >= 0),
  bonus_requests int not null default 0 check (bonus_requests >= 0),
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

create or replace function public.settle_season_rewards(
  p_season_type text, p_period_key text,
  p_start timestamptz, p_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_winners record;
  v_rank int := 1;
  v_votes int;
  v_reqs int;
  v_title text;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  if p_season_type not in ('week', 'month') or p_start is null or p_end is null or p_start >= p_end then
    raise exception 'err.rewardPeriod';
  end if;

  for v_winners in (
    select r.user_id,
      count(*) filter (where r.status = 'completed') as completed_count,
      coalesce(sum(r.votes), 0) as total_votes,
      count(*) as total_submitted,
      min(r.created_at) as earliest_request
      from public.requests r
     where r.user_id is not null and r.status <> 'denied'
       and ((r.status = 'completed' and coalesce(r.updated_at, r.created_at) >= p_start
             and coalesce(r.updated_at, r.created_at) < p_end)
         or (r.created_at >= p_start and r.created_at < p_end))
     group by r.user_id
     order by completed_count desc, total_votes desc, total_submitted desc,
              earliest_request asc, r.user_id asc
     limit 3
  ) loop
    if p_season_type = 'week' then
      if v_rank = 1 then v_votes := 15; v_reqs := 0; v_title := 'Weekly #1 Winner';
      elsif v_rank = 2 then v_votes := 10; v_reqs := 0; v_title := 'Weekly #2 Winner';
      else v_votes := 5; v_reqs := 0; v_title := 'Weekly #3 Winner'; end if;
    else
      if v_rank = 1 then v_votes := 50; v_reqs := 1; v_title := 'Monthly Champion';
      elsif v_rank = 2 then v_votes := 30; v_reqs := 0; v_title := 'Monthly Runner-up';
      else v_votes := 20; v_reqs := 0; v_title := 'Monthly #3 Winner'; end if;
    end if;

    insert into public.season_rewards_log
      (season_type, period_key, user_id, rank, bonus_votes, bonus_requests, title)
    values (p_season_type, p_period_key, v_winners.user_id, v_rank,
            v_votes, v_reqs, v_title)
    on conflict on constraint uq_season_rewards_rank do nothing;
    if found then
      perform public.grant_season_reward(v_winners.user_id::text, v_votes, v_reqs, v_title);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rank', v_rank, 'user_id', v_winners.user_id,
        'bonus_votes', v_votes, 'bonus_requests', v_reqs, 'title', v_title));
    end if;
    v_rank := v_rank + 1;
  end loop;
  return v_results;
end $$;

revoke all on function public.settle_season_rewards(text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_season_rewards(text,text,timestamptz,timestamptz)
  to service_role;

create or replace function public.settle_current_season_rewards(p_season_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now_vn timestamp := timezone('Asia/Ho_Chi_Minh', now());
  v_key text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  if p_season_type = 'week' then
    v_key := to_char(v_now_vn, 'IYYY-"W"IW');
    v_start := (date_trunc('week', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '7 days';
  elsif p_season_type = 'month' then
    v_key := to_char(v_now_vn, 'YYYY-MM');
    v_start := (date_trunc('month', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '1 month';
  else
    raise exception 'err.rewardPeriod';
  end if;
  return public.settle_season_rewards(p_season_type, v_key, v_start, v_end);
end $$;

revoke all on function public.settle_current_season_rewards(text)
  from public, anon, authenticated;
grant execute on function public.settle_current_season_rewards(text) to authenticated, service_role;

-- =========================================================
-- 4. PAYMENT ORDER QUEUE CAP
-- =========================================================
-- Payment is manual (there is no webhook in this repository). Keep the order
-- endpoint from being used to flood the admin queue, and serialize the count.
create or replace function public.buy_votes(p_pack text, p_qty int, p_usd numeric, p_vnd int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_waiting int;
  o public.orders;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_qty <= 0 or p_qty > 100 then raise exception 'err.qty'; end if;
  if not (
    (p_pack = 'v3' and p_qty = 3 and p_usd = 0.49 and p_vnd = 13000) or
    (p_pack = 'v10' and p_qty = 10 and p_usd = 1.29 and p_vnd = 34000) or
    (p_pack = 'v30' and p_qty = 30 and p_usd = 2.99 and p_vnd = 78000) or
    (p_pack = 'custom' and p_usd = round(0.19 * p_qty, 2) and p_vnd = 5000 * p_qty)
  ) then raise exception 'err.priceChanged'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 20260924));
  select count(*) into v_waiting from public.orders
   where user_id = v_uid and kind = 'votes' and status = 'awaiting';
  if v_waiting >= 20 then raise exception 'err.orderQueueLimit'; end if;

  insert into public.orders (user_id, kind, pack, qty, amount_usd, amount_vnd)
  values (v_uid, 'votes', left(p_pack, 40), p_qty, p_usd, p_vnd)
  returning * into o;
  return o;
end $$;

revoke all on function public.buy_votes(text,int,numeric,int) from public, anon, authenticated;
grant execute on function public.buy_votes(text,int,numeric,int) to authenticated;

-- =========================================================
-- 5. SERVER-AUTHORITATIVE ACHIEVEMENT REWARDS
-- =========================================================
create table if not exists public.achievement_definitions (
  id             text primary key check (id ~ '^[A-Za-z][A-Za-z0-9_]{1,63}$'),
  source         text not null check (source in ('streak','requests','completed','paid','votes','leaderboard')),
  threshold      int not null check (threshold > 0),
  bonus_votes    int not null default 0 check (bonus_votes between 0 and 1000),
  bonus_requests int not null default 0 check (bonus_requests between 0 and 100),
  badge          text not null,
  active         boolean not null default true
);

create table if not exists public.achievement_rewards (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievement_definitions(id),
  bonus_votes    int not null check (bonus_votes >= 0),
  bonus_requests int not null check (bonus_requests >= 0),
  badge          text not null,
  granted_at     timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
create index if not exists achievement_rewards_user_idx
  on public.achievement_rewards (user_id, granted_at desc);

alter table public.achievement_definitions enable row level security;
alter table public.achievement_rewards enable row level security;
drop policy if exists achievement_definitions_read on public.achievement_definitions;
create policy achievement_definitions_read on public.achievement_definitions
  for select using (true);
drop policy if exists achievement_rewards_read on public.achievement_rewards;
create policy achievement_rewards_read on public.achievement_rewards
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.achievement_definitions from public, anon, authenticated;
revoke insert, update, delete on public.achievement_rewards from public, anon, authenticated;
grant select on public.achievement_definitions to anon, authenticated;
grant select on public.achievement_rewards to authenticated;

insert into public.achievement_definitions
  (id, source, threshold, bonus_votes, bonus_requests, badge)
values
  ('streak3', 'streak', 3, 1, 0, 'streak3'),
  ('streak7', 'streak', 7, 3, 0, 'streak7'),
  ('streak14', 'streak', 14, 5, 0, 'streak14'),
  ('streak30', 'streak', 30, 10, 0, 'streak30'),
  ('streak60', 'streak', 60, 20, 0, 'streak60'),
  ('streak100', 'streak', 100, 35, 0, 'streak100'),
  ('streak180', 'streak', 180, 50, 0, 'streak180'),
  ('streak365', 'streak', 365, 100, 0, 'streak365'),
  ('firstRequest', 'requests', 1, 1, 0, 'firstRequest'),
  ('request3', 'requests', 3, 2, 0, 'request3'),
  ('request5', 'requests', 5, 3, 0, 'request5'),
  ('request10', 'requests', 10, 5, 0, 'request10'),
  ('request25', 'requests', 25, 10, 0, 'request25'),
  ('request50', 'requests', 50, 20, 0, 'request50'),
  ('request100', 'requests', 100, 35, 0, 'request100'),
  ('request250', 'requests', 250, 50, 0, 'request250'),
  ('firstCompletion', 'completed', 1, 0, 1, 'firstCompletion'),
  ('completion3', 'completed', 3, 3, 0, 'completion3'),
  ('completion5', 'completed', 5, 0, 1, 'completion5'),
  ('completion10', 'completed', 10, 10, 0, 'completion10'),
  ('completion25', 'completed', 25, 0, 2, 'completion25'),
  ('completion50', 'completed', 50, 30, 0, 'completion50'),
  ('completion100', 'completed', 100, 0, 3, 'completion100'),
  ('firstPaidRequest', 'paid', 1, 0, 1, 'firstPaidRequest'),
  ('paid3', 'paid', 3, 0, 1, 'paid3'),
  ('paid5', 'paid', 5, 0, 2, 'paid5'),
  ('paid10', 'paid', 10, 0, 2, 'paid10'),
  ('paid25', 'paid', 25, 0, 3, 'paid25'),
  ('paid50', 'paid', 50, 0, 5, 'paid50'),
  ('votesCast1', 'votes', 1, 1, 0, 'votesCast1'),
  ('votesCast10', 'votes', 10, 3, 0, 'votesCast10'),
  ('votesCast25', 'votes', 25, 5, 0, 'votesCast25'),
  ('votesCast50', 'votes', 50, 10, 0, 'votesCast50'),
  ('votesCast100', 'votes', 100, 20, 0, 'votesCast100'),
  ('votesCast250', 'votes', 250, 35, 0, 'votesCast250'),
  ('votesCast500', 'votes', 500, 50, 0, 'votesCast500'),
  ('votesCast1000', 'votes', 1000, 0, 2, 'votesCast1000'),
  ('top10', 'leaderboard', 10, 10, 0, 'top10'),
  ('top5', 'leaderboard', 5, 20, 0, 'top5'),
  ('podium', 'leaderboard', 3, 0, 1, 'podium'),
  ('runnerUp', 'leaderboard', 2, 30, 0, 'runnerUp'),
  ('champion', 'leaderboard', 1, 0, 3, 'champion')
on conflict (id) do update set
  source = excluded.source,
  threshold = excluded.threshold,
  bonus_votes = excluded.bonus_votes,
  bonus_requests = excluded.bonus_requests,
  badge = excluded.badge,
  active = true;

create or replace function public.claim_achievements()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_streak int := 0;
  v_requests int := 0;
  v_completed int := 0;
  v_paid int := 0;
  v_votes int := 0;
  v_rank int;
  v_progress int;
  v_earned boolean;
  v_inserted boolean;
  d record;
  v_new jsonb := '[]'::jsonb;
  p public.profiles;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select * into p from public.profiles where id = v_uid for update;
  if p.id is null then raise exception 'err.signin'; end if;

  select coalesce(max(run_len), 0)::int into v_streak
    from (
      select count(*)::int as run_len
        from (
          select day, day - (row_number() over (order by day))::int as grp
            from public.activity_days where user_id = v_uid
        ) runs
       group by grp
    ) grouped_runs;

  select count(*)::int,
         count(*) filter (where status = 'completed')::int,
         count(*) filter (where is_paid)::int
    into v_requests, v_completed, v_paid
    from public.requests where user_id = v_uid and status <> 'denied';
  select count(*)::int into v_votes from public.votes where user_id = v_uid;

  with scores as (
    select user_id, count(*)::int as total,
           coalesce(sum(votes), 0)::int as total_votes
      from public.requests
     where status <> 'denied'
     group by user_id
  ), me as (
    select * from scores where user_id = v_uid
  )
  select case when me.user_id is null then null else
    (1 + count(*) filter (
      where s.total > me.total
         or (s.total = me.total and s.total_votes > me.total_votes)
         or (s.total = me.total and s.total_votes = me.total_votes
             and s.user_id::text < me.user_id::text)
    ))::int end
    into v_rank
    from scores s cross join me
   group by me.user_id, me.total, me.total_votes;

  for d in select * from public.achievement_definitions where active order by id loop
    v_progress := case d.source
      when 'streak' then v_streak
      when 'requests' then v_requests
      when 'completed' then v_completed
      when 'paid' then v_paid
      when 'votes' then v_votes
      when 'leaderboard' then coalesce(v_rank, 0)
      else 0 end;
    v_earned := case when d.source = 'leaderboard'
      then v_rank is not null and v_rank <= d.threshold
      else v_progress >= d.threshold end;

    if v_earned then
      insert into public.achievement_rewards
        (user_id, achievement_id, bonus_votes, bonus_requests, badge)
      values (v_uid, d.id, d.bonus_votes, d.bonus_requests, d.badge)
      on conflict (user_id, achievement_id) do nothing;
      v_inserted := found;
      if v_inserted then
        update public.profiles
           set bonus_credits = bonus_credits + d.bonus_votes,
               bonus_requests = bonus_requests + d.bonus_requests
         where id = v_uid;
      end if;
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', d.id, 'progress', v_progress, 'need', d.threshold,
        'badge', d.badge, 'bonus_votes', d.bonus_votes,
        'bonus_requests', d.bonus_requests, 'newly_granted', v_inserted
      ));
    end if;
  end loop;

  select * into p from public.profiles where id = v_uid;
  return jsonb_build_object(
    'earned', v_new,
    'bonus_credits', p.bonus_credits,
    'purchased', p.vote_credits,
    'credits', p.vote_credits + p.bonus_credits,
    'bonus_requests', p.bonus_requests
  );
end $$;

revoke all on function public.claim_achievements() from public, anon, authenticated;
grant execute on function public.claim_achievements() to authenticated;

-- =========================================================
-- 5. FREE PAID REQUEST REDEMPTION (ATOMIC)
-- =========================================================
drop function if exists public.create_request(text,text,text,text,text,boolean);
create or replace function public.create_request(
  p_kind text, p_artist text, p_title text,
  p_link text, p_note text, p_paid boolean default false,
  p_use_bonus boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_cnt int;
  v_bonus_requests int;
  r public.requests;
begin
  if v_uid is null then raise exception 'err.requestAuth'; end if;
  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'err.needFields';
  end if;
  if coalesce(p_use_bonus, false) and not coalesce(p_paid, false) then
    raise exception 'err.rewardType';
  end if;

  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests
     where user_id = v_uid and is_paid = false
       and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then raise exception 'err.rateLimit' using detail = '3'; end if;
  elsif not coalesce(p_use_bonus, false) then
    select count(*) into v_cnt from public.orders
     where user_id = v_uid and kind = 'paid_request' and status = 'awaiting';
    if v_cnt >= 5 then raise exception 'err.paidPending' using detail = '5'; end if;
  end if;

  select name, bonus_requests into v_name, v_bonus_requests
    from public.profiles where id = v_uid for update;
  if v_name is null then raise exception 'err.requestAuth'; end if;
  if coalesce(p_use_bonus, false) and coalesce(v_bonus_requests, 0) < 1 then
    raise exception 'err.noBonusRequest';
  end if;

  insert into public.requests (user_id, kind, artist, title, link, note, requester,
                               is_paid, payment_status, status)
  values (
    v_uid,
    coalesce(nullif(p_kind,''), 'Color Coded Lyrics'),
    left(trim(p_artist),120), left(trim(p_title),160),
    left(coalesce(p_link,''),500), left(coalesce(p_note,''),500),
    coalesce(v_name,'Anonymous'), coalesce(p_paid,false),
    case when p_use_bonus then 'paid' when p_paid then 'awaiting' else 'none' end,
    case when p_use_bonus then 'queued' else 'pending' end
  ) returning * into r;

  if p_use_bonus then
    update public.profiles
       set bonus_requests = bonus_requests - 1
     where id = v_uid and bonus_requests > 0;
    if not found then raise exception 'err.noBonusRequest'; end if;
  elsif p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id)
    values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;
  return r;
end $$;

revoke all on function public.create_request(text,text,text,text,text,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean,boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;

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

-- =========================================================
-- BEGIN FUNNEL EVENTS: mirror 20261110_funnel_events.sql
-- =========================================================
-- Funnel events — số liệu đường đi của người dùng ("metric, not vibes").
-- Follows 20261109_activity_visit.sql. Rerunnable. Kỷ luật free-tier:
--   · ghi thẳng Postgres qua RPC — KHÔNG đi qua Workers KV (trần 1.000 ghi/ngày
--     của KV đang nằm ngay trên đường vote, không được đụng thêm);
--   · KHÔNG thêm cron: RPC tự quét dòng > 30 ngày, tối đa MỘT lần mỗi ngày
--     (cờ 'funnel_purge' trong settings) — index created_at giữ cú quét rẻ;
--   · meta ≤ 512 byte, TUYỆT ĐỐI không IP/fingerprint/định danh thiết bị —
--     đây là bảng sản phẩm, không phải bảng truy vết (xem privacy.html).
begin;

create table if not exists public.funnel_events (
  id         bigint generated always as identity primary key,
  event      text not null check (char_length(event) between 1 and 32),
  user_id    uuid references public.profiles (id) on delete set null,
  meta       jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 512),
  created_at timestamptz not null default now()
);

create index if not exists funnel_events_created_idx on public.funnel_events (created_at);
create index if not exists funnel_events_event_created_idx on public.funnel_events (event, created_at);

alter table public.funnel_events enable row level security;

-- Chỉ hai đường đi: GHI qua track_funnel() (người đã đăng nhập), ĐỌC qua
-- funnel_summary() (admin). Không ai đọc/sửa/xoá trực tiếp — kể cả người ghi.
revoke all on public.funnel_events from public, anon, authenticated;

create or replace function public.track_funnel(p_event text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_last  date;
  v_event text := nullif(btrim(coalesce(p_event, '')), '');
  v_meta  jsonb := case when p_meta is null or pg_column_size(p_meta) > 512
                        then '{}'::jsonb else p_meta end;
begin
  if auth.uid() is null then
    raise exception 'err.signin';
  end if;
  if v_event is null or length(v_event) > 32 then
    raise exception 'err.funnelEvent';
  end if;

  insert into public.funnel_events (event, user_id, meta)
  values (v_event, auth.uid(), v_meta);

  -- Tu dọn: ai ghi sự kiện đầu tiên của ngày sẽ quét dòng cũ hơn 30 ngày.
  -- Một dòng settings đánh dấu ngày quét gần nhất — không cần cron, không cần
  -- thêm khoá ghi nào ngoài một lần insert settings/ngày.
  select (value #>> '{}')::date into v_last
    from public.settings where key = 'funnel_purge';
  if v_last is null or v_last < v_today then
    delete from public.funnel_events where created_at < now() - interval '30 days';
    insert into public.settings (key, value)
    values ('funnel_purge', to_jsonb(v_today))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

revoke all on function public.track_funnel(text, jsonb) from public, anon;
grant execute on function public.track_funnel(text, jsonb) to authenticated;

-- Tổng hợp cho admin: đếm theo sự kiện theo ngày, mặc định 7 ngày gần nhất.
create or replace function public.funnel_summary(p_days int default 7)
returns table (day date, event text, n bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  return query
    select (f.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
           f.event,
           count(*) as n
      from public.funnel_events f
     where f.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
     group by 1, 2
     order by 1 desc, 2;
end $$;

revoke all on function public.funnel_summary(int) from public, anon;
grant execute on function public.funnel_summary(int) to authenticated;

notify pgrst, 'reload schema';
commit;

-- BEGIN SHARED IP SPIN: mirror 20261111_shared_ip_spin.sql
-- Shared public IPs (mobile CGNAT, offices, schools) are not identities.
-- Keep IP hashes for auditing, while device/fingerprint/account limits remain enforced.
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

-- BEGIN DAILY REWARDS: mirror 20261112_daily_rewards.sql
-- Daily login (+2) and one 3-question music quiz (+1 per correct answer).
-- Run AFTER the existing bonus, activity and security migrations. Rerunnable:
-- no historical rewards are backfilled and existing attempts are preserved.
begin;

create table if not exists public.daily_login_rewards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_day date not null,
  reward int not null default 2 check (reward = 2),
  created_at timestamptz not null default now(),
  primary key (user_id, reward_day)
);

-- Neither the question bank nor attempt snapshots may be read from REST:
-- they contain correct answers. Only the sanitized RPC payload is public.
create table if not exists public.daily_quiz_questions (
  id text primary key,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option int not null check (correct_option between 0 and 3),
  explanation text not null,
  active boolean not null default true
);

create table if not exists public.daily_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quiz_day date not null,
  -- Freeze all question content at start, including private answers. Editing
  -- or retiring a bank question cannot change an already-started round.
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 3),
  answers int[],
  score int check (score between 0 and 3),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, quiz_day),
  constraint daily_quiz_completion check (
    (completed_at is null and answers is null and score is null)
    or (completed_at is not null and answers is not null and score is not null
        and cardinality(answers) = 3)
  )
);

alter table public.daily_login_rewards enable row level security;
alter table public.daily_quiz_questions enable row level security;
alter table public.daily_quiz_attempts enable row level security;
-- No browser policies: all reading/writing goes through owner-scoped RPCs.
revoke all on public.daily_login_rewards, public.daily_quiz_questions, public.daily_quiz_attempts
  from public, anon, authenticated;
grant all on public.daily_login_rewards, public.daily_quiz_questions, public.daily_quiz_attempts
  to service_role;

-- Answers use zero-based indices, matching the browser's option values.
-- ON CONFLICT preserves editorial changes and does not reactivate old entries.
insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation) values
  ('kpop-dynamite', 'Which group released "Dynamite"?', '["EXO","BTS","SEVENTEEN","SHINee"]', 1, 'BTS released the English-language single "Dynamite" in 2020.'),
  ('kpop-ddudu', 'Which group released "DDU-DU DDU-DU"?', '["BLACKPINK","TWICE","Red Velvet","ITZY"]', 0, '"DDU-DU DDU-DU" is a BLACKPINK single from the EP Square Up.'),
  ('kpop-gods-menu', 'Which group performs "God''s Menu"?', '["ATEEZ","NCT 127","Stray Kids","MONSTA X"]', 2, '"God''s Menu" is the title track of Stray Kids'' album GO LIVE.'),
  ('kpop-ditto', 'Which group released "Ditto"?', '["IVE","aespa","LE SSERAFIM","NewJeans"]', 3, 'NewJeans released "Ditto" in December 2022.'),
  ('kpop-super', 'Which group released "Super" on the album FML?', '["BTS","SEVENTEEN","EXO","TXT"]', 1, '"Super" is one of the title tracks on SEVENTEEN''s FML.'),
  ('kpop-cheer-up', 'Which group released "CHEER UP"?', '["TWICE","GFRIEND","MAMAMOO","Apink"]', 0, 'TWICE released "CHEER UP" as the title track of Page Two.'),
  ('kpop-love-shot', 'Which group released "Love Shot"?', '["SHINee","GOT7","EXO","NCT DREAM"]', 2, 'EXO released "Love Shot" in 2018.'),
  ('kpop-psy', 'Who performs "Gangnam Style"?', '["Rain","G-DRAGON","J.Y. Park","PSY"]', 3, 'PSY released the worldwide hit "Gangnam Style" in 2012.'),
  ('kpop-maknae', 'In a K-pop group, what does "maknae" mean?', '["The leader","The youngest member","The main dancer","The oldest member"]', 1, 'Maknae is the Korean term for the youngest member of a group.'),
  ('kpop-bias', 'What does a fan usually mean by their "bias"?', '["Their favorite member","A concert ticket","An album version","A dance practice"]', 0, 'A bias is a fan''s favorite member of a group.'),
  ('kpop-comeback', 'What does a K-pop "comeback" usually refer to?', '["A member''s birthday","A fan meeting","A new music release and its promotions","A concert encore"]', 2, 'A comeback refers to a new release and the related promotional activities.'),
  ('lyrics-colors', 'What do different colors usually identify in color-coded group lyrics?', '["Album sales","Song genres","The music video location","Which member is singing"]', 3, 'Color-coded lyrics use colors to show who sings each part.'),
  ('lyrics-romanization', 'What is romanization in a lyrics video?', '["A dance tutorial","Writing another script using Latin letters","A song remix","An album review"]', 1, 'Romanization represents words from another writing system using Latin letters.'),
  ('music-bpm', 'What does BPM stand for in music?', '["Beats per minute","Bass per melody","Band performance mode","Bridge pattern meter"]', 0, 'BPM measures tempo in beats per minute.'),
  ('music-acappella', 'What is an a cappella performance?', '["An instrumental solo","A faster remix","Singing without instrumental accompaniment","A live dance performance"]', 2, 'A cappella means singing without instrumental accompaniment.'),
  ('music-chorus', 'Which section commonly repeats the main hook of a song?', '["The intro","The bridge","The outro","The chorus"]', 3, 'The chorus often repeats the song''s main hook and melody.'),
  ('music-duet', 'How many performers are featured in a duet?', '["One","Two","Three","Four"]', 1, 'A duet is a performance by two people.'),
  ('music-ep', 'What does EP stand for on a music release?', '["Extended play","Extra performance","Electronic pop","Encore playlist"]', 0, 'EP stands for extended play, typically shorter than a full-length album.'),
  ('music-mv', 'What does MV usually stand for in K-pop?', '["Main vocal","Music version","Music video","Member vote"]', 2, 'MV is the common abbreviation for music video.'),
  ('music-encore', 'What is an encore at a concert?', '["The soundcheck","The opening act","A costume change","An extra performance after the main set"]', 3, 'An encore is an additional performance after the main set ends.'),
  ('music-instrumental', 'What is usually absent from an instrumental version of a song?', '["The rhythm","The lead vocals","The melody","The instruments"]', 1, 'An instrumental version generally removes the lead vocal track.'),
  ('music-bridge', 'What is the usual purpose of a song''s bridge?', '["To introduce a contrasting section","To list the album tracks","To adjust speaker volume","To announce the singer"]', 0, 'A bridge adds contrast to the repeated verse and chorus sections.'),
  ('music-lightstick', 'What do many K-pop fans bring to concerts to light up the crowd?', '["A metronome","A microphone","A light stick","A guitar pick"]', 2, 'Fans use group-specific light sticks to support artists at concerts.'),
  ('music-cover', 'What is a cover song?', '["An album''s title page","A hidden bonus track","A song without lyrics","A performance of a song originally by another artist"]', 3, 'A cover is a new performance of a song originally recorded by another artist.')
on conflict (id) do nothing;

-- Internal-only helper. The recipient and timestamp are never client inputs
-- to this function. Correct answers/explanations appear ONLY after completion.
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day)
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'credits', p.vote_credits + p.bonus_credits,
    'purchased', p.vote_credits,
    'bonus', p.bonus_credits,
    'login', jsonb_build_object('claimed', l.user_id is not null, 'reward', 2),
    'earned_today', coalesce(l.reward, 0) + coalesce(a.score, 0),
    'quiz', case when a.id is null then null else jsonb_build_object(
      'attempt_id', a.id,
      'completed', a.completed_at is not null,
      'score', a.score,
      'reward', a.score,
      'answers', to_jsonb(a.answers),
      'questions', (
        select jsonb_agg(
          jsonb_build_object('id', q.item->'id', 'prompt', q.item->'prompt', 'options', q.item->'options')
          || case when a.completed_at is not null
             then jsonb_build_object('correct_option', q.item->'correct_option', 'explanation', q.item->'explanation')
             else '{}'::jsonb end
          order by q.ord
        ) from jsonb_array_elements(a.questions) with ordinality as q(item, ord)
      )
    ) end
  ) from d
  join public.profiles p on p.id = p_uid
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day
  left join public.daily_quiz_attempts a on a.user_id = p_uid and a.quiz_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

create or replace function public.my_daily_rewards_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'err.signin';
  end if;
  return public.daily_rewards_payload(v_uid, clock_timestamp());
end $$;
revoke all on function public.my_daily_rewards_status() from public, anon, authenticated;
grant execute on function public.my_daily_rewards_status() to authenticated;

create or replace function public.claim_daily_login(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_claim public.daily_login_rewards;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  -- The same lock as votes/spin/achievements: no lost wallet updates, even
  -- when several devices or tabs claim at once. Capture time AFTER the lock.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  select * into v_claim from public.daily_login_rewards
    where user_id = v_uid and reward_day = p_expected_day;
  v_replayed := found;
  if not v_replayed then
    -- The expected day only guards stale clicks/retries at midnight. It NEVER
    -- selects the awarded date. A browser cannot claim a past or future day.
    if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;
    insert into public.daily_login_rewards (user_id, reward_day, reward, created_at)
    values (v_uid, v_day, 2, v_now) returning * into v_claim;
    update public.profiles set bonus_credits = bonus_credits + v_claim.reward where id = v_uid;
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  return jsonb_build_object('reward', v_claim.reward, 'replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.claim_daily_login(uuid,date) from public, anon, authenticated;
grant execute on function public.claim_daily_login(uuid,date) to authenticated;

create or replace function public.start_daily_quiz(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_questions jsonb;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;
  select * into v_attempt from public.daily_quiz_attempts where user_id = v_uid and quiz_day = v_day;
  v_replayed := found;
  if not v_replayed then
    select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', q.options,
      'correct_option', q.correct_option, 'explanation', q.explanation) order by q.draw)
      into v_questions
    from (select b.*, random() as draw from public.daily_quiz_questions b
          where b.active order by draw limit 3) q;
    if v_questions is null or jsonb_array_length(v_questions) <> 3 then raise exception 'err.dailySetup'; end if;
    insert into public.daily_quiz_attempts (user_id, quiz_day, questions, created_at)
    values (v_uid, v_day, v_questions, v_now);
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  return jsonb_build_object('replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.start_daily_quiz(uuid,date) from public, anon, authenticated;
grant execute on function public.start_daily_quiz(uuid,date) to authenticated;

create or replace function public.submit_daily_quiz(p_expected_user_id uuid, p_attempt_id uuid, p_answers int[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_score int;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  -- Lock order is always profile, then attempt; identical on every quiz path.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  select * into v_attempt from public.daily_quiz_attempts
    where id = p_attempt_id and user_id = v_uid for update;
  if not found then raise exception 'err.dailyQuizSession'; end if;
  v_replayed := v_attempt.completed_at is not null;
  if not v_replayed then
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
    if v_attempt.quiz_day <> v_day then raise exception 'err.dailyDayChanged'; end if;
    if p_answers is null or cardinality(p_answers) <> 3 or array_ndims(p_answers) <> 1
       or array_lower(p_answers, 1) <> 1
       or exists (select 1 from unnest(p_answers) n where n is null or n not between 0 and 3) then
      raise exception 'err.dailyQuizAnswers';
    end if;
    -- NO client-provided score, reward, correct answers, question IDs or date.
    select count(*)::int into v_score
      from jsonb_array_elements(v_attempt.questions) with ordinality as q(item, ord)
      where (q.item->>'correct_option')::int = p_answers[q.ord::int];
    update public.daily_quiz_attempts set answers = p_answers, score = v_score, completed_at = v_now
      where id = v_attempt.id returning * into v_attempt;
    update public.profiles set bonus_credits = bonus_credits + v_score where id = v_uid;
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  -- Completed attempts replay even across midnight, without changing balances.
  return jsonb_build_object('reward', v_attempt.score, 'score', v_attempt.score, 'replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.submit_daily_quiz(uuid,uuid,int[]) from public, anon, authenticated;
grant execute on function public.submit_daily_quiz(uuid,uuid,int[]) to authenticated;

notify pgrst, 'reload schema';
commit;

-- BEGIN CHECK-IN CALENDAR / K-POP QUIZ: mirror 20261113_calendar_kpop_quiz.sql
-- Run AFTER 20261112_daily_rewards.sql. Add real current-month check-in dates
-- and replace the factory quiz bank with beginner-friendly K-pop questions.
-- No wallet/ledger/session changes. Already-started quizzes keep their frozen
-- questions and scores; these questions apply only to newly started rounds.
begin;

-- Retire only the original factory seeds, not custom editorial questions.
-- Keep every row/snapshot for historical reviews. Reruns preserve edits to
-- the new bank (ON CONFLICT DO NOTHING) and never award bonus votes.
update public.daily_quiz_questions set active = false
where id in (
  'kpop-dynamite',
  'kpop-ddudu',
  'kpop-gods-menu',
  'kpop-ditto',
  'kpop-super',
  'kpop-cheer-up',
  'kpop-love-shot',
  'kpop-psy',
  'kpop-maknae',
  'kpop-bias',
  'kpop-comeback',
  'lyrics-colors',
  'lyrics-romanization',
  'music-bpm',
  'music-acappella',
  'music-chorus',
  'music-duet',
  'music-ep',
  'music-mv',
  'music-encore',
  'music-instrumental',
  'music-bridge',
  'music-lightstick',
  'music-cover'
);

insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation) values
  ('kpop-easy-dynamite', 'Which K-pop group sings "Dynamite"?', '["BTS","BLACKPINK","TWICE","EXO"]', 0, '"Dynamite" is one of BTS’s biggest hits.'),
  ('kpop-easy-ddudu', 'Which K-pop girl group released "DDU-DU DDU-DU"?', '["TWICE","BLACKPINK","Red Velvet","ITZY"]', 1, '"DDU-DU DDU-DU" is a hit song by BLACKPINK.'),
  ('kpop-easy-army', 'What are BTS fans called?', '["BLINK","STAY","ARMY","ONCE"]', 2, 'ARMY is the official name of BTS’s fandom.'),
  ('kpop-easy-blink', 'What are BLACKPINK fans called?', '["ARMY","ONCE","STAY","BLINK"]', 3, 'BLACKPINK’s official fandom name is BLINK.'),
  ('kpop-easy-tt', 'Which K-pop girl group sings "TT"?', '["TWICE","BLACKPINK","aespa","IVE"]', 0, '"TT" is one of TWICE’s signature songs.'),
  ('kpop-easy-gangnam', 'Who sings the K-pop hit "Gangnam Style"?', '["Jungkook","PSY","G-DRAGON","J.Y. Park"]', 1, 'PSY is the artist behind "Gangnam Style".'),
  ('kpop-easy-solo', 'Which BLACKPINK member released "SOLO"?', '["Lisa","Jisoo","Jennie","Rosé"]', 2, '"SOLO" is Jennie’s debut solo single.'),
  ('kpop-easy-lalisa', 'Which BLACKPINK member sings "LALISA"?', '["Rosé","Jennie","Jisoo","Lisa"]', 3, '"LALISA" is Lisa’s solo debut song.'),
  ('kpop-easy-bts-count', 'How many members are in BTS?', '["7","4","5","9"]', 0, 'BTS has seven members: RM, Jin, SUGA, j-hope, Jimin, V and Jungkook.'),
  ('kpop-easy-blackpink-count', 'How many members are in BLACKPINK?', '["7","4","9","5"]', 1, 'BLACKPINK has four members: Jisoo, Jennie, Rosé and Lisa.'),
  ('kpop-easy-twice-count', 'How many members are in TWICE?', '["4","7","9","5"]', 2, 'TWICE has nine members.'),
  ('kpop-easy-jungkook', 'Which K-pop group is Jungkook a member of?', '["EXO","Stray Kids","SEVENTEEN","BTS"]', 3, 'Jungkook is the youngest member of BTS.'),
  ('kpop-easy-s-class', 'Which K-pop group sings "S-Class"?', '["Stray Kids","BTS","EXO","TXT"]', 0, '"S-Class" is a hit song by Stray Kids.'),
  ('kpop-easy-gods-menu', 'Which K-pop group released "God''s Menu"?', '["BTS","Stray Kids","SEVENTEEN","EXO"]', 1, '"God’s Menu" is one of Stray Kids’ best-known songs.'),
  ('kpop-easy-super-shy', 'Which K-pop girl group sings "Super Shy"?', '["IVE","aespa","NewJeans","TWICE"]', 2, '"Super Shy" is a hit song by NewJeans.'),
  ('kpop-easy-hype-boy', 'Which K-pop girl group released "Hype Boy"?', '["aespa","IVE","LE SSERAFIM","NewJeans"]', 3, '"Hype Boy" is a NewJeans song.'),
  ('kpop-easy-love-dive', 'Which K-pop girl group sings "LOVE DIVE"?', '["IVE","TWICE","BLACKPINK","ITZY"]', 0, '"LOVE DIVE" is a hit song by IVE.'),
  ('kpop-easy-next-level', 'Which K-pop girl group sings "Next Level"?', '["ITZY","aespa","Red Velvet","TWICE"]', 1, '"Next Level" is an aespa song.'),
  ('kpop-easy-wannabe', 'Which K-pop girl group released "WANNABE"?', '["TWICE","BLACKPINK","ITZY","IVE"]', 2, '"WANNABE" is one of ITZY’s best-known songs.'),
  ('kpop-easy-antifragile', 'Which K-pop girl group sings "ANTIFRAGILE"?', '["aespa","IVE","TWICE","LE SSERAFIM"]', 3, '"ANTIFRAGILE" is a hit song by LE SSERAFIM.'),
  ('kpop-easy-once', 'What are TWICE fans called?', '["ONCE","ARMY","BLINK","STAY"]', 0, 'ONCE is TWICE’s official fandom name.'),
  ('kpop-easy-stay', 'What are Stray Kids fans called?', '["ARMY","STAY","BLINK","ONCE"]', 1, 'STAY is the official name of Stray Kids’ fandom.'),
  ('kpop-easy-bang-chan', 'Which K-pop group is Bang Chan the leader of?', '["BTS","EXO","Stray Kids","TXT"]', 2, 'Bang Chan is the leader of Stray Kids.'),
  ('kpop-easy-red-flavor', 'Which K-pop girl group sings "Red Flavor"?', '["TWICE","BLACKPINK","ITZY","Red Velvet"]', 3, '"Red Flavor" is a hit song by Red Velvet.')
on conflict (id) do nothing;

-- Same private helper and sanitized answer visibility as before. Only the
-- owner’s real check-in dates are added, using the server’s Vietnam month.
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day)
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'credits', p.vote_credits + p.bonus_credits,
    'purchased', p.vote_credits,
    'bonus', p.bonus_credits,
    'login', jsonb_build_object('claimed', l.user_id is not null, 'reward', 2,
      'claimed_days', coalesce((
        select jsonb_agg(c.reward_day order by c.reward_day)
        from public.daily_login_rewards c
        where c.user_id = p_uid
          and c.reward_day >= date_trunc('month', d.day)::date
          and c.reward_day <= d.day
      ), '[]'::jsonb)),
    'earned_today', coalesce(l.reward, 0) + coalesce(a.score, 0),
    'quiz', case when a.id is null then null else jsonb_build_object(
      'attempt_id', a.id,
      'completed', a.completed_at is not null,
      'score', a.score,
      'reward', a.score,
      'answers', to_jsonb(a.answers),
      'questions', (
        select jsonb_agg(
          jsonb_build_object('id', q.item->'id', 'prompt', q.item->'prompt', 'options', q.item->'options')
          || case when a.completed_at is not null
             then jsonb_build_object('correct_option', q.item->'correct_option', 'explanation', q.item->'explanation')
             else '{}'::jsonb end
          order by q.ord
        ) from jsonb_array_elements(a.questions) with ordinality as q(item, ord)
      )
    ) end
  ) from d
  join public.profiles p on p.id = p_uid
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day
  left join public.daily_quiz_attempts a on a.user_id = p_uid and a.quiz_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;

-- BEGIN DAILY REWARDS UPGRADE: mirror 20261114_daily_rewards_upgrade.sql
-- Run AFTER 20261113_calendar_kpop_quiz.sql. Check-in calendar gains real
-- multi-month history + streak stats, and the quiz gains a bigger, categorised
-- K-pop bank that avoids repeating the player's recent questions.
-- Reward rules are unchanged (+2 check-in, +1 per correct answer, max +3).
-- No wallet/ledger/session changes and no backfilled rewards. Rerunnable.
begin;

-- Categories only label questions for the player. The column is additive and
-- never part of scoring, so existing rows keep a safe default.
alter table public.daily_quiz_questions
  add column if not exists category text not null default 'Songs';

update public.daily_quiz_questions set category = 'Songs'
where id in ('kpop-easy-dynamite','kpop-easy-ddudu','kpop-easy-tt','kpop-easy-gangnam',
  'kpop-easy-solo','kpop-easy-lalisa','kpop-easy-jungkook','kpop-easy-s-class',
  'kpop-easy-gods-menu','kpop-easy-super-shy','kpop-easy-hype-boy','kpop-easy-love-dive',
  'kpop-easy-next-level','kpop-easy-wannabe','kpop-easy-antifragile','kpop-easy-bang-chan',
  'kpop-easy-red-flavor');
update public.daily_quiz_questions set category = 'Groups'
where id in ('kpop-easy-bts-count','kpop-easy-blackpink-count','kpop-easy-twice-count');
update public.daily_quiz_questions set category = 'Fandom'
where id in ('kpop-easy-army','kpop-easy-blink','kpop-easy-once','kpop-easy-stay');

-- More easy, familiar K-pop questions: hooks/lyrics, songs, members, fandoms.
-- ON CONFLICT DO NOTHING keeps later editorial edits and never resets scores.
insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation, category) values
  ('kpop-lyric-stars', 'Which K-pop song has the hook “''Cause I-I-I''m in the stars tonight”?', '["Dynamite","Butter","Life Goes On","Boy With Luv"]', 0, '“Dynamite” opens with that line. It is one of BTS''s biggest hits.', 'Lyrics'),
  ('kpop-lyric-butter', 'Which K-pop song says “Smooth like butter, like a criminal undercover”?', '["Butter","Dynamite","Fake Love","IDOL"]', 0, 'That is the opening line of “Butter” by BTS.', 'Lyrics'),
  ('kpop-lyric-ddu-du', 'Which BLACKPINK song repeats “ddu-du ddu-du du”?', '["Whistle","DDU-DU DDU-DU","As If It''s Your Last","Boombayah"]', 1, 'The hook gives “DDU-DU DDU-DU” its name.', 'Lyrics'),
  ('kpop-lyric-shy', 'Which TWICE song has the famous “shy, shy, shy” hook?', '["TT","CHEER UP","LIKEY","What is Love?"]', 1, '“CHEER UP” is known for its “shy shy shy” chorus.', 'Lyrics'),
  ('kpop-lyric-gangnam', 'Which K-pop global hit includes “Oppan Gangnam Style”?', '["Gangnam Style","Gentleman","Daddy","Hangover"]', 0, 'PSY''s “Gangnam Style” made that phrase world-famous.', 'Lyrics'),
  ('kpop-lyric-super-shy', 'Which NewJeans song repeats “I''m super shy, super shy”?', '["Ditto","Hype Boy","Super Shy","Cool With You"]', 2, '“Super Shy” became a viral TikTok hook in 2023.', 'Lyrics'),
  ('kpop-lyric-love-dive', 'Which IVE song repeats “LOVE DIVE” in its chorus?', '["LOVE DIVE","ELEVEN","After LIKE","Kitsch"]', 0, '“LOVE DIVE” was IVE''s breakout hit.', 'Lyrics'),
  ('kpop-lyric-wannabe', 'Which ITZY song sings “I wanna be me, me, me”?', '["WANNABE","DALLA DALLA","ICY","Not Shy"]', 0, '“WANNABE” is one of ITZY''s best-known songs.', 'Lyrics'),
  ('kpop-lyric-antifragile', 'Which LE SSERAFIM song has the hook “Anti-ti-ti-ti fragile”?', '["ANTIFRAGILE","FEARLESS","UNFORGIVEN","EASY"]', 0, 'LE SSERAFIM sing that hook in “ANTIFRAGILE”.', 'Lyrics'),
  ('kpop-lyric-red-flavor', 'Which Red Velvet song repeats “Red Flavor” as its hook?', '["Red Flavor","Russian Roulette","Bad Boy","Psycho"]', 0, '“Red Flavor” is a summer hit by Red Velvet.', 'Lyrics'),
  ('kpop-lyric-next-level', 'Which aespa song says “I''m on the Next Level”?', '["Next Level","Black Mamba","Savage","Supernova"]', 0, '“Next Level” made aespa widely known.', 'Lyrics'),
  ('kpop-lyric-maniac', 'Which Stray Kids song repeats “MANIAC” in its chorus?', '["MANIAC","God''s Menu","Thunderous","CASE 143"]', 0, '“MANIAC” is the title track of Stray Kids'' ODDINARY.', 'Lyrics'),
  ('kpop-lyric-cupid', 'Which K-pop group released the viral song “Cupid”?', '["FIFTY FIFTY","IVE","aespa","Kep1er"]', 0, '“Cupid” by FIFTY FIFTY went viral worldwide in 2023.', 'Lyrics'),
  ('kpop-song-boy-with-luv', '“Boy With Luv” is a BTS collaboration with which artist?', '["Halsey","Selena Gomez","Dua Lipa","Camila Cabello"]', 0, 'BTS recorded “Boy With Luv” with Halsey.', 'Songs'),
  ('kpop-song-eleven', 'Which K-pop girl group debuted with the song “ELEVEN”?', '["IVE","aespa","ITZY","NMIXX"]', 0, 'IVE debuted in 2021 with “ELEVEN”.', 'Songs'),
  ('kpop-song-tomboy', 'Which K-pop group released the hit song “TOMBOY”?', '["(G)I-DLE","ITZY","MAMAMOO","Red Velvet"]', 0, '“TOMBOY” is a 2022 hit by (G)I-DLE.', 'Songs'),
  ('kpop-song-maria', '“MARÍA” is a solo hit by which MAMAMOO member?', '["Hwasa","Solar","Wheein","Moonbyul"]', 0, 'Hwasa released “MARÍA” as a solo artist.', 'Songs'),
  ('kpop-song-ditto', 'Which K-pop group released the song “Ditto”?', '["NewJeans","IVE","LE SSERAFIM","aespa"]', 0, 'NewJeans released “Ditto” in December 2022.', 'Songs'),
  ('kpop-song-psycho', 'Which K-pop girl group sings “Psycho”?', '["Red Velvet","BLACKPINK","TWICE","aespa"]', 0, '“Psycho” is one of Red Velvet''s signature songs.', 'Songs'),
  ('kpop-song-lilac', 'Which K-pop solo artist released the hit song “LILAC”?', '["IU","Taeyeon","Sunmi","Hwasa"]', 0, 'IU released “LILAC” in 2021.', 'Songs'),
  ('kpop-song-flower', 'Which BLACKPINK member released the solo song “Flower”?', '["Jisoo","Jennie","Rosé","Lisa"]', 0, '“Flower” is Jisoo''s solo single.', 'Songs'),
  ('kpop-song-girls', '“Girls” is a 2022 title track by which K-pop group?', '["aespa","ITZY","EVERGLOW","STAYC"]', 0, 'aespa released “Girls” in 2022.', 'Songs'),
  ('kpop-member-leader-bts', 'Who is the leader of BTS?', '["RM","Jin","SUGA","j-hope"]', 0, 'RM is the leader of BTS.', 'Members'),
  ('kpop-member-maknae-bts', 'Who is the youngest member (maknae) of BTS?', '["Jungkook","V","Jimin","Jin"]', 0, 'Jungkook, born in 1997, is the maknae of BTS.', 'Members'),
  ('kpop-member-maknae-blackpink', 'Who is the maknae (youngest member) of BLACKPINK?', '["Lisa","Rosé","Jennie","Jisoo"]', 0, 'Lisa, born in 1997, is the youngest BLACKPINK member.', 'Members'),
  ('kpop-member-leader-twice', 'Who is the leader of TWICE?', '["Jihyo","Nayeon","Sana","Mina"]', 0, 'Jihyo is the leader of TWICE.', 'Members'),
  ('kpop-member-pop', 'Which TWICE member released the solo song “POP!”?', '["Nayeon","Jihyo","Momo","Dahyun"]', 0, '“POP!” is Nayeon''s solo debut single.', 'Members'),
  ('kpop-member-winter-bear', 'Which BTS member released the solo song “Winter Bear”?', '["V","Jin","Jungkook","RM"]', 0, 'V released “Winter Bear” as a solo track.', 'Members'),
  ('kpop-member-seven', 'Which BTS member sings the solo hit “Seven”?', '["Jungkook","Jimin","RM","SUGA"]', 0, '“Seven” is Jungkook''s solo single featuring Latto.', 'Members'),
  ('kpop-member-hanni', 'Which member of NewJeans is known for singing “Hype Boy”''s opening?', '["Hanni","Minji","Danielle","Haerin"]', 0, 'Hanni is one of NewJeans'' most recognisable vocalists.', 'Members'),
  ('kpop-fandom-nctzen', 'What are the fans of K-pop group NCT called?', '["NCTzen","MY","ReVeluv","MIDZY"]', 0, 'NCT''s fandom name is NCTzen.', 'Fandom'),
  ('kpop-fandom-midzy', 'What are ITZY fans called?', '["MIDZY","MY","DIVE","Atiny"]', 0, 'ITZY''s fandom name is MIDZY.', 'Fandom'),
  ('kpop-fandom-my', 'What are aespa fans called?', '["MY","DIVE","NCTzen","MOA"]', 0, 'aespa''s fandom name is MY.', 'Fandom'),
  ('kpop-fandom-dive', 'What are IVE fans called?', '["DIVE","MIDZY","BUDDY","MOA"]', 0, 'IVE''s fandom name is DIVE.', 'Fandom'),
  ('kpop-fandom-moa', 'What are the fans of K-pop group TXT called?', '["MOA","CARAT","Atiny","ENGENE"]', 0, 'TXT''s fandom name is MOA.', 'Fandom'),
  ('kpop-fandom-carat', 'What are the fans of K-pop group SEVENTEEN called?', '["CARAT","MOA","ENGENE","STAY"]', 0, 'SEVENTEEN''s fandom name is CARAT.', 'Fandom'),
  ('kpop-fandom-engene', 'What are the fans of K-pop group ENHYPEN called?', '["ENGENE","MOA","CARAT","Atiny"]', 0, 'ENHYPEN''s fandom name is ENGENE.', 'Fandom'),
  ('kpop-fandom-reveluv', 'What are Red Velvet fans called?', '["ReVeluv","MY","DIVE","BLINK"]', 0, 'Red Velvet''s fandom name is ReVeluv.', 'Fandom'),
  ('kpop-fandom-atiny', 'What are the fans of K-pop group ATEEZ called?', '["ATINY","ENGENE","CARAT","MOA"]', 0, 'ATINY blends ATEEZ and destiny.', 'Fandom')
on conflict (id) do nothing;

/* Research pass: the K-pop formats fans play most (boy/girl group, group
   leader, maknae, stage vs. real name, fandom name, finishing a song title),
   written from scratch at beginner difficulty. Facts checked against public
   group profiles; no third-party question text is copied. */
insert into public.daily_quiz_questions (id, prompt, options, correct_option, explanation, category) values
  ('kpop-group-gender-blackpink', 'Is BLACKPINK a girl group or a boy group?', '["Girl group","Boy group","Co-ed group","Solo act"]', 0, 'BLACKPINK is a four-member girl group from YG Entertainment.', 'Groups'),
  ('kpop-group-gender-bts', 'Is BTS a boy group or a girl group?', '["Boy group","Girl group","Co-ed group","Dance crew"]', 0, 'BTS is a seven-member boy group that debuted in 2013.', 'Groups'),
  ('kpop-group-gender-kard', 'Which of these K-pop groups is co-ed?', '["KARD","SEVENTEEN","TWICE","aespa"]', 0, 'KARD has both male and female members, which is rare in K-pop.', 'Groups'),
  ('kpop-group-count-seventeen', 'How many members does SEVENTEEN have?', '["13","17","7","9"]', 0, 'SEVENTEEN has 13 members in three units — the name comes from 13 members + 3 units + 1 team.', 'Groups'),
  ('kpop-group-count-straykids', 'How many members does Stray Kids have today?', '["8","9","7","6"]', 0, 'Stray Kids promotes with eight members after Woojin left in 2019.', 'Groups'),
  ('kpop-company-blackpink', 'Which company debuted BLACKPINK?', '["YG Entertainment","JYP Entertainment","SM Entertainment","KQ Entertainment"]', 0, 'BLACKPINK is YG Entertainment''s girl group.', 'Groups'),
  ('kpop-company-twice', 'Which company formed TWICE?', '["JYP Entertainment","YG Entertainment","SM Entertainment","HYBE"]', 0, 'TWICE was formed by JYP Entertainment through Sixteen.', 'Groups'),
  ('kpop-company-aespa', 'Which company debuted aespa?', '["SM Entertainment","JYP Entertainment","YG Entertainment","Pledis"]', 0, 'aespa debuted under SM Entertainment in 2020.', 'Groups'),
  ('kpop-company-ateez', 'Which company debuted ATEEZ?', '["KQ Entertainment","SM Entertainment","JYP Entertainment","Starship"]', 0, 'ATEEZ debuted under KQ Entertainment in October 2018.', 'Groups'),
  ('kpop-debut-bts-year', 'In which year did BTS debut?', '["2013","2015","2010","2018"]', 0, 'BTS debuted on 13 June 2013 with "No More Dream".', 'Groups'),
  ('kpop-leader-shinee', 'Who is the leader of SHINee?', '["Onew","Key","Minho","Taemin"]', 0, 'Onew is the leader of SHINee.', 'Members'),
  ('kpop-leader-redvelvet', 'Who is the leader of Red Velvet?', '["Irene","Seulgi","Wendy","Joy"]', 0, 'Irene is the leader of Red Velvet.', 'Members'),
  ('kpop-leader-itzy', 'Who is the leader of ITZY?', '["Yeji","Lia","Ryujin","Yuna"]', 0, 'Yeji is the leader of ITZY.', 'Members'),
  ('kpop-leader-aespa', 'Who is the leader of aespa?', '["Karina","Giselle","Winter","Ningning"]', 0, 'Karina is the leader of aespa.', 'Members'),
  ('kpop-leader-ateez', 'Who is the leader and producer of ATEEZ?', '["Hongjoong","Seonghwa","Yunho","Jongho"]', 0, 'Hongjoong leads ATEEZ and produces much of their music.', 'Members'),
  ('kpop-leader-enhypen', 'Who is the leader of ENHYPEN?', '["Jungwon","Heeseung","Jay","Ni-ki"]', 0, 'Jungwon is the leader of ENHYPEN.', 'Members'),
  ('kpop-leader-gidle', 'Who is the leader of (G)I-DLE?', '["Soyeon","Miyeon","Minnie","Yuqi"]', 0, 'Soyeon leads (G)I-DLE and writes many of their songs.', 'Members'),
  ('kpop-maknae-newjeans', 'Who is the maknae (youngest member) of NewJeans?', '["Hyein","Haerin","Danielle","Minji"]', 0, 'Hyein, born in 2008, is the youngest NewJeans member.', 'Members'),
  ('kpop-maknae-itzy', 'Who is the maknae of ITZY?', '["Yuna","Yeji","Chaeryeong","Ryujin"]', 0, 'Yuna is the youngest member of ITZY.', 'Members'),
  ('kpop-maknae-seventeen', 'Who is the maknae of SEVENTEEN?', '["Dino","Vernon","Woozi","Hoshi"]', 0, 'Dino is the youngest member of SEVENTEEN.', 'Members'),
  ('kpop-realname-v', 'Which BTS member''s real name is Kim Tae-hyung?', '["V","RM","Jimin","Jin"]', 0, 'V was born Kim Tae-hyung.', 'Members'),
  ('kpop-realname-lisa', 'Which BLACKPINK member''s real first name is Lalisa?', '["Lisa","Jennie","Rosé","Jisoo"]', 0, 'Lisa was born Pranpriya, later Lalisa Manobal.', 'Members'),
  ('kpop-realname-jungkook', 'Which BTS member''s real name is Jeon Jung-kook?', '["Jungkook","Jimin","SUGA","Jin"]', 0, 'Jungkook''s full name is Jeon Jung-kook.', 'Members'),
  ('kpop-fandom-exo-l', 'What are the fans of K-pop group EXO called?', '["EXO-L","EXO-M","EXO-K","Eris"]', 0, 'EXO-L stands for EXO-Love.', 'Fandom'),
  ('kpop-fandom-bunnies', 'What are NewJeans fans called?', '["Bunnies","Tokkis","Carats","DIVE"]', 0, 'NewJeans'' fandom name is Bunnies.', 'Fandom'),
  ('kpop-fandom-shawol', 'What are SHINee fans called?', '["Shawol","SHINee World","Shawols","SHINeez"]', 0, 'Shawol comes from "SHINee World".', 'Fandom'),
  ('kpop-fandom-monbebe', 'What are MONSTA X fans called?', '["MONBEBE","MONSTA","Monbebes","X-Lovers"]', 0, 'MONBEBE mixes MONSTA X with the French word bébé.', 'Fandom'),
  ('kpop-fandom-neverland', 'What are (G)I-DLE fans called?', '["NEVERLAND","Idleland","DLE","Neverlands"]', 0, 'NEVERLAND is the (G)I-DLE fandom, after Peter Pan.', 'Fandom'),
  ('kpop-fandom-moomoo', 'What are MAMAMOO fans called?', '["Moomoo","Mamamoo","Moomoos","Moo"]', 0, 'MAMAMOO''s fandom name is Moomoo.', 'Fandom'),
  ('kpop-fandom-sone', 'What are Girls'' Generation fans called?', '["SONE","SoShi","Girls","Soshi"]', 0, 'SONE comes from the Korean word for "wish".', 'Fandom'),
  ('kpop-fandom-vip', 'What are BIGBANG fans called?', '["VIP","Bang","Big","V.I.P"]', 0, 'BIGBANG''s fandom name is VIP.', 'Fandom'),
  ('kpop-title-blood-sweat', 'Finish this BTS song title: "Blood Sweat & ___"', '["Tears","Fears","Years","Dreams"]', 0, 'The 2016 hit is "Blood Sweat & Tears".', 'Lyrics'),
  ('kpop-title-fake-love', 'Finish this BTS song title: "Fake ___"', '["Love","Hope","Smile","Friends"]', 0, '"Fake Love" was released in 2018.', 'Lyrics'),
  ('kpop-title-kill-this-love', 'Finish this BLACKPINK song title: "Kill This ___"', '["Love","Pain","Night","Beat"]', 0, '"Kill This Love" is a 2019 BLACKPINK single.', 'Lyrics'),
  ('kpop-title-boy-with-luv', 'Finish this BTS song title: "Boy With ___"', '["Luv","Love","You","Us"]', 0, '"Boy With Luv" features Halsey.', 'Lyrics'),
  ('kpop-title-dalla-dalla', 'Which K-pop group debuted with the song "DALLA DALLA"?', '["ITZY","aespa","IVE","NMIXX"]', 0, 'ITZY debuted in 2019 with "DALLA DALLA".', 'Lyrics')
on conflict (id) do nothing;

-- Without at least three active questions a round cannot start.
do $$
begin
  if (select count(*) from public.daily_quiz_questions where active) < 3 then
    raise exception 'err.dailySetup';
  end if;
end $$;

/* Same sanitized payload as before, plus lifetime/streak check-in statistics
   and question categories. Statistics are read-only: nothing here awards a
   reward, and a streak is only a display counter. */
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day)
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'credits', p.vote_credits + p.bonus_credits,
    'purchased', p.vote_credits,
    'bonus', p.bonus_credits,
    'login', jsonb_build_object('claimed', l.user_id is not null, 'reward', 2,
      'claimed_days', coalesce((
        select jsonb_agg(c.reward_day order by c.reward_day)
        from public.daily_login_rewards c
        where c.user_id = p_uid
          and c.reward_day >= date_trunc('month', d.day)::date
          and c.reward_day <= d.day
      ), '[]'::jsonb),
      'total_days', coalesce(st.total_days, 0),
      'first_day', st.first_day,
      -- A streak stays alive until the end of the next day, then restarts.
      'streak', case when st.last_day is null or st.last_day < d.day - 1 then 0 else st.run end,
      'best_streak', coalesce(st.best_streak, 0)),
    'earned_today', coalesce(l.reward, 0) + coalesce(a.score, 0),
    'quiz', case when a.id is null then null else jsonb_build_object(
      'attempt_id', a.id,
      'completed', a.completed_at is not null,
      'score', a.score,
      'reward', a.score,
      'answers', to_jsonb(a.answers),
      'questions', (
        select jsonb_agg(
          jsonb_build_object('id', q.item->'id', 'prompt', q.item->'prompt', 'options', q.item->'options',
            'category', coalesce(q.item->>'category', 'Songs'))
          || case when a.completed_at is not null
             then jsonb_build_object('correct_option', q.item->'correct_option', 'explanation', q.item->'explanation')
             else '{}'::jsonb end
          order by q.ord
        ) from jsonb_array_elements(a.questions) with ordinality as q(item, ord)
      )
    ) end
  ) from d
  join public.profiles p on p.id = p_uid
  left join lateral (
    select count(*)::int as total_days,
           min(c.reward_day) as first_day,
           (select max(x.reward_day) from public.daily_login_rewards x
             where x.user_id = p_uid and x.reward_day <= d.day) as last_day,
           coalesce((select max(runs.n) from (
             select count(*)::int as n from (
               select c2.reward_day - (row_number() over (order by c2.reward_day))::int as grp
               from public.daily_login_rewards c2 where c2.user_id = p_uid
             ) g group by g.grp
           ) runs), 0)::int as best_streak,
           coalesce((select count(*)::int from (
             select c3.reward_day - (row_number() over (order by c3.reward_day))::int as grp
             from public.daily_login_rewards c3
             where c3.user_id = p_uid and c3.reward_day <= d.day
           ) h group by h.grp order by h.grp desc limit 1), 0)::int as run
    from public.daily_login_rewards c
    where c.user_id = p_uid
  ) st on true
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day
  left join public.daily_quiz_attempts a on a.user_id = p_uid and a.quiz_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

-- Do not hand the same questions back day after day: prefer active questions
-- the player has not seen in the last 30 days, then fall back to any active
-- question. Scoring, rewards and the frozen snapshot are unchanged.
create or replace function public.start_daily_quiz(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_questions jsonb;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;
  select * into v_attempt from public.daily_quiz_attempts where user_id = v_uid and quiz_day = v_day;
  v_replayed := found;
  if not v_replayed then
    select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', q.options,
      'correct_option', q.correct_option, 'explanation', q.explanation, 'category', q.category)
      order by q.seen, q.draw)
      into v_questions
    from (
      select b.*, random() as draw,
             case when exists (
               select 1 from public.daily_quiz_attempts a,
                    jsonb_array_elements(a.questions) item
               where a.user_id = v_uid and a.quiz_day > v_day - 30
                 and item->>'id' = b.id
             ) then 1 else 0 end as seen
      from public.daily_quiz_questions b
      where b.active
      order by seen, draw
      limit 3
    ) q;
    if v_questions is null or jsonb_array_length(v_questions) <> 3 then raise exception 'err.dailySetup'; end if;
    insert into public.daily_quiz_attempts (user_id, quiz_day, questions, created_at)
    values (v_uid, v_day, v_questions, v_now);
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  return jsonb_build_object('replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.start_daily_quiz(uuid,date) from public, anon, authenticated;
grant execute on function public.start_daily_quiz(uuid,date) to authenticated;

/* Calendar browsing for any month, owner-scoped and read-only. It returns the
   real check-in ledger only, never activity/streak rows, and never awards a
   reward. Days after the server's Vietnam day are simply absent. */
create or replace function public.my_daily_checkin_month(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
  v_from date;
  v_to date;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_month is null then raise exception 'err.dailyDayChanged'; end if;
  v_day := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_from := date_trunc('month', p_month)::date;
  v_to := (date_trunc('month', v_from) + interval '1 month - 1 day')::date;
  if v_to > v_day then v_to := v_day; end if;
  return jsonb_build_object(
    'user_id', v_uid,
    'month', to_char(v_from, 'YYYY-MM'),
    'day', v_day,
    'days', coalesce((
      select jsonb_agg(c.reward_day order by c.reward_day)
      from public.daily_login_rewards c
      where c.user_id = v_uid and c.reward_day >= v_from and c.reward_day <= v_to
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.my_daily_checkin_month(date) from public, anon, authenticated;
grant execute on function public.my_daily_checkin_month(date) to authenticated;

notify pgrst, 'reload schema';
commit;

-- BEGIN DAILY QUIZ SCHEMA: mirror 20261115_daily_quiz_schema.sql
-- Five-question Daily Quiz — tables, columns, constraints and configuration.
-- Run AFTER 20261114_daily_rewards_upgrade.sql, BEFORE
-- 20261116_daily_quiz_rpcs.sql. Rerunnable.
--
-- The quiz can only draw from source-validated questions: the 99 legacy bank
-- questions stay in the table for non-voting practice/legacy use and are
-- marked so that no code path can mistake them for production material. They
-- can be promoted one at a time after research (see docs/DAILY-QUIZ-PLAN.md).
begin;


-- =========================================================
-- 1. CONFIGURATION
-- =========================================================
-- One row per switch. Everything the product owner may need to change later
-- lives here; nothing below hard-codes a reward, a quota or a flag.
create table if not exists public.daily_quiz_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.daily_quiz_config enable row level security;
revoke all on public.daily_quiz_config from public, anon, authenticated;
grant all on public.daily_quiz_config to service_role;

insert into public.daily_quiz_config (key, value) values
  -- Set size and difficulty mix -------------------------------------------
  ('questions_per_day',          '5'),
  ('easy_count',                 '2'),
  ('medium_count',               '3'),
  ('hard_count',                 '0'),
  ('hard_question_enabled',      'false'),
  ('max_hard_per_set',           '1'),
  ('min_hard_pool_to_enable',    '30'),
  -- Diversity --------------------------------------------------------------
  ('min_distinct_artists',       '3'),
  ('max_per_artist',             '2'),
  ('min_profile',                '1'),
  ('min_lyrics',                 '1'),
  ('max_true_false',             '1'),
  ('max_lyrics_keyword',         '1'),
  -- Quality gates ---------------------------------------------------------
  ('repeat_cooldown_days',       '90'),
  ('freshness_days',             '30'),
  ('min_quality_score',          '97'),
  ('max_source_redirects',       '3'),
  -- Votes -----------------------------------------------------------------
  ('daily_vote_cap',             '5'),
  ('free_vote_grant_enabled',    'false'),
  ('free_votes_per_day',         '3'),
  ('global_daily_vote_cap_enabled', 'false'),
  ('global_daily_vote_cap',      '5'),
  -- Legacy bank: kept for practice only, never for votes -------------------
  ('legacy_pool_enabled',        'false')
on conflict (key) do nothing;

-- Typed readers. Defaults are the safe side of every switch: a missing or
-- unreadable row must never widen the pool or raise a cap.
create or replace function public.daily_quiz_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::int from public.daily_quiz_config where key = p_key), p_default)
$$;

create or replace function public.daily_quiz_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::boolean from public.daily_quiz_config where key = p_key), p_default)
$$;

create or replace function public.daily_quiz_num(p_key text)
returns float8 language sql stable security definer set search_path = public as $$
  select (select nullif(value #>> '{}', '')::float8 from public.daily_quiz_config where key = p_key)
$$;

revoke all on function public.daily_quiz_int(text,int),
                       public.daily_quiz_bool(text,boolean),
                       public.daily_quiz_num(text) from public, anon, authenticated;

-- =========================================================
-- 2. QUESTION BANK: source, review and diversity metadata
-- =========================================================
alter table public.daily_quiz_questions
  add column if not exists option_ids        text[] not null default array['opt-a','opt-b','opt-c','opt-d'],
  add column if not exists artist            text,
  add column if not exists difficulty        text not null default 'easy',
  add column if not exists sub_category      text not null default 'profile',
  add column if not exists question_type     text not null default 'mcq',
  add column if not exists fact_key          text,
  add column if not exists song_key          text,
  add column if not exists quality_score     int,
  add column if not exists approval_status   text not null default 'draft',
  add column if not exists daily_eligibility_status text not null default 'ineligible',
  add column if not exists retirement_status text not null default 'active',
  add column if not exists source_url        text,
  add column if not exists source_initial_http_status text,
  add column if not exists source_final_http_status   text,
  add column if not exists source_final_url           text,
  add column if not exists source_redirect_count      text,
  add column if not exists source_access_status       text,
  add column if not exists source_fact_match          text,
  add column if not exists source_last_checked        date,
  add column if not exists safety_flags      text[] not null default '{}',
  add column if not exists copyright_flags   text[] not null default '{}',
  add column if not exists duplicate_of      text references public.daily_quiz_questions(id);

-- The 99 legacy questions have never been source-validated. Mark them as what
-- they are so no code path can mistake them for production material. They stay
-- in the table (practice/legacy use, future research) but are NOT eligible:
-- eligibility below requires approval_status = 'approved'.
update public.daily_quiz_questions
   set source_fact_match          = coalesce(source_fact_match, 'pending_external_validation'),
       source_access_status       = coalesce(source_access_status, 'unknown_not_observable'),
       source_initial_http_status = coalesce(source_initial_http_status, 'unknown_not_observable'),
       source_final_http_status   = coalesce(source_final_http_status, 'unknown_not_observable'),
       source_redirect_count      = coalesce(source_redirect_count, 'unknown_not_observable')
 where coalesce(source_final_url, '') = '';

-- Legacy rows were filed under a display category only; mirror it so the
-- future research queue can be triaged by sub-category.
update public.daily_quiz_questions
   set sub_category = 'lyrics'
 where coalesce(source_final_url, '') = ''
   and category = 'Lyrics'
   and sub_category = 'profile';

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_difficulty_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_difficulty_check
  check (difficulty in ('easy','medium','hard'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_sub_category_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_sub_category_check
  check (sub_category in ('profile','lyrics','lyrics_keyword'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_question_type_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_question_type_check
  check (question_type in ('mcq','true_false'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_approval_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_approval_check
  check (approval_status in ('draft','pending_verification','approved','rejected'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_eligibility_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_eligibility_check
  check (daily_eligibility_status in ('eligible','temporarily_ineligible','ineligible'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_retirement_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_retirement_check
  check (retirement_status in ('active','review_required','retired','superseded'));

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_quality_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_quality_check
  check (quality_score is null or quality_score between 0 and 100);

alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_option_ids_check;
alter table public.daily_quiz_questions add constraint daily_quiz_questions_option_ids_check
  check (cardinality(option_ids) = 4
     and option_ids[1] <> option_ids[2] and option_ids[1] <> option_ids[3] and option_ids[1] <> option_ids[4]
     and option_ids[2] <> option_ids[3] and option_ids[2] <> option_ids[4] and option_ids[3] <> option_ids[4]);

-- Stable option identity: an id that survives client-side shuffling. It is
-- DERIVED from the canonical order, so the frozen snapshot and the live row can
-- never disagree and no importer has to keep two fields in sync by hand.
alter table public.daily_quiz_questions drop constraint if exists daily_quiz_questions_correct_id_check;
alter table public.daily_quiz_questions drop column if exists correct_option_id;
alter table public.daily_quiz_questions add column correct_option_id text
  generated always as (option_ids[correct_option + 1]) stored;

create index if not exists daily_quiz_questions_pool_idx
  on public.daily_quiz_questions (difficulty, artist)
  where approval_status = 'approved'
    and daily_eligibility_status = 'eligible'
    and retirement_status = 'active'
    and active;

-- =========================================================
-- 3. ATTEMPTS
-- =========================================================
alter table public.daily_quiz_attempts
  add column if not exists quiz_date      date,
  add column if not exists question_count int not null default 5,
  add column if not exists max_votes      int not null default 5,
  add column if not exists votes_awarded  int not null default 0,
  add column if not exists submitted_at   timestamptz,
  add column if not exists locked         boolean not null default false,
  add column if not exists selection      jsonb not null default '{}'::jsonb;

-- Historical 3-question rounds keep their real size; only new rounds are 5.
update public.daily_quiz_attempts
   set question_count = jsonb_array_length(questions)
 where question_count = 5
   and jsonb_array_length(questions) <> 5;

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_questions_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_questions_check
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) in (3,5));

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_score_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_score_check
  check (score is null or score between 0 and 5);

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_question_count_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_question_count_check
  check (question_count in (3,5));

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_max_votes_check;
-- The structural ceiling: no round can ever be worth more than 5 votes.
-- daily_quiz_config.daily_vote_cap may lower it, never raise it.
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_max_votes_check
  check (max_votes between 1 and 5);

alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_attempts_votes_awarded_check;
alter table public.daily_quiz_attempts add constraint daily_quiz_attempts_votes_awarded_check
  check (votes_awarded between 0 and 5);

-- New 5-question rounds are graded per answer in public.daily_quiz_answers, so
-- the attempt itself never carries answers/score. Legacy 3-question rounds keep
-- their original all-at-once shape untouched.
alter table public.daily_quiz_attempts drop constraint if exists daily_quiz_completion;
alter table public.daily_quiz_attempts add constraint daily_quiz_completion check (
  (question_count = 5 and answers is null and score is null and completed_at is null
                      and ((submitted_at is null and not locked)
                           or (submitted_at is not null and locked)))
  or (question_count = 3 and (
        (completed_at is null and answers is null and score is null)
     or (completed_at is not null and answers is not null and score is not null
         and cardinality(answers) = 3)))
);

create unique index if not exists daily_quiz_attempts_user_quiz_date_idx
  on public.daily_quiz_attempts (user_id, quiz_date)
  where quiz_date is not null;

-- =========================================================
-- 4. ANSWER LEDGER — the idempotency anchor
-- =========================================================
-- One row per (user, quiz date, question). The primary key is what makes a
-- replay, a retry, a second tab or a crafted duplicate a no-op instead of a
-- second vote. question_id is intentionally NOT a foreign key: the frozen
-- snapshot is the history, and deleting an edited question must never be able
-- to delete or resurrect an award.
create table if not exists public.daily_quiz_answers (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  quiz_date    date not null,
  question_id  text not null,
  attempt_id   uuid not null references public.daily_quiz_attempts(id) on delete cascade,
  option_id    text not null,
  correct      boolean not null,
  awarded      int not null default 0 check (awarded in (0,1)),
  answered_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, quiz_date, question_id)
);

create index if not exists daily_quiz_answers_day_idx
  on public.daily_quiz_answers (user_id, quiz_date);

-- =========================================================
-- 5. REPEAT HISTORY — 90-day cooldown
-- =========================================================
create table if not exists public.daily_quiz_seen (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  question_id text not null,
  last_seen   date not null,
  primary key (user_id, question_id)
);

create index if not exists daily_quiz_seen_recent_idx
  on public.daily_quiz_seen (user_id, last_seen);

alter table public.daily_quiz_answers enable row level security;
alter table public.daily_quiz_seen enable row level security;
revoke all on public.daily_quiz_answers, public.daily_quiz_seen from public, anon, authenticated;
grant all on public.daily_quiz_answers, public.daily_quiz_seen to service_role;

notify pgrst, 'reload schema';
commit;

-- BEGIN DAILY QUIZ POOL: mirror 20261116_daily_quiz_pool.sql
-- Five-question Daily Quiz — the eligible pool and the sanitized payload.
-- Run AFTER 20261115_daily_quiz_schema.sql, BEFORE 20261117_daily_quiz_flow.sql.
--
-- Eligibility is decided here and nowhere else: approval, daily eligibility,
-- retirement, quality score, safety/copyright flags, duplicate marker, fact
-- match, access status, a measured final HTTP 200, a final URL, a redirect
-- count inside the limit and a fresh last-checked date. Hard questions are
-- excluded while daily_quiz_config.hard_question_enabled is false.
begin;

-- 6. ELIGIBLE POOL
-- =========================================================
-- The only place that decides whether a question may ever award a vote.
-- Legacy/unverified rows fail here on approval_status, source_fact_match and
-- the measured HTTP fields; there is no override and no relaxation.
create or replace function public.daily_quiz_candidates(p_uid uuid, p_day date)
returns table (
  id text, prompt text, options jsonb, option_ids text[], correct_option int,
  correct_option_id text, explanation text, category text, difficulty text,
  sub_category text, question_type text, artist text, fact_key text, song_key text,
  seen_recently boolean
)
language sql stable security definer set search_path = public as $$
  select q.id, q.prompt, q.options, q.option_ids, q.correct_option, q.correct_option_id,
         q.explanation, q.category, q.difficulty, q.sub_category, q.question_type,
         q.artist, q.fact_key, q.song_key,
         exists (select 1 from public.daily_quiz_seen s
                  where s.user_id = p_uid
                    and s.question_id = q.id
                    and s.last_seen > p_day - public.daily_quiz_int('repeat_cooldown_days', 90)) as seen_recently
    from public.daily_quiz_questions q
   where q.active
     and q.approval_status = 'approved'
     and q.daily_eligibility_status = 'eligible'
     and q.retirement_status = 'active'
     and q.duplicate_of is null
     and coalesce(cardinality(q.safety_flags), 0) = 0
     and coalesce(cardinality(q.copyright_flags), 0) = 0
     and coalesce(q.quality_score, 0) >= public.daily_quiz_int('min_quality_score', 97)
     and q.source_fact_match = 'pass'
     and q.source_access_status in ('public_accessible','accessible_with_redirect')
     and q.source_final_http_status = '200'
     and coalesce(q.source_final_url, '') <> ''
     and coalesce(nullif(q.source_redirect_count, '')::int, 99)
         <= public.daily_quiz_int('max_source_redirects', 3)
     and q.source_last_checked is not null
     and q.source_last_checked > p_day - public.daily_quiz_int('freshness_days', 30)
     and (q.difficulty <> 'hard'
          or (public.daily_quiz_bool('hard_question_enabled', false)
              and public.daily_quiz_bool('legacy_pool_enabled', false) is not null))
$$;
revoke all on function public.daily_quiz_candidates(uuid,date) from public, anon, authenticated;

create or replace function public.daily_quiz_pool(p_uid uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total',  count(*),
    'easy',   count(*) filter (where difficulty = 'easy'),
    'medium', count(*) filter (where difficulty = 'medium'),
    'hard',   count(*) filter (where difficulty = 'hard'))
  from public.daily_quiz_candidates(p_uid, p_day);
$$;
revoke all on function public.daily_quiz_pool(uuid,date) from public, anon, authenticated;

-- Difficulty mix for one round, clamped to what the pool can actually supply.
-- Hard questions only enter the mix when the flag is on AND the validated hard
-- pool has reached min_hard_pool_to_enable.
create or replace function public.daily_quiz_mix(p_pool jsonb)
returns table (need_easy int, need_medium int, need_hard int)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_total  int := public.daily_quiz_int('questions_per_day', 5);
  v_easy   int := public.daily_quiz_int('easy_count', 2);
  v_medium int := public.daily_quiz_int('medium_count', 3);
  v_hard   int := public.daily_quiz_int('hard_count', 0);
  v_pool_hard   int := coalesce((p_pool ->> 'hard')::int, 0);
  v_pool_medium int := coalesce((p_pool ->> 'medium')::int, 0);
  v_pool_easy   int := coalesce((p_pool ->> 'easy')::int, 0);
  v_hard_on boolean := public.daily_quiz_bool('hard_question_enabled', false)
                       and v_pool_hard >= public.daily_quiz_int('min_hard_pool_to_enable', 30);
  v_options jsonb := '[]'::jsonb;
  v_pick jsonb;
  v_seed float8;
begin
  -- Deterministic for tests: daily_quiz_config.random_seed, when present,
  -- pins the Postgres RNG for the whole session.
  v_seed := public.daily_quiz_num('random_seed');
  if v_seed is not null then perform setseed(v_seed); end if;

  v_options := v_options || jsonb_build_array(jsonb_build_array(v_easy, v_medium, v_hard));
  if v_hard_on then
    -- Ranges once hard questions are enabled: 1-2 easy / 2-3 medium / 0-1 hard.
    v_options := v_options || jsonb_build_array(
      jsonb_build_array(v_easy - 1, v_medium, v_hard + 1),
      jsonb_build_array(v_easy, v_medium - 1, v_hard + 1));
  end if;

  v_pick := v_options -> (floor(random() * jsonb_array_length(v_options))::int);
  v_hard   := least(coalesce((v_pick ->> 2)::int, 0), v_pool_hard, public.daily_quiz_int('max_hard_per_set', 1));
  v_medium := least(coalesce((v_pick ->> 1)::int, 0), v_pool_medium);
  v_easy   := greatest(0, v_total - v_hard - v_medium);
  -- Whatever easy cannot cover is pushed back onto medium, then reported as
  -- infeasible by the caller if the pool still falls short.
  if v_easy > v_pool_easy then
    v_medium := least(v_medium + (v_easy - v_pool_easy), v_pool_medium);
    v_easy   := greatest(0, v_total - v_hard - v_medium);
  end if;
  return query select v_easy, v_medium, v_hard;
end $$;
revoke all on function public.daily_quiz_mix(jsonb) from public, anon, authenticated;

-- Greedy draw with randomized retries. Returns 5 ids when the constraints can
-- be met at this relaxation level, 0 rows otherwise.
create or replace function public.daily_quiz_pick(
  p_uid uuid, p_day date,
  p_need_easy int, p_need_medium int, p_need_hard int,
  p_unseen_only boolean, p_min_artists int,
  p_require_profile boolean, p_require_lyrics boolean,
  p_attempts int default 60
)
returns table (question_id text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_max_artist int := public.daily_quiz_int('max_per_artist', 2);
  v_max_tf     int := public.daily_quiz_int('max_true_false', 1);
  v_max_lk     int := public.daily_quiz_int('max_lyrics_keyword', 1);
  v_try int;
  v_pool jsonb;
  v_item jsonb;
  v_i int;
  v_diff text;
  v_picked text[] := '{}';
  v_artists text[] := '{}';
  v_facts text[] := '{}';
  v_songs text[] := '{}';
  v_tf int;
  v_lk int;
  v_profile int;
  v_lyrics int;
  v_counts jsonb;
  v_need jsonb := jsonb_build_object('easy', p_need_easy, 'medium', p_need_medium, 'hard', p_need_hard);
begin
  for v_try in 1 .. greatest(p_attempts, 1) loop
    -- Interleave artists (row_number per artist) so the first picks naturally
    -- come from different artists, then randomize inside each artist.
    select coalesce(jsonb_agg(x.item order by x.ar, x.r), '[]'::jsonb)
      into v_pool
      from (
        select c.item, c.ar, random() as r
          from (
            select jsonb_build_object(
                     'id', q.id, 'difficulty', q.difficulty,
                     'sub_category', q.sub_category, 'question_type', q.question_type,
                     'artist', coalesce(q.artist, 'unknown'),
                     'fact', coalesce(q.fact_key, 'fact:' || q.id),
                     'song', coalesce(q.song_key, 'song:' || q.id)) as item,
                   row_number() over (partition by coalesce(q.artist, 'unknown') order by random()) as ar
              from public.daily_quiz_candidates(p_uid, p_day) q
             where (not p_unseen_only or not q.seen_recently)
          ) c
      ) x;

    v_picked  := '{}';
    v_artists := '{}';
    v_facts   := '{}';
    v_songs   := '{}';
    v_tf      := 0;
    v_lk      := 0;
    v_profile := 0;
    v_lyrics  := 0;
    v_counts  := jsonb_build_object('easy', 0, 'medium', 0, 'hard', 0);

    for v_i in 0 .. jsonb_array_length(v_pool) - 1 loop
      v_item := v_pool -> v_i;
      v_diff := v_item ->> 'difficulty';

      continue when (v_counts ->> v_diff)::int >= coalesce((v_need ->> v_diff)::int, 0);
      continue when v_item ->> 'question_type' = 'true_false' and v_tf >= v_max_tf;
      continue when v_item ->> 'sub_category' = 'lyrics_keyword' and v_lk >= v_max_lk;
      continue when (select count(*) from unnest(v_artists) a where a = v_item ->> 'artist') >= v_max_artist;
      continue when v_item ->> 'fact' = any (v_facts);
      continue when v_item ->> 'song' = any (v_songs);

      v_picked  := v_picked || (v_item ->> 'id');
      v_artists := v_artists || (v_item ->> 'artist');
      v_facts   := v_facts   || (v_item ->> 'fact');
      v_songs   := v_songs   || (v_item ->> 'song');
      v_counts  := jsonb_set(v_counts, array[v_diff], to_jsonb((v_counts ->> v_diff)::int + 1));
      if v_item ->> 'question_type' = 'true_false' then v_tf := v_tf + 1; end if;
      if v_item ->> 'sub_category' = 'lyrics_keyword' then v_lk := v_lk + 1; end if;
      if v_item ->> 'sub_category' = 'profile' then v_profile := v_profile + 1; end if;
      if v_item ->> 'sub_category' in ('lyrics','lyrics_keyword') then v_lyrics := v_lyrics + 1; end if;
    end loop;

    if coalesce(array_length(v_picked, 1), 0) = public.daily_quiz_int('questions_per_day', 5)
       and (select count(distinct a) from unnest(v_artists) a) >= p_min_artists
       and (not p_require_profile or v_profile >= public.daily_quiz_int('min_profile', 1))
       and (not p_require_lyrics or v_lyrics >= public.daily_quiz_int('min_lyrics', 1)) then
      return query select u from unnest(v_picked) u;
      return;
    end if;
  end loop;
end $$;
revoke all on function public.daily_quiz_pick(uuid,date,int,int,int,boolean,int,boolean,boolean,int)
  from public, anon, authenticated;

-- =========================================================
-- 7. SANITIZED PAYLOAD
-- =========================================================
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day),
  pool as (select public.daily_quiz_pool(p_uid, d.day) as p from d),
  mix as (select m.* from pool, public.daily_quiz_mix(pool.p) m),
  quiz_state as (
    select case
             when a.question_count <> 5 then 'retired'
             when a.locked then 'completed'
             else 'in_progress' end as state,
           a.*
      from public.daily_quiz_attempts a cross join d
     where a.user_id = p_uid and a.quiz_day = d.day
  )
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'credits', p.vote_credits + p.bonus_credits,
    'purchased', p.vote_credits,
    'bonus', p.bonus_credits,
    'login', jsonb_build_object('claimed', l.user_id is not null, 'reward', 2,
      'claimed_days', coalesce((
        select jsonb_agg(c.reward_day order by c.reward_day)
        from public.daily_login_rewards c
        where c.user_id = p_uid
          and c.reward_day >= date_trunc('month', d.day)::date
          and c.reward_day <= d.day
      ), '[]'::jsonb),
      'total_days', coalesce(st.total_days, 0),
      'first_day', st.first_day,
      'streak', case when st.last_day is null or st.last_day < d.day - 1 then 0 else st.run end,
      'best_streak', coalesce(st.best_streak, 0)),
    'earned_today', coalesce(l.reward, 0) + coalesce((select a.votes_awarded from quiz_state a), 0),
    'quiz', case
      when (select count(*) from quiz_state) = 0 then jsonb_build_object(
        'state', case when (select (p.p ->> 'total')::int from pool p) >= 5
                       and (select (p.p ->> 'easy')::int from pool p) >= (select mix.need_easy from mix)
                       and (select (p.p ->> 'medium')::int from pool p) >= (select mix.need_medium from mix)
                       and (select (p.p ->> 'hard')::int from pool p) >= (select mix.need_hard from mix)
                      then 'ready' else 'unavailable' end,
        'question_count', public.daily_quiz_int('questions_per_day', 5),
        'max_votes', public.daily_quiz_int('daily_vote_cap', 5),
        'pool', (select p.p from pool p))
      when (select state from quiz_state) = 'retired' then jsonb_build_object('state', 'retired')
      else jsonb_build_object(
        'state', (select state from quiz_state),
        'attempt_id', (select a.id from quiz_state a),
        'quiz_date', (select a.quiz_date from quiz_state a),
        'question_count', (select a.question_count from quiz_state a),
        'max_votes', (select a.max_votes from quiz_state a),
        'votes_awarded', (select a.votes_awarded from quiz_state a),
        'answered_count', (select count(*)::int from public.daily_quiz_answers w
                            where w.user_id = p_uid and w.quiz_date = d.day),
        'submitted_at', (select a.submitted_at from quiz_state a),
        'locked', (select a.locked from quiz_state a),
        'questions', (
          select jsonb_agg(
            jsonb_build_object('id', q.item ->> 'id', 'prompt', q.item ->> 'prompt',
              'options', q.item -> 'options', 'option_ids', q.item -> 'option_ids',
              'category', coalesce(q.item ->> 'category', 'Songs'),
              'difficulty', q.item ->> 'difficulty',
              'sub_category', q.item ->> 'sub_category',
              'question_type', q.item ->> 'question_type',
              'answered', w.question_id is not null)
            || case when w.question_id is null then '{}'::jsonb
               else jsonb_build_object('option_id', w.option_id, 'correct', w.correct,
                                       'awarded', w.awarded,
                                       'correct_option_id', q.item ->> 'correct_option_id',
                                       'explanation', q.item ->> 'explanation') end
            order by q.ord)
          from jsonb_array_elements((select a.questions from quiz_state a)) with ordinality as q(item, ord)
          left join public.daily_quiz_answers w
            on w.user_id = p_uid and w.quiz_date = d.day and w.question_id = q.item ->> 'id'
        )) end
  ) from d
  join public.profiles p on p.id = p_uid
  cross join pool
  left join lateral (
    select count(*)::int as total_days,
           min(c.reward_day) as first_day,
           (select max(x.reward_day) from public.daily_login_rewards x
             where x.user_id = p_uid and x.reward_day <= d.day) as last_day,
           coalesce((select max(runs.n) from (
             select count(*)::int as n from (
               select c2.reward_day - (row_number() over (order by c2.reward_day))::int as grp
               from public.daily_login_rewards c2 where c2.user_id = p_uid
             ) g group by g.grp
           ) runs), 0)::int as best_streak,
           coalesce((select count(*)::int from (
             select c3.reward_day - (row_number() over (order by c3.reward_day))::int as grp
             from public.daily_login_rewards c3
             where c3.user_id = p_uid and c3.reward_day <= d.day
           ) h group by h.grp order by h.grp desc limit 1), 0)::int as run
    from public.daily_login_rewards c
    where c.user_id = p_uid
  ) st on true
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

-- =========================================================

notify pgrst, 'reload schema';
commit;

-- BEGIN DAILY QUIZ FLOW: mirror 20261117_daily_quiz_flow.sql
-- Five-question Daily Quiz — start, per-answer submission and vote accounting.
-- Run AFTER 20261116_daily_quiz_pool.sql. Rerunnable.
--
-- Server-side rules (never decided by the browser):
--   · exactly 5 questions per user per quiz date (Asia/Ho_Chi_Minh),
--   · launch mix = exactly 2 easy + 3 medium, from the validated pool only,
--   · 1 correct answer = 1 bonus vote, hard cap 5 votes per user per quiz date,
--     enforced by unique (user_id, quiz_date, question_id) in the answer ledger,
--   · the automatic 3-free-votes/day grant is retired by configuration, so
--     Daily Quiz votes cannot stack with it.
begin;

-- 8. START
-- =========================================================
create or replace function public.start_daily_quiz(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_pool jsonb;
  v_easy int;
  v_medium int;
  v_hard int;
  v_ids text[];
  v_questions jsonb;
  v_level int;
  v_relaxed jsonb := '[]'::jsonb;
  v_replayed boolean;
  v_total int := public.daily_quiz_int('questions_per_day', 5);
  v_min_artists int := public.daily_quiz_int('min_distinct_artists', 3);
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daily_quiz:' || v_uid::text, 11));
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  select * into v_attempt from public.daily_quiz_attempts
    where user_id = v_uid and quiz_day = v_day;
  v_replayed := found;
  if v_replayed then
    return jsonb_build_object('attempt_id', v_attempt.id, 'quiz_date', v_attempt.quiz_date,
      'replayed', true, 'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
  end if;

  v_pool := public.daily_quiz_pool(v_uid, v_day);
  select m.need_easy, m.need_medium, m.need_hard into v_easy, v_medium, v_hard
    from public.daily_quiz_mix(v_pool) m;

  -- Not enough validated material: say so instead of falling back to the
  -- unverified legacy bank. This is a product state, not an error to hide.
  if coalesce((v_pool ->> 'easy')::int, 0) < v_easy
     or coalesce((v_pool ->> 'medium')::int, 0) < v_medium
     or coalesce((v_pool ->> 'hard')::int, 0) < v_hard
     or (v_easy + v_medium + v_hard) <> v_total then
    raise exception 'err.dailyQuizUnavailable';
  end if;

  -- Documented, deterministic relaxation ladder. Production eligibility,
  -- source validation, safety, the vote cap and the set size are NEVER relaxed.
  for v_level in 0 .. 3 loop
    select array(select p.question_id from public.daily_quiz_pick(
        v_uid, v_day, v_easy, v_medium, v_hard,
        v_level < 1,                                       -- 90-day cooldown
        case when v_level < 2 then v_min_artists else 0 end, -- distinct artists
        v_level < 3, v_level < 3) p)                        -- profile + lyrics minimums
      into v_ids;
    -- Every step taken is recorded, including the one that finally worked, so
    -- an auditor can see exactly which preferences had to give way.
    v_relaxed := v_relaxed || to_jsonb(v_level);
    if coalesce(array_length(v_ids, 1), 0) = v_total then exit; end if;
    v_relaxed := v_relaxed || to_jsonb(v_level);
  end loop;

  if coalesce(array_length(v_ids, 1), 0) <> v_total then
    raise exception 'err.dailyQuizUnavailable';
  end if;

  -- Freeze everything the round needs, private fields included. Later edits or
  -- retirements cannot change a round that has already been handed out.
  select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', q.options,
      'option_ids', q.option_ids, 'correct_option', q.correct_option,
      'correct_option_id', q.correct_option_id, 'explanation', q.explanation,
      'category', q.category, 'difficulty', q.difficulty, 'sub_category', q.sub_category,
      'question_type', q.question_type, 'artist', q.artist)
    order by array_position(v_ids, q.id))
    into v_questions
    from public.daily_quiz_questions q
   where q.id = any (v_ids);

  if v_questions is null or jsonb_array_length(v_questions) <> v_total then
    raise exception 'err.dailySetup';
  end if;

  insert into public.daily_quiz_attempts
    (user_id, quiz_day, quiz_date, questions, question_count, max_votes, created_at,
     selection)
  values (v_uid, v_day, v_day, v_questions, v_total,
          public.daily_quiz_int('daily_vote_cap', 5), v_now,
          jsonb_build_object('pool', v_pool, 'mix', jsonb_build_object(
            'easy', v_easy, 'medium', v_medium, 'hard', v_hard),
            'relaxed_steps', v_relaxed,
            'hard_enabled', public.daily_quiz_bool('hard_question_enabled', false)))
  returning * into v_attempt;

  insert into public.daily_quiz_seen (user_id, question_id, last_seen)
    select v_uid, u, v_day from unnest(v_ids) u
  on conflict (user_id, question_id)
    do update set last_seen = greatest(public.daily_quiz_seen.last_seen, excluded.last_seen);

  insert into public.activity_days (user_id, day) values (v_uid, v_day)
    on conflict (user_id, day) do nothing;

  return jsonb_build_object('attempt_id', v_attempt.id, 'quiz_date', v_attempt.quiz_date,
    'replayed', false, 'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.start_daily_quiz(uuid,date) from public, anon, authenticated;
grant execute on function public.start_daily_quiz(uuid,date) to authenticated;

-- =========================================================
-- 9. SUBMIT ONE ANSWER
-- =========================================================
create or replace function public.submit_daily_quiz_answer(
  p_expected_user_id uuid,
  p_attempt_id uuid,
  p_question_id text,
  p_option_id text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_item jsonb;
  v_correct boolean;
  v_awarded int := 0;
  v_cap int := public.daily_quiz_int('daily_vote_cap', 5);
  v_votes int;
  v_answered int;
  v_replayed boolean := false;
  v_stored public.daily_quiz_answers;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  if p_question_id is null or p_option_id is null then raise exception 'err.dailyQuizAnswers'; end if;

  -- Same lock order everywhere: profile, then advisory, then attempt.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daily_quiz:' || v_uid::text, 11));

  select * into v_attempt from public.daily_quiz_attempts
    where id = p_attempt_id and user_id = v_uid for update;
  if not found then raise exception 'err.dailyQuizSession'; end if;
  if v_attempt.question_count <> 5 then raise exception 'err.dailyQuizRetired'; end if;
  -- The award ceiling is the smaller of the configured cap and the ceiling
  -- frozen into the attempt at start time.
  v_cap := least(v_cap, v_attempt.max_votes);

  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if v_attempt.quiz_date is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  -- The question must be one this user was actually assigned, and the option
  -- must belong to that question. Both come from the frozen snapshot.
  select item into v_item
    from jsonb_array_elements(v_attempt.questions) item
   where item ->> 'id' = p_question_id;
  if v_item is null then raise exception 'err.dailyQuizQuestion'; end if;
  if not (p_option_id = any (array(select jsonb_array_elements_text(v_item -> 'option_ids')))) then
    raise exception 'err.dailyQuizOption';
  end if;

  -- Idempotency: one row per (user, quiz date, question) ever.
  select * into v_stored from public.daily_quiz_answers
    where user_id = v_uid and quiz_date = v_day and question_id = p_question_id;
  v_replayed := found;

  if not v_replayed then
    v_correct := (p_option_id = (v_item ->> 'correct_option_id'));
    select count(*)::int into v_votes from public.daily_quiz_answers
      where user_id = v_uid and quiz_date = v_day and awarded = 1;
    -- Cap is re-read after the locks, inside the same transaction.
    v_awarded := case when v_correct and v_votes < v_cap then 1 else 0 end;

    insert into public.daily_quiz_answers
      (user_id, quiz_date, question_id, attempt_id, option_id, correct, awarded, answered_at)
    values (v_uid, v_day, p_question_id, v_attempt.id, p_option_id, v_correct, v_awarded, v_now)
    on conflict (user_id, quiz_date, question_id) do nothing;

    if not found then
      -- A concurrent request (second tab, retry, replay) won the race: return
      -- its stored result instead of awarding anything.
      select * into v_stored from public.daily_quiz_answers
        where user_id = v_uid and quiz_date = v_day and question_id = p_question_id;
      v_replayed := true;
    else
      v_stored := null;
    end if;

    if not v_replayed then
      if v_awarded = 1 then
        update public.profiles set bonus_credits = bonus_credits + 1 where id = v_uid;
      end if;
      insert into public.activity_days (user_id, day) values (v_uid, v_day)
        on conflict (user_id, day) do nothing;
    end if;
  end if;

  select count(*)::int into v_votes from public.daily_quiz_answers
    where user_id = v_uid and quiz_date = v_day and awarded = 1;
  select count(*)::int into v_answered from public.daily_quiz_answers
    where user_id = v_uid and quiz_date = v_day;

  if not v_replayed then
    update public.daily_quiz_attempts
       set votes_awarded = v_votes,
           locked        = (v_answered >= v_attempt.question_count),
           submitted_at  = case when v_answered >= v_attempt.question_count then v_now else null end
     where id = v_attempt.id;
  end if;

  return jsonb_build_object(
    'question_id', p_question_id,
    'replayed', v_replayed,
    'correct', coalesce(v_stored.correct,
      (p_option_id = (v_item ->> 'correct_option_id'))),
    'option_id', coalesce(v_stored.option_id, p_option_id),
    'correct_option_id', v_item ->> 'correct_option_id',
    'explanation', v_item ->> 'explanation',
    'awarded', coalesce(v_stored.awarded, v_awarded),
    'votes_awarded', v_votes,
    'answered_count', v_answered,
    'question_count', v_attempt.question_count,
    'locked', (v_answered >= v_attempt.question_count),
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.submit_daily_quiz_answer(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.submit_daily_quiz_answer(uuid,uuid,text,text) to authenticated;

-- The old all-at-once path graded the unverified legacy bank. Retired: no
-- round created before this migration may award votes from unvalidated
-- questions, and no new round can use this signature.
create or replace function public.submit_daily_quiz(p_expected_user_id uuid, p_attempt_id uuid, p_answers int[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  raise exception 'err.dailyQuizRetired';
end $$;
revoke all on function public.submit_daily_quiz(uuid,uuid,int[]) from public, anon, authenticated;

-- =========================================================
-- 10. VOTES: Daily Quiz accounting, and the retired free grant
-- =========================================================
-- Votes a user has actually earned from the quiz today. Read by the grant and
-- cap logic; never by the client.
create or replace function public.daily_quiz_votes_on(p_uid uuid, p_day date)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.daily_quiz_answers
   where user_id = p_uid and quiz_date = p_day and awarded = 1;
$$;
revoke all on function public.daily_quiz_votes_on(uuid,date) from public, anon, authenticated;

-- How many automatic free votes the account gets today. With
-- free_vote_grant_enabled = false (the launch policy) the answer is 0: a user
-- earns votes through Daily Quiz answers, or buys them. Turning the switch
-- back on restores the old per-day grant, optionally shared with quiz votes
-- under one global cap.
create or replace function public.daily_free_vote_grant(p_uid uuid, p_day date)
returns int language sql stable security definer set search_path = public as $$
  select case
    when not public.daily_quiz_bool('free_vote_grant_enabled', false) then 0
    when public.daily_quiz_bool('global_daily_vote_cap_enabled', false) then
      greatest(0, least(public.daily_quiz_int('free_votes_per_day', 3),
                        public.daily_quiz_int('global_daily_vote_cap', 5)
                        - public.daily_quiz_votes_on(p_uid, p_day)))
    else greatest(0, public.daily_quiz_int('free_votes_per_day', 3))
  end;
$$;
revoke all on function public.daily_free_vote_grant(uuid,date) from public, anon, authenticated;

create or replace function public.my_vote_status()
returns table (free_used int, free_limit int, credits int, purchased int, bonus int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  return query
    select
      (select count(*)::int from public.votes
        where user_id = v_uid and used_credit = false and vote_day = v_day),
      public.daily_free_vote_grant(v_uid, v_day),
      (select vote_credits + bonus_credits from public.profiles where id = v_uid),
      (select vote_credits from public.profiles where id = v_uid),
      (select bonus_credits from public.profiles where id = v_uid);
end $$;

create or replace function public.cast_vote(
  p_request_id uuid,
  p_delta int default 1,
  p_fp_hash text default null,
  p_ip_hash text default null,
  p_gate_token text default null
)
returns table (votes int, my_votes int, free_used int, credits int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_day       date;
  v_new       int;
  v_status    text;
  v_picked    timestamptz;
  v_mine      int;
  v_n         int;
  v_purch     int;
  v_bonus     int;
  v_credit    int;
  v_freeUsed  int;
  v_fpUsed    int := 0;
  v_grant     int;
  v_freeLeft  int;
  v_fpLeft    int;
  v_useFree   int;
  v_useCred   int;
  v_useBonus  int;
  v_usePurch  int;
  v_capped    boolean := false;
  v_refBonus  int;
  v_refPurch  int;
begin
  if v_uid is null then raise exception 'err.voteAuth'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'err.voteQty'; end if;

  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.voteGate'; end if;

  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

  select r.status, r.picked_at into v_status, v_picked
    from public.requests r where r.id = p_request_id;
  if v_status is null then raise exception 'err.requestMissing'; end if;
  if v_status not in ('queued','in_progress') then raise exception 'err.voteClosed'; end if;
  if v_picked is not null then raise exception 'err.voteLocked'; end if;

  select p.vote_credits, p.bonus_credits into v_purch, v_bonus
    from public.profiles p where p.id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  if p_fp_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_fp_hash, 3));
  end if;

  v_n     := abs(p_delta);
  v_day   := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_grant := public.daily_free_vote_grant(v_uid, v_day);
  v_credit := v_purch + v_bonus;

  if p_delta < 0 then
    select count(*) into v_mine from public.votes
     where request_id = p_request_id and user_id = v_uid;
    if v_mine < v_n then raise exception 'err.notVoted'; end if;

    with doomed as (
      select id, credit_kind, used_credit from public.votes
       where request_id = p_request_id and user_id = v_uid
       order by created_at desc, id desc
       limit v_n
    ), gone as (
      delete from public.votes v using doomed d where v.id = d.id
      returning v.credit_kind, v.used_credit
    )
    select
      count(*) filter (where credit_kind = 'bonus'),
      count(*) filter (where credit_kind = 'purchased'
                          or (credit_kind is null and used_credit))
      into v_refBonus, v_refPurch
    from gone;

    if coalesce(v_refBonus, 0) > 0 or coalesce(v_refPurch, 0) > 0 then
      update public.profiles
         set bonus_credits = bonus_credits + coalesce(v_refBonus, 0),
             vote_credits  = vote_credits  + coalesce(v_refPurch, 0)
       where id = v_uid;
    end if;

    update public.requests r set votes = greatest(r.votes - v_n, 0), updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  else
    select count(*)::int into v_freeUsed from public.votes
     where user_id = v_uid and used_credit = false and vote_day = v_day;
    v_freeLeft := greatest(v_grant - v_freeUsed, 0);

    -- Hạn mức vân tay: đếm CHUNG mọi tài khoản trên cùng một trình duyệt.
    v_fpLeft := v_freeLeft;
    if p_fp_hash is not null then
      select count(*)::int into v_fpUsed from public.votes
       where fp_hash = p_fp_hash and used_credit = false and vote_day = v_day;
      v_fpLeft := greatest(v_grant - v_fpUsed, 0);
      if v_fpLeft < v_freeLeft then v_capped := true; end if;
    end if;

    v_useFree := least(v_n, v_freeLeft, v_fpLeft);
    v_useCred := v_n - v_useFree;

    if v_useCred > v_credit then
      if v_capped and v_useCred > 0 then
        raise exception 'err.voteFpLimit' using detail = v_fpLeft::text;
      end if;
      raise exception 'err.notEnoughVotes' using detail = (v_freeLeft + v_credit)::text;
    end if;

    v_useBonus := least(v_useCred, v_bonus);
    v_usePurch := v_useCred - v_useBonus;

    if v_useCred > 0 then
      update public.profiles
         set bonus_credits = bonus_credits - v_useBonus,
             vote_credits  = vote_credits  - v_usePurch
       where id = v_uid;
    end if;

    insert into public.votes (
      request_id, user_id, used_credit, credit_kind,
      vote_day, free_slot, fp_slot, fp_hash, ip_hash
    )
    select
      p_request_id, v_uid, g.i > v_useFree,
      case when g.i <= v_useFree                then 'free'
           when g.i <= v_useFree + v_useBonus   then 'bonus'
           else 'purchased' end,
      v_day,
      case when g.i <= v_useFree then (v_freeUsed + g.i)::smallint end,
      case when g.i <= v_useFree and p_fp_hash is not null
           then (v_fpUsed + g.i)::smallint end,
      p_fp_hash, p_ip_hash
    from generate_series(1, v_n) as g(i);

    update public.requests r set votes = r.votes + v_n, updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  end if;

  select count(*)::int into v_mine from public.votes
   where request_id = p_request_id and user_id = v_uid;
  select s.free_used, s.credits into v_freeUsed, v_credit from public.my_vote_status() s;
  return query select v_new, v_mine, v_freeUsed, v_credit;
end $$;

notify pgrst, 'reload schema';
commit;
