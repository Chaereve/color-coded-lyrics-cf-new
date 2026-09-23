
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
