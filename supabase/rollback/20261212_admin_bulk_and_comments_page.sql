-- Rollback for 20261212_admin_bulk_and_comments_page. Apply only after approval.
--
-- The migration is ADDITIVE: it creates five functions and one small text
-- helper, and changes no table, row, policy or grant that existed before it.
-- Rolling it back therefore only removes those functions.
--
-- Safe to run while the web client is newer than the database: src/lib/db.js
-- detects a missing RPC (PGRST202 / 42883) and falls back to the pre-20261212
-- paths — bulk actions go back to one admin_* call per id, and the comments
-- tab goes back to reading a 500-row window and paging it in the browser.
-- Nothing here touches requests, orders, votes or request_comments.
begin;

drop function if exists public.admin_comments_page(text, int, int);
drop function if exists public.admin_review_many(uuid[], boolean, text, text);
drop function if exists public.admin_update_many(uuid[], text, int, text, boolean, boolean, boolean, text, text);
drop function if exists public.admin_delete_many(uuid[]);
drop function if exists public.admin_pick_many(uuid[], boolean);
drop function if exists public.admin_fold(text);

-- PostgREST caches the function list; without this the removed RPCs can still
-- be routed to for a while and fail with a confusing 404/PGRST202.
notify pgrst, 'reload schema';

commit;
