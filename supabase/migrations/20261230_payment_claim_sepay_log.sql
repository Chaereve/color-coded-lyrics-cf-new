-- 20261230 · "Tôi đã chuyển khoản" (người mua báo) + SỔ LOG webhook SePay (LOG-ONLY)
--
-- Phạm vi:
--   1. orders.transfer_reported_at — người mua bấm "Tôi đã chuyển khoản" khi nào.
--      Ghi LẦN ĐẦU, không ghi đè; KHÔNG đổi trạng thái đơn (đơn vẫn 'awaiting').
--   2. public.payment_events — mọi giao dịch tiền về SePay gửi sang được ghi lại,
--      đối chiếu NỘI DUNG + SỐ TIỀN với đơn tương ứng và gắn nhãn:
--        matched / underpaid / overpaid / unknown
--      TUYỆT ĐỐI KHÔNG tự paid, KHÔNG đổi hàng đợi, KHÔNG cộng credits.
--      Đây là pha "log-only": đối chiếu chạy ngầm, admin vẫn là biên duy nhất.
--      Khi số khớp ≥99% trong 1–2 tuần mới bàn Pha 2 (enforce) — ngoài phạm vi.
--   3. report_transfer(uuid) — RPC người mua gọi, idempotent, chỉ chủ đơn,
--      chỉ đơn còn chờ & chưa hết hạn 72h; ghi admin_actions (order_claim)
--      đúng MỘT lần cho lần báo đầu tiên (admin biết mà không cần tin nhắn lặp).
--
-- Idempotency:
--   · report_transfer: lần bấm thứ hai trả về chính đơn đã có dấu, không lỗi,
--     không thêm admin_actions.
--   · sepay_record_event: trùng provider_ref → trả lại kết quả đã lưu
--     (replayed:true), không nhân bản dòng. SePay retry an toàn.
--
-- Cổng: sepay_record_event chỉ chạy khi p_gate_token khớp edge_gate
-- (migration 20261103) — cùng mô hình uỷ quyền của spin/vote. Đặt secret
-- SEPAY_WEBHOOK_KEY trên Pages/Workers; bên SePay cấu hình header
-- "Authorization: Apikey <SEPAY_WEBHOOK_KEY>". KHÔNG dùng service role ở edge.
-- Log-only nghĩa cả khi gate hở cũng không phát sinh side effect.

begin;

-- ──────────────────────────────────────────────────────────
-- 1. Người mua đã báo chuyển khoản lúc nào
-- ──────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists transfer_reported_at timestamptz;

-- ──────────────────────────────────────────────────────────
-- 2. Sổ log giao dịch SePay — LOG-ONLY
-- ──────────────────────────────────────────────────────────
create table if not exists public.payment_events (
  id               bigint generated always as identity primary key,
  provider         text not null default 'sepay',
  provider_ref     text,                 -- mã giao dịch ngân hàng (referenceCode); khoá idempotent
  transfer_at      timestamptz,          -- transactionDate webhook gửi (giờ app, không phải nhận)
  transfer_amount  numeric(14,2) not null,
  transfer_content text not null,
  transfer_account text,                 -- tài khoản nhận tiền
  transfer_sub     text,                 -- subAccount/code (thường chứa mã riêng của SePay)
  raw              jsonb not null,
  match_status     text not null check (match_status in ('matched','underpaid','overpaid','unknown')),
  matched_order_id uuid references public.orders(id) on delete set null,
  created_at       timestamptz not null default now()
);
comment on table public.payment_events is
  'SePay webhook, pha LOG-ONLY: đối chiếu ngầm nội dung + số tiền, KHÔNG đổi trạng thái đơn, KHÔNG cộng quyền. Đọc dành cho admin.';

create unique index if not exists payment_events_provider_ref_key
  on public.payment_events (provider, provider_ref) where provider_ref is not null;
create index if not exists payment_events_matched_order_idx
  on public.payment_events (matched_order_id) where matched_order_id is not null;
create index if not exists payment_events_created_idx
  on public.payment_events (created_at desc);

