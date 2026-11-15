-- Rollback for 20261225_payment_operations. ONLY safe before any new payment
-- confirmation/rejection/expiry has been recorded under this migration.
-- After that, restoring the old schema would discard financial lifecycle
-- history; restore a pre-migration backup instead. Run only with approval.
begin;

do $$
begin
  if exists (select 1 from public.orders
              where status = 'expired' or paid_at is not null or rejected_at is not null
                 or expired_at is not null or resolution_reason is not null
                 or payment_method is not null)
     or exists (select 1 from public.notifications
                 where kind in ('order_paid','order_rejected','order_expired')) then
    raise exception 'err.paymentRollbackBlocked';
  end if;
end $$;

drop trigger if exists orders_notify_resolution on public.orders;
drop function if exists public.notify_order_resolution();
drop function if exists public.expire_payment_orders();
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ccl-expire-payment-orders') then
      perform cron.unschedule('ccl-expire-payment-orders');
    end if;
  end if;
end $$;

drop function if exists public.admin_order(uuid,boolean,text,numeric,text,text);
create or replace function public.admin_order(p_order_id uuid, p_approve boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  update public.orders set status = case when p_approve then 'paid' else 'rejected' end
   where id = p_order_id and status = 'awaiting'
  returning * into o;

  if o.id is null then
    if exists (select 1 from public.orders where id = p_order_id) then
      raise exception 'err.orderLocked';
    end if;
    raise exception 'err.orderMissing';
  end if;

  if p_approve then
    if o.kind = 'votes' then
      update public.profiles set vote_credits = vote_credits + o.qty where id = o.user_id;
    elsif o.kind = 'paid_request' and o.request_id is not null then
      update public.requests
         set status = 'queued', is_paid = true,
             payment_status = 'paid', payment_source = 'money', updated_at = now()
       where id = o.request_id;
    end if;
  else
    if o.kind = 'paid_request' and o.request_id is not null then
      update public.requests
         set is_paid = false, payment_status = 'none', payment_source = null,
             updated_at = now()
       where id = o.request_id;
    end if;
  end if;

  return o;
end $$;

revoke all on function public.admin_order(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_order(uuid, boolean) to authenticated;

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
   where user_id = v_uid and kind = 'votes' and status = 'awaiting';
  if v_waiting >= 20 then raise exception 'err.orderQueueLimit'; end if;

  insert into public.orders (user_id, kind, pack, qty, amount_usd, amount_vnd)
  values (v_uid, 'votes', left(p_pack, 40), p_qty, p_usd, p_vnd)
  returning * into o;
  return o;
end $$;

revoke all on function public.buy_votes(text,int,numeric,int) from public, anon, authenticated;
grant execute on function public.buy_votes(text,int,numeric,int) to authenticated;

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
     where user_id = v_uid and kind = 'paid_request' and status = 'awaiting';
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
           coalesce(p.name, 'Admin') as actor_name
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

create or replace function public.log_admin_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  insert into public.admin_actions (actor, action, target_id, label, detail)
  values (auth.uid(), 'order', new.id,
          left(coalesce(new.kind, 'order') || ' · ' || coalesce(new.qty::text, '') || ' · '
               || coalesce(new.amount_vnd::text, '') || '₫', 200),
          jsonb_build_object('status', jsonb_build_array(old.status, new.status)));
  return new;
end $$;

revoke all on function public.log_admin_order() from public, anon, authenticated;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('near','lead','approved','picked','started','progress','done','denied','votes','expired',
   'comment','reply','mention'));

drop index if exists public.orders_expiry_idx;
drop index if exists public.orders_paid_at_idx;
alter table public.orders drop constraint if exists orders_resolution_fields_check;
alter table public.orders drop constraint if exists orders_payment_evidence_check;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  drop column if exists expires_at,
  drop column if exists paid_at,
  drop column if exists rejected_at,
  drop column if exists expired_at,
  drop column if exists resolution_reason,
  drop column if exists payment_method,
  drop column if exists received_currency,
  drop column if exists received_amount,
  drop column if exists payment_reference;
alter table public.orders add constraint orders_status_check
  check (status in ('awaiting','paid','rejected'));

notify pgrst, 'reload schema';
commit;
