-- Color Coded Lyrics — tra rieng vote da mua va bonus tu vong quay (2026-11-01)
--
-- Chay 1 lan trong Supabase SQL Editor. Chay lai van an toan: chi co drop /
-- create function va cap nhat jsonb; du lieu giu nguyen.
--
-- Du lieu da duoc tach san tu migration 20261031_bonus_reset.sql:
--   · profiles.vote_credits  = vote da mua (KHONG bao gio reset)
--   · profiles.bonus_credits = bonus tu vong quay (reset ve 0 vao 31/10)
-- Nhung ham tra ve tinh hinh vote chi tra TONG `credits`, nen giao dien buoc
-- phai gop chung 2 loai thanh mot dong "Purchased + bonus". Migration nay tra
-- them hai cot/key `purchased` va `bonus` (giu nguyen `credits` = tong de cac
-- client chua cap nhat van chay), de web hien thi moi loai mot dong.

begin;

-- 1) my_vote_status: them cot purchased (vote_credits) va bonus (bonus_credits).
--    Doi danh sach cot tra ve nen phai DROP function cu truoc (CREATE OR REPLACE
--    khong doi duoc RETURNS TABLE). cast_vote chi doc 2 cot dau (free_used,
--    credits) nen them cot khong anh huong no.
drop function if exists public.my_vote_status();

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

revoke all on function public.my_vote_status() from public, anon, authenticated;
grant execute on function public.my_vote_status() to authenticated;

-- 2) Payload vong quay: tra them `purchased` va `bonus` ben canh `credits`
--    (tong). Worker Edge tra nguyen jsonb nen khong can sua.
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

commit;

-- PostgREST co the giu schema cache cu mot luc sau khi sua ham.
notify pgrst, 'reload schema';
