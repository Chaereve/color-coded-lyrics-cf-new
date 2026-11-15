-- Phase 1 manual-payment operations. No provider webhook and no automatic
-- claim that money arrived. New waiting orders get 72 hours; existing waiting
-- orders get a fresh 72-hour grace period at deploy, never retroactive expiry.
-- Historical paid/rejected dates stay NULL: created_at is not a receipt date.
begin;

alter table public.orders
  add column if not exists expires_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists expired_at timestamptz,
  add column if not exists resolution_reason text,
  add column if not exists payment_method text,
  add column if not exists received_currency text,
  add column if not exists received_amount numeric(14,2),
  add column if not exists payment_reference text;

update public.orders set expires_at = now() + interval '72 hours'
 where status = 'awaiting' and expires_at is null;
alter table public.orders alter column expires_at set default now() + interval '72 hours';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('awaiting','paid','rejected','expired'));
alter table public.orders drop constraint if exists orders_resolution_fields_check;
alter table public.orders add constraint orders_resolution_fields_check check (
  (status = 'awaiting' and paid_at is null and rejected_at is null and expired_at is null)
  or (status = 'paid' and rejected_at is null and expired_at is null)
  or (status = 'rejected' and paid_at is null and expired_at is null)
  or (status = 'expired' and expired_at is not null and paid_at is null and rejected_at is null)
);
alter table public.orders drop constraint if exists orders_payment_evidence_check;
alter table public.orders add constraint orders_payment_evidence_check check (
  (payment_method is null and received_currency is null and received_amount is null and payment_reference is null)
  or (status = 'paid' and paid_at is not null
    and payment_method in ('bank','paypal')
    and received_currency = case when payment_method = 'bank' then 'VND' else 'USD' end
    and received_amount > 0 and payment_reference = upper(regexp_replace(
      (case when kind = 'votes' then 'V-' else 'PR-' end) || id::text, '-', '', 'g')))
);
create index if not exists orders_expiry_idx on public.orders (expires_at)
  where status = 'awaiting';
create index if not exists orders_paid_at_idx on public.orders (paid_at desc)
  where status = 'paid';

-- Keep the old call name and named parameters. Evidence is mandatory for new
-- confirmations; the old two-argument approval now fails closed.
drop function if exists public.admin_order(uuid, boolean);
drop function if exists public.admin_order(uuid,boolean,text,numeric,text,text);
create function public.admin_order(
  p_order_id uuid, p_approve boolean,
  p_method text default null, p_amount numeric default null,
  p_reference text default null, p_reason text default null
) returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders; v_expected numeric; v_ref text;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'err.orderMissing'; end if;
  if o.status not in ('awaiting','expired') then raise exception 'err.orderLocked'; end if;

  if p_approve then
    -- A cached pre-lifecycle client sends only (id, approve). Defaults let the
    -- call resolve, so fail closed with an actionable refresh message instead
    -- of silently granting credits or pretending the missing receipt is valid.
    if p_method is null and p_amount is null and p_reference is null then
      raise exception 'err.paymentEvidenceRequired';
    end if;
    if p_method is null or p_method not in ('bank','paypal') then raise exception 'err.paymentMethodInvalid'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'err.paymentAmountInvalid'; end if;
    v_expected := case when p_method = 'bank' then o.amount_vnd else o.amount_usd end;
    if abs(p_amount - v_expected) > 0.001 then raise exception 'err.paymentAmountMismatch'; end if;
    v_ref := upper(regexp_replace(coalesce(p_reference,''), '[^A-Za-z0-9]', '', 'g'));
    if v_ref <> upper(regexp_replace((case when o.kind = 'votes' then 'V-' else 'PR-' end) || o.id::text, '-', '', 'g')) then
      raise exception 'err.paymentReferenceMismatch';
    end if;
    if o.kind = 'paid_request' and not exists (select 1 from public.requests where id = o.request_id) then
      raise exception 'err.requestMissing';
    end if;
    update public.orders set status = 'paid', paid_at = now(), expired_at = null,
      payment_method = p_method, received_currency = case when p_method = 'bank' then 'VND' else 'USD' end,
      received_amount = p_amount, payment_reference = v_ref,
      resolution_reason = nullif(left(trim(coalesce(p_reason,'')),300),'')
     where id = o.id returning * into o;
    if o.kind = 'votes' then
      update public.profiles set vote_credits = vote_credits + o.qty where id = o.user_id;
    else
      -- A late payment must not rewind completed/denied work back to queued.
      update public.requests set is_paid = true, payment_status = 'paid', payment_source = 'money',
        status = case when status = 'pending' then 'queued' else status end, updated_at = now()
       where id = o.request_id;
    end if;
  else
    update public.orders set status = 'rejected', rejected_at = now(), expired_at = null,
      resolution_reason = nullif(left(trim(coalesce(p_reason,'')),300),'')
     where id = o.id returning * into o;
    if o.kind = 'paid_request' then
      update public.requests set is_paid = false, payment_status = 'none', payment_source = null, updated_at = now()
       where id = o.request_id and payment_status = 'awaiting';
    end if;
  end if;
  return o;