alter table public.payment_events enable row level security;
revoke all on public.payment_events from public, anon, authenticated;
-- Admin đọc để đối soát; không ai khác SELECT được.
grant select on public.payment_events to authenticated;
drop policy if exists payment_events_admin_read on public.payment_events;
create policy payment_events_admin_read on public.payment_events
  for select to authenticated using (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- 3. Giải mã mã chuyển khoản → id đơn
--    compact:  PR|V-<22 ký tự base64url của 16 byte uuid, big-endian>
--    legacy:   PR|V + 32 hex (không dấu cách/gạch)
--    2 bit đệm cuối phải bằng 0 thì mã mới là mã hợp lệ sinh bởi
--    orderTransferContent (kiểm cả ở JS). Sai ⇒ null, KHÔNG đoán.
-- ──────────────────────────────────────────────────────────
create or replace function public.payment_order_from_reference(p_reference text)
returns table(order_id uuid, order_kind text)
language plpgsql immutable security definer set search_path = public as $$
declare
  t text;
  m text[];
  d bytea;
  h text;
begin
  t := regexp_replace(coalesce(p_reference, ''), '\s+', '', 'g');

  -- compact, giữ nguyên hoa/thường của payload (base64url phân biệt hoa/thường);
  -- tiền tố phải là PR|V viết hoa (mã do app sinh ra luôn viết hoa tiền tố).
  m := regexp_match(t, '^(PR|V)-([A-Za-z0-9_-]{22})$');
  if m is not null then
    begin
      d := decode(translate(m[2], '-_', '+/') || '==', 'base64');
      -- round-trip y như orderTransferContent phía JS: mã chỉ hợp lệ khi
      -- giải mã xong mã hoá lại cho đúng chuỗi gốc (chặn cả padding sai).
      h := upper(encode(d, 'hex'));
      if length(h) <> 32
         or replace(replace(translate(rtrim(encode(d, 'base64'), '='), '+/', '-_'), E'\n', ''), E'\r', '') <> m[2]
      then
        return;
      end if;
      return query select
          (substring(h from 1 for 8)||'-'||substring(h from 9 for 4)||'-'||
           substring(h from 13 for 4)||'-'||substring(h from 17 for 4)||'-'||
           substring(h from 21))::uuid,
          case when m[1] = 'PR' then 'paid_request' else 'votes' end;
    exception when others then
      return;
    end;
    return;
  end if;

  -- legacy: PR|V + 32 hex (app cũ sinh QR với nội dung viết hoa, không dấu gạch)
  m := regexp_match(upper(t), '^(PR|V)([0-9A-F]{32})$');
  if m is not null then
    h := m[2];
    return query select
      (substring(h from 1 for 8)||'-'||substring(h from 9 for 4)||'-'||
       substring(h from 13 for 4)||'-'||substring(h from 17 for 4)||'-'||
       substring(h from 21))::uuid,
      case when m[1] = 'PR' then 'paid_request' else 'votes' end;
  end if;
  return;
end $$;
revoke all on function public.payment_order_from_reference(text) from public, anon, authenticated;

-- Mã chuyển khoản nằm lẫn trong nội dung CK (ngân hàng giữ nguyên chuỗi VietQR).
create or replace function public.payment_extract_reference(p_content text)
returns text language plpgsql immutable set search_path = public as $$
declare m text[];
begin
  -- compact: tiền tố viết hoa, payload giữ nguyên hoa/thường
  m := regexp_match(coalesce(p_content, ''), '((?:PR|V)-[A-Za-z0-9_-]{22})');
  if m is not null then return m[1]; end if;
  m := regexp_match(upper(coalesce(p_content, '')), '((?:PR|V)[0-9A-F]{32})');
  if m is not null then return m[1]; end if;
  return null;
end $$;
revoke all on function public.payment_extract_reference(text) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- 4. report_transfer — người mua báo "Tôi đã chuyển khoản"
--    Idempotent · chỉ chủ đơn · đơn còn chờ & chưa hết cửa sổ 72h.
-- ──────────────────────────────────────────────────────────
create or replace function public.report_transfer(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  o public.orders;
begin
  if v_uid is null then raise exception 'err.signin'; end if;

  select * into o from public.orders where id = p_order_id for update;
  -- Không phân biệt "không có đơn" với "đơn của người khác": không rò trạng thái.
  if not found or o.user_id <> v_uid then raise exception 'err.orderMissing'; end if;
  if o.status <> 'awaiting' then raise exception 'err.orderLocked'; end if;
  if o.expires_at is not null and o.expires_at <= now() then raise exception 'err.orderLocked'; end if;

  if o.transfer_reported_at is null then
    update public.orders
       set transfer_reported_at = now()
     where id = o.id
    returning * into o;
    insert into public.admin_actions(actor, action, target_id, label, detail)
    values (v_uid, 'order_claim', o.id,
      left(o.kind || ' · ' || o.id::text, 200),
      jsonb_build_object('kind', o.kind, 'amount_vnd', o.amount_vnd,
        'amount_usd', o.amount_usd, 'source', 'report_transfer',
        'reported_at', o.transfer_reported_at));
  end if;

  return o;
end $$;
revoke all on function public.report_transfer(uuid) from public, anon;
grant execute on function public.report_transfer(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- 5. sepay_record_event — cổng edge ghi log, LOG-ONLY tuyệt đối
--    p_payload: body webhook SePay (giữ nguyên hoa/thường của content)
--    Trả jsonb { replayed, match_status, matched_order_id, provider_ref }
-- ──────────────────────────────────────────────────────────
create or replace function public.sepay_record_event(p_payload jsonb, p_gate_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_amount   numeric(14,2);
  v_content  text;
  v_ref      text;
  v_at       timestamptz;
  v_account  text;
  v_sub      text;
  v_code     text;
  v_order    uuid;
  v_kind     text;
  v_expected numeric(14,2);
  v_status   text;
  v_existing public.payment_events;
begin
  -- Cùng mô hình uỷ quyền spin/vote: chỉ cổng (edge) gọi được.
  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.edgeGate'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'err.sepayBody'; end if;

  v_amount  := nullif(coalesce(nullif(p_payload->>'transferAmount',''), nullif(p_payload->>'amount','')), '')::numeric;
  v_content := left(coalesce(nullif(p_payload->>'content',''),
                             nullif(p_payload->>'transferContent',''),
                             nullif(p_payload->>'description',''), ''), 300);
  v_ref     := left(nullif(coalesce(nullif(p_payload->>'referenceCode',''),
                                    nullif(p_payload->>'reference_code',''),
                                    nullif(p_payload->>'id','')::text, ''), ''), 128);
  v_account := left(nullif(coalesce(nullif(p_payload->>'accountNumber',''), ''), ''), 64);
  v_sub     := left(nullif(coalesce(nullif(p_payload->>'subAccount',''), nullif(p_payload->>'code',''), ''), ''), 64);
  begin
    v_at := nullif(p_payload->>'transactionDate','')::timestamptz;
  exception when others then
    v_at := null;
  end;

  if v_amount is null or v_amount <= 0 or length(v_content) = 0 then
    raise exception 'err.sepayBody';
  end if;

  -- Idempotent theo mã giao dịch ngân hàng: retry của SePay trả lại đúng kết quả cũ.
  if v_ref is not null then
    select * into v_existing from public.payment_events
     where provider = 'sepay' and provider_ref = v_ref;
    if found then
      return jsonb_build_object('replayed', true,
        'match_status', v_existing.match_status,
        'matched_order_id', v_existing.matched_order_id,
        'provider_ref', v_existing.provider_ref);
    end if;
  end if;

  -- Tìm mã trong nội dung CK → đơn tương ứng.
  v_code := public.payment_extract_reference(v_content);
  if v_code is not null then
    select r.order_id, r.order_kind into v_order, v_kind
      from public.payment_order_from_reference(v_code) r;
  end if;

  if v_order is not null then
    select o.amount_vnd into v_expected from public.orders o where o.id = v_order;
    if v_expected is null then
      v_status := 'unknown';  -- đơn không tồn tại (mã hợp lệ nhưng sai/hết)
      v_order := null;
    elsif v_amount = v_expected then
      v_status := 'matched';
    elsif v_amount < v_expected then
      v_status := 'underpaid';
    else
      v_status := 'overpaid';
    end if;
  else
    v_status := 'unknown';
  end if;

  insert into public.payment_events
    (provider, provider_ref, transfer_at, transfer_amount, transfer_content,
     transfer_account, transfer_sub, raw, match_status, matched_order_id)
  values
    ('sepay', v_ref, v_at, v_amount, v_content, v_account, v_sub,
     p_payload, v_status, v_order)
  on conflict do nothing;

  return jsonb_build_object('replayed', false,
    'match_status', v_status,
    'matched_order_id', v_order,
    'provider_ref', v_ref);
end $$;
revoke all on function public.sepay_record_event(jsonb, text) from public;
grant execute on function public.sepay_record_event(jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
