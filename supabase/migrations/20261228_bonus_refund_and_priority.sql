-- Bonus request refunds + explicit queue priority (money > bonus > free).
-- Append-only, one transaction, rerunnable. Not part of the baseline-20261120
-- fresh-install bundle; apply through the guarded runner after 20261227.
--
-- Refund policy approved by the project owner:
--   * only payment_source='bonus' requests;
--   * only while the request has not been picked and is not in production;
--   * denial, deletion, and expiry return exactly one bonus_requests credit;
--   * a request can be refunded at most once, even if it is denied then deleted;
--   * money orders, vote credits, votes, and request history are never rewritten.
--
-- The ledger has no FK to requests/profiles on purpose: it must survive request
-- deletion and account deletion, like reward_events. Clients cannot write it.

begin;

create table if not exists public.bonus_request_refunds (
  request_id uuid primary key,
  user_id    uuid not null,
  amount     integer not null default 1 check (amount = 1),
  reason     text not null check (reason in ('denied','deleted','expired')),
  actor_id   uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists bonus_request_refunds_user_idx
  on public.bonus_request_refunds (user_id, created_at desc);

alter table public.bonus_request_refunds enable row level security;
revoke all on public.bonus_request_refunds from public, anon, authenticated;
grant all on public.bonus_request_refunds to service_role;

comment on table public.bonus_request_refunds is
  'Append-only one-credit refunds for bonus-funded requests removed before production. request_id is the idempotency key; no FK so the audit survives request/account deletion.';

create or replace function public.refund_bonus_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reason text;
  v_uid uuid;
  v_inserted uuid;
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from 'denied' or old.status = 'denied' then
      return new;
    end if;
    v_reason := 'denied';
  else
    v_reason := case when old.expired_at is not null then 'expired' else 'deleted' end;
  end if;

  -- Use OLD funding/state: a denial must not be able to erase the source first
  -- and escape the refund, and a later edit cannot make an old money row bonus.
  if old.payment_source is distinct from 'bonus'
     or old.is_paid is distinct from true
     or old.payment_status is distinct from 'paid'
     or old.user_id is null
     or old.picked_at is not null
     or old.status not in ('pending','queued','denied') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- No wallet row (account deletion / imported seed): nothing to credit.
  select id into v_uid from public.profiles where id = old.user_id for update;
  if v_uid is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into public.bonus_request_refunds (request_id, user_id, amount, reason, actor_id)
  values (old.id, old.user_id, 1, v_reason, auth.uid())
  on conflict (request_id) do nothing
  returning request_id into v_inserted;

  if v_inserted is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  update public.profiles set bonus_requests = bonus_requests + 1
   where id = old.user_id;

  insert into public.notifications (user_id, song_key, kind, request_id, title, artist, sig)
  values (old.user_id, public.song_key(old.artist, old.title), 'bonus_refunded',
          old.id, old.title, old.artist, 'bonus-refund|' || old.id::text)
  on conflict (user_id, sig) where sig is not null do nothing;

  -- Visible audit in the existing admin/request history reader. The refund
  -- ledger is the idempotency book; this row is the human-readable trace and
  -- survives request deletion because admin_actions has no FK to requests.
  insert into public.admin_actions (actor, action, target_id, label, detail)
  values (auth.uid(), 'bonus_refund', old.id,
          left(coalesce(old.artist, '') || ' — ' || coalesce(old.title, ''), 200),
          jsonb_build_object('payment_source', 'bonus', 'amount', 1, 'reason', v_reason));

  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.refund_bonus_request() from public, anon, authenticated;

drop trigger if exists requests_refund_bonus on public.requests;
create trigger requests_refund_bonus
before update or delete on public.requests
for each row execute function public.refund_bonus_request();

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('near','lead','approved','picked','started','progress','done','denied','votes','expired',
   'comment','reply','mention','order_paid','order_rejected','order_expired','bonus_refunded'));

-- Mark expiry before the delete so the shared refund trigger can audit the
-- difference between an expired request and an ordinary removal. The update
-- itself does not refund; only the following delete does.
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

  update public.requests set expired_at = coalesce(expired_at, now()) where id = r.id;

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

-- Queue priority is now funding-aware. Unverified/awaiting money is not settled
-- money and fails closed to the free tier; legacy rows are not guessed upward.
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
     case
       when c.is_paid and c.payment_source = 'money' and c.payment_status = 'paid' then 2
       when c.is_paid and c.payment_source = 'bonus' and c.payment_status = 'paid' then 1
       else 0
     end desc,
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
