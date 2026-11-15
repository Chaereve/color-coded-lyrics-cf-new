-- Rollback for 20261224_payment_source. Run only after stopping clients that
-- send/read payment_source. Restores the previous RPC bodies; keeps all rows.
begin;

drop index if exists public.orders_one_live_paid_request_idx;
alter table public.requests drop constraint if exists requests_payment_source_check;

-- Previous create_request body (20261125), without payment_source writes.
create or replace function public.create_request(
  p_kind text, p_artist text, p_title text,
  p_link text, p_note text, p_paid boolean default false,
  p_use_bonus boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_name text; v_cnt int; v_bonus_requests int; r public.requests;
begin
  if v_uid is null then raise exception 'err.requestAuth'; end if;
  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then raise exception 'err.needFields'; end if;
  if coalesce(p_use_bonus, false) and not coalesce(p_paid, false) then raise exception 'err.rewardType'; end if;
  select name, bonus_requests into v_name, v_bonus_requests from public.profiles where id = v_uid for update;
  if not found or v_name is null then raise exception 'err.requestAuth'; end if;
  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests where user_id = v_uid and is_paid = false and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then raise exception 'err.rateLimit' using detail = '3'; end if;
  elsif not coalesce(p_use_bonus, false) then
    select count(*) into v_cnt from public.orders where user_id = v_uid and kind = 'paid_request' and status = 'awaiting';
    if v_cnt >= 5 then raise exception 'err.paidPending' using detail = '5'; end if;
  end if;
  if coalesce(p_use_bonus, false) and coalesce(v_bonus_requests, 0) < 1 then raise exception 'err.noBonusRequest'; end if;
  insert into public.requests (user_id, kind, artist, title, link, note, requester, is_paid, payment_status, status)
  values (v_uid, coalesce(nullif(p_kind,''), 'Color Coded Lyrics'), left(trim(p_artist),120), left(trim(p_title),160),
          left(coalesce(p_link,''),500), left(coalesce(p_note,''),500), coalesce(v_name,'Anonymous'), coalesce(p_paid,false),
          case when p_use_bonus then 'paid' when p_paid then 'awaiting' else 'none' end,
          case when p_use_bonus then 'queued' else 'pending' end)
  returning * into r;
  if p_use_bonus then
    update public.profiles set bonus_requests = bonus_requests - 1 where id = v_uid and bonus_requests > 0;
    if not found then raise exception 'err.noBonusRequest'; end if;
  elsif p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id) values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;
  return r;
end $$;
revoke all on function public.create_request(text,text,text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean,boolean) to authenticated;

-- Previous admin_order body: reject only cleared payment_status.
create or replace function public.admin_order(p_order_id uuid, p_approve boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  update public.orders set status = case when p_approve then 'paid' else 'rejected' end
   where id = p_order_id and status = 'awaiting' returning * into o;
  if o.id is null then
    if exists (select 1 from public.orders where id = p_order_id) then raise exception 'err.orderLocked'; end if;
    raise exception 'err.orderMissing';
  end if;
  if p_approve then
    if o.kind = 'votes' then
      update public.profiles set vote_credits = vote_credits + o.qty where id = o.user_id;
    elsif o.kind = 'paid_request' and o.request_id is not null then
      update public.requests set status = 'queued', payment_status = 'paid', updated_at = now() where id = o.request_id;
    end if;
  else
    if o.kind = 'paid_request' and o.request_id is not null then
      update public.requests set payment_status = 'none' where id = o.request_id;
    end if;
  end if;
  return o;
end $$;
revoke all on function public.admin_order(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_order(uuid, boolean) to authenticated;

-- Previous admin_request_edit body (20261213).
create or replace function public.admin_request_edit(
  p_id uuid, p_kind text default null, p_note text default null,
  p_is_paid boolean default null, p_requester text default null
) returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_kind is not null and p_kind not in ('Color Coded Lyrics', 'Full Album', '1 Hour Loop', 'Short') then raise exception 'err.requestKind'; end if;
  if p_requester is not null and length(btrim(p_requester)) = 0 then raise exception 'err.needFields'; end if;
  update public.requests
     set kind = coalesce(p_kind, kind),
         note = case when p_note is null then note else left(btrim(p_note), 300) end,
         is_paid = coalesce(p_is_paid, is_paid),
         requester = coalesce(nullif(btrim(p_requester), ''), requester),
         updated_at = now()
   where id = p_id returning * into r;
  if r.id is null then raise exception 'err.requestMissing'; end if;
  return r;
end $$;
revoke all on function public.admin_request_edit(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.admin_request_edit(uuid, text, text, boolean, text) to authenticated;

alter table public.requests drop column if exists payment_source;
notify pgrst, 'reload schema';
commit;
