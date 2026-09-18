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
drop policy if exists "read votes" on public.votes;
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
