-- Separate money-paid and bonus-funded requests at the review gate.
-- Apply after 20261228_bonus_refund_and_priority. One transaction, rerunnable.
-- Existing accepted bonus requests are NOT rewound to pending: this changes
-- only new submissions. Money keeps its evidence-gated order lifecycle.
begin;

-- Same signature / quota / wallet locking as 20261225. The only request-row
-- change is that a bonus redemption now waits for admin_review like every
-- other new request. The credit is still reserved atomically at submit; the
-- 20261228 trigger returns it once on denial / eligible deletion / expiry.
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
    'pending'
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

-- Admin inbox: one notice per funded submission per admin. The two kinds keep
-- money and reward redemptions visibly separate; sig makes replay / realtime
-- duplicates impossible. No private note or denial reason is copied. Existing
-- rows are not backfilled, so deploying this does not spam the inbox.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('near','lead','approved','picked','started','progress','done','denied','votes','expired',
   'comment','reply','mention','order_paid','order_rejected','order_expired','bonus_refunded',
   'paid_request_review','bonus_request_review'));

create or replace function public.notify_admin_request_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from 'pending'
     or new.is_paid is distinct from true
     or new.payment_source not in ('money','bonus') then
    return new;
  end if;

  insert into public.notifications (user_id, song_key, kind, request_id, title, artist, sig)
  select p.id, public.song_key(new.artist, new.title),
         case when new.payment_source = 'money' then 'paid_request_review' else 'bonus_request_review' end,
         new.id, new.title, new.artist,
         'request-review|' || new.id::text || '|' || new.payment_source
    from public.profiles p
   where p.is_admin
  on conflict (user_id, sig) where sig is not null do nothing;
  return new;
end $$;

revoke all on function public.notify_admin_request_review() from public, anon, authenticated;
drop trigger if exists requests_notify_admin_review on public.requests;
create trigger requests_notify_admin_review
after insert on public.requests
for each row execute function public.notify_admin_request_review();

notify pgrst, 'reload schema';
commit;
