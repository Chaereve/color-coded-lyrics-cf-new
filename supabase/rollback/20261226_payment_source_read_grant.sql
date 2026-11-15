-- Rollback only together with a frontend that no longer selects payment_source.
-- Revoking this while the deployed client still selects the column will break
-- the public board again. Private columns remain untouched.
revoke select (payment_source) on public.requests from anon, authenticated;
notify pgrst, 'reload schema';
