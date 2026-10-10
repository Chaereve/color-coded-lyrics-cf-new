-- ROLLBACK of 20261203_mystery_month.sql — drop the month history RPC only.
begin;
drop function if exists public.my_mystery_month(date);
notify pgrst, 'reload schema';
commit;
