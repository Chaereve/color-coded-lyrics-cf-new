-- Rollback for 20261228_bonus_refund_and_priority.
-- ONLY safe before any refund has been recorded under this migration.
-- Once a refund ledger row / refund notification exists, restoring the old
-- schema would discard wallet-refund history; restore a pre-migration backup
-- instead. Run only with explicit approval.
begin;

do $$
begin
  if (to_regclass('public.bonus_request_refunds') is not null
      and exists (select 1 from public.bonus_request_refunds))
     or exists (select 1 from public.notifications where kind = 'bonus_refunded') then
    raise exception 'err.bonusRefundRollbackBlocked';
  end if;
end $$;

drop trigger if exists requests_refund_bonus on public.requests;
drop function if exists public.refund_bonus_request();
drop table if exists public.bonus_request_refunds;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('near','lead','approved','picked','started','progress','done','denied','votes','expired',
   'comment','reply','mention','order_paid','order_rejected','order_expired'));

create or replace function public.admin_expire_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'err.requestMissing'; end if;
  if r.picked_at is not null or r.status not in ('pending','queued') then
    raise exception 'err.expiryLocked';
  end if;
  if r.user_id is not null and exists (select 1 from public.profiles p where p.id = r.user_id) then
    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (
      r.user_id, public.song_key(r.artist, r.title), 'expired', r.id, r.title, r.artist,
      'This request expired after one month and was deleted.',
      'expiry-user|' || r.id::text
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end if;
  delete from public.requests where id = r.id;
end $$;

revoke all on function public.admin_expire_request(uuid) from public, anon, authenticated;
grant execute on function public.admin_expire_request(uuid) to authenticated;

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
  if not force and coalesce((cfg->>'paused')::boolean, false) then
    return;
  end if;

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
     set value = coalesce(cfg, '{}'::jsonb) || jsonb_build_object(
           'last_pick_at',    now(),
           'next_pick_at',    now() + make_interval(days => days),
           'last_request_id', r.id),
         updated_at = now()
   where key = 'pick';

  if found then return next r; end if;
end $$;

revoke all on function public.pick_top_request(boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
