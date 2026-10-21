-- Rollback for 20261213_admin_actions_and_request_edit. Apply only after approval.
--
-- Removes the WRITE path and the two reading/editing functions. The
-- admin_actions TABLE and its rows are deliberately kept: it is history — the
-- record of who approved, denied, edited or deleted what. Dropping it would
-- destroy the only audit trail the project has, which is the opposite of a
-- rollback's job.
--
-- Safe to run while the web client is newer than the database: the Activity log
-- tab shows "apply migration 20261213" (src/lib/db.js maps PGRST202/42883 to
-- that state), the "Save details" button in the edit panel returns
-- err.databaseSetup, and nothing else changes. `admin_update` /
-- `admin_review` / `admin_pick_group` were never touched by the migration.
begin;

-- 1. Stop recording first, so nothing writes between the drops.
drop trigger if exists requests_admin_audit on public.requests;
drop trigger if exists orders_admin_audit on public.orders;
drop function if exists public.log_admin_action();
drop function if exists public.log_admin_order();

-- 2. Then the readers/editors.
drop function if exists public.admin_actions_page(int, int);
drop function if exists public.admin_request_edit(uuid, text, text, boolean, text);

-- 3. Keep the table, but close it: no further rows, still readable by admins.
revoke all on public.admin_actions from anon, authenticated;
grant select on public.admin_actions to authenticated;

notify pgrst, 'reload schema';

commit;