end $$;
revoke all on function public.admin_order(uuid,boolean,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.admin_order(uuid,boolean,text,numeric,text,text) to authenticated;

-- Expiry releases the queue, never deletes the order/request and never asserts
-- that no transfer exists. A late transfer can still be reconciled by admin.
create or replace function public.expire_payment_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with gone as (
    update public.orders set status = 'expired', expired_at = now(),
      resolution_reason = 'payment_window_elapsed'
     where status = 'awaiting' and expires_at <= now()
    returning id, request_id, kind
  ), cleared as (
    update public.requests r set is_paid = false, payment_status = 'none',
      payment_source = null, updated_at = now()
     from gone g where r.id = g.request_id and g.kind = 'paid_request'
       and r.payment_status = 'awaiting'
    returning r.id
  ), audited as (
    -- cron has no auth.uid(), so the admin audit trigger deliberately skips it.
    -- Record the system transition explicitly; actor NULL means system.
    insert into public.admin_actions(actor, action, target_id, label, detail)
    select null, 'order', g.id, left(g.kind || ' · ' || g.id::text, 200),
      jsonb_build_object('status', jsonb_build_array('awaiting','expired'),
        'reason', 'payment_window_elapsed', 'actor_source', 'scheduler')
     from gone g
    returning 1
  )
  select count(*)::integer into v_count from gone;
  return v_count;
end $$;
revoke all on function public.expire_payment_orders() from public, anon, authenticated;
grant execute on function public.expire_payment_orders() to service_role;

-- Queue limits ignore expired orders even between cron runs.
create or replace function public.buy_votes(p_pack text, p_qty int, p_usd numeric, p_vnd int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_waiting int;
  o public.orders;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_qty <= 0 or p_qty > 100 then raise exception 'err.qty'; end if;
  if not (
    (p_pack = 'v3' and p_qty = 3 and p_usd = 0.49 and p_vnd = 13000) or
    (p_pack = 'v10' and p_qty = 10 and p_usd = 1.29 and p_vnd = 34000) or
    (p_pack = 'v30' and p_qty = 30 and p_usd = 2.99 and p_vnd = 78000) or
    (p_pack = 'custom' and p_usd = round(0.19 * p_qty, 2) and p_vnd = 5000 * p_qty)
  ) then raise exception 'err.priceChanged'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 20260924));
  select count(*) into v_waiting from public.orders
   where user_id = v_uid and kind = 'votes' and status = 'awaiting'
     and (expires_at is null or expires_at > now());
  if v_waiting >= 20 then raise exception 'err.orderQueueLimit'; end if;

  insert into public.orders (user_id, kind, pack, qty, amount_usd, amount_vnd)
  values (v_uid, 'votes', left(p_pack, 40), p_qty, p_usd, p_vnd)
  returning * into o;
  return o;
end $$;

revoke all on function public.buy_votes(text,int,numeric,int) from public, anon, authenticated;
grant execute on function public.buy_votes(text,int,numeric,int) to authenticated;

