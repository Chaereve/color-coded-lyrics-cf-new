-- Hotfix for 20261224_payment_source on production-style column privileges.
-- public.requests deliberately grants SELECT per column to anon/authenticated
-- so private columns (for example deny_reason) stay hidden. A newly added
-- column is NOT covered by those old column grants; clients that select
-- payment_source would get a permission error and the public board would fail
-- to load. payment_source is a public funding label, so grant just this column.
grant select (payment_source) on public.requests to anon, authenticated;
notify pgrst, 'reload schema';
