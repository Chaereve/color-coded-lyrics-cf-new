-- Color Coded Lyrics — phieu nhan trong mua (2026-09-26)
--
-- Chay 1 lan trong Supabase SQL Editor. Chay lai van an toan: chi co
-- create index if not exists + create or replace function, khong
-- DROP/TRUNCATE bang nao, du lieu giu nguyen.
--
-- Khoi "This week" (trang chu) va bang xep hang mua (tuan/thang) dem
-- "vote NHAN TRONG MUA": request nao nhan >= 1 vote trong cua so (ke ca bai
-- gui tu truoc) thuoc ve mua do — quyet dinh chu du an 26/09.
--
-- Vi sao la ham SECURITY DEFINER thay cho SELECT thang: RLS tren votes chi
-- cho doc hang CUA MINH, ma "bai nao nhan duoc bao nhieu phieu trong tuan" la
-- so cua CA CONG DONG. Ham chi tra hai truong cong khai — request_id (da cong
-- khai tren bang requests) + created_at — KHONG BAO GIHO user_id, nen khong lo
-- nguoi nao da vote bai nao.
--
-- p_since la moc do client gui (luon ~ "hom nay - 31 ngay"); ham cat tran
-- 10.000 hang de mot project lon khong tra ve payload khong lo cho moi lan
-- tai bang. Index tren created_at de cau tra loi khong quet ca bang khi so
-- phieu tang.

create index if not exists votes_created_idx on public.votes (created_at);

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

-- PostgREST co the giu schema cache cu mot luc sau khi sua ham.
notify pgrst, 'reload schema';