-- Only the quota predicate changes; funding rules stay exactly as 20261224.
create or replace function public.create_request(
  p_kind text, p_artist text, p_title text,
  p_link text, p_note text, p_paid boolean default false,
  p_use_bonus boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_cnt int;
  v_bonus_requests int;
  r public.requests;
begin
  if v_uid is null then raise exception 'err.requestAuth'; end if;
  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'err.needFields';
  end if;
  if coalesce(p_use_bonus, false) and not coalesce(p_paid, false) then
    raise exception 'err.rewardType';
  end if;

  select name, bonus_requests into v_name, v_bonus_requests
    from public.profiles where id = v_uid for update;
  if not found or v_name is null then raise exception 'err.requestAuth'; end if;

  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests
     where user_id = v_uid and is_paid = false
       and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then raise exception 'err.rateLimit' using detail = '3'; end if;
  elsif not coalesce(p_use_bonus, false) then
    select count(*) into v_cnt from public.orders
     where user_id = v_uid and kind = 'paid_request' and status = 'awaiting'
       and (expires_at is null or expires_at > now());
    if v_cnt >= 5 then raise exception 'err.paidPending' using detail = '5'; end if;
  end if;

  if coalesce(p_use_bonus, false) and coalesce(v_bonus_requests, 0) < 1 then
    raise exception 'err.noBonusRequest';
  end if;

  insert into public.requests (user_id, kind, artist, title, link, note, requester,
                               is_paid, payment_status, payment_source, status)
  values (
    v_uid,
    coalesce(nullif(p_kind,''), 'Color Coded Lyrics'),
    left(trim(p_artist),120), left(trim(p_title),160),
    left(coalesce(p_link,''),500), left(coalesce(p_note,''),500),
    coalesce(v_name,'Anonymous'), coalesce(p_paid,false),
    case when p_use_bonus then 'paid' when p_paid then 'awaiting' else 'none' end,
    case when p_use_bonus then 'bonus' when p_paid then 'money' else null end,
    case when p_use_bonus then 'queued' else 'pending' end
  ) returning * into r;

  if p_use_bonus then
    update public.profiles set bonus_requests = bonus_requests - 1
     where id = v_uid and bonus_requests > 0;
    if not found then raise exception 'err.noBonusRequest'; end if;
  elsif p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id)
    values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;
  return r;
end $$;

revoke all on function public.create_request(text,text,text,text,text,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean,boolean)
  to authenticated;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('near','lead','approved','picked','started','progress','done','denied','votes','expired',
   'comment','reply','mention','order_paid','order_rejected','order_expired'));
create or replace function public.notify_order_resolution()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status or new.status not in ('paid','rejected','expired') then return new; end if;
  if exists (select 1 from public.profiles where id = new.user_id) then
    insert into public.notifications(user_id,kind,title,votes,reason,sig)
    values (new.user_id,'order_' || new.status,
      (case when new.kind = 'votes' then 'V-' else 'PR-' end) || replace(upper(new.id::text),'-',''),
      new.qty, new.resolution_reason, 'order|' || new.id::text || '|' || new.status)
    on conflict (user_id,sig) where sig is not null do nothing;
  end if;
  return new;
end $$;
revoke all on function public.notify_order_resolution() from public, anon, authenticated;
drop trigger if exists orders_notify_resolution on public.orders;
create trigger orders_notify_resolution after update of status on public.orders
  for each row execute function public.notify_order_resolution();

create or replace function public.log_admin_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() or new.status is not distinct from old.status then return new; end if;
  insert into public.admin_actions(actor,action,target_id,label,detail)
  values (auth.uid(),'order',new.id,left(coalesce(new.kind,'order') || ' · ' || new.id::text,200),
    jsonb_build_object('status',jsonb_build_array(old.status,new.status),
      'payment_method',new.payment_method,'received_currency',new.received_currency,
      'received_amount',new.received_amount,'payment_reference',new.payment_reference,
      'reason',new.resolution_reason));
  return new;
end $$;
revoke all on function public.log_admin_order() from public, anon, authenticated;

-- The expiry scheduler writes actor NULL. The old reader coalesced every missing
-- profile to 'Admin', which would attribute an automatic expiry to a human.
create or replace function public.admin_actions_page(p_limit int default 20, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit  int := greatest(1, least(100, coalesce(p_limit, 20)));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total  bigint;
  v_rows   jsonb;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  select count(*) into v_total from public.admin_actions;
  with page as (
    select a.id, a.action, a.target_id, a.label, a.detail, a.created_at,
           case when a.actor is null then 'System' else coalesce(p.name, 'Admin') end as actor_name
      from public.admin_actions a
      left join public.profiles p on p.id = a.actor
     order by a.created_at desc, a.id desc
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', page.id, 'action', page.action, 'target_id', page.target_id,
           'label', page.label, 'detail', page.detail,
           'created_at', page.created_at, 'actor_name', page.actor_name
         ) order by page.created_at desc, page.id desc), '[]'::jsonb)
    into v_rows
    from page;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;
revoke all on function public.admin_actions_page(int, int) from public, anon, authenticated;
grant execute on function public.admin_actions_page(int, int) to authenticated;

-- Install the schedule only where pg_cron exists. Local PGlite tests call the
-- function directly; production already has pg_cron enabled.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ccl-expire-payment-orders') then
      perform cron.unschedule('ccl-expire-payment-orders');
    end if;
    perform cron.schedule('ccl-expire-payment-orders','*/15 * * * *','select public.expire_payment_orders()');
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
