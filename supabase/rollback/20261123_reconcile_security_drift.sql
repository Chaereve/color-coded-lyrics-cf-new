/* ============================================================================
   20261123_reconcile_security_drift — ROLLBACK
   ----------------------------------------------------------------------------
   Đảo ĐÚNG BA việc của migration 20261123, không hơn:
     A. trả policy `request_comments_authenticated_insert` về biểu thức ĐÃ GHI
        LẠI trong COMMENT của chính policy lúc migration chạy (không đoán);
     B. trả `requests_picked_idx` về định nghĩa ĐÃ GHI LẠI trong COMMENT của
        chính index lúc migration chạy (production: `(picked_at DESC)`);
     C. mở lại EXECUTE cho overload cũ `create_request(text,text,text,text,text,boolean)`
        đúng như trước reconcile (mặc định PUBLIC + grant cho authenticated,
        theo migration 20261103) và trả ACL của ba hàm phụ về trạng thái
        mặc định PUBLIC (đúng như trước reconcile: chưa từng revoke).

   FAIL-CLOSED: nếu trạng thái sống không phải trạng thái mà 20261123 để lại
   (policy chưa siết / index còn DESC / overload cũ đang mở), tệp này RAISE và
   abort — thà không làm gì còn hơn "rollback" trên một trạng thái hỗn hợp.
   Chạy hai lần: lần thứ hai abort (đúng ý), giống rollback của 20261121/20261122.

   CẢNH BÁO ĐỌC TRƯỚC KHI CHẠY: rollback này MỞ LẠI một lỗ hổng đã đóng
   (policy yếu hơn + overload cũ gọi được). Nó chỉ dùng khi bản reconcile gây
   sự cố thật, và phải được duyệt riêng.
   ============================================================================ */
begin;

/* ---------------------------------------------------------------------------
   0. TIỀN KIỂM TRA: chỉ chạy khi đang ĐÚNG trạng thái sau reconcile
   --------------------------------------------------------------------------- */
do $$
declare
  v_live text;
  v_def text;
begin
  select pg_get_expr(p.polwithcheck, p.polrelid) into v_live
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';
  if v_live is null then
    raise exception 'err.reconcileRollback: policy request_comments_authenticated_insert không tồn tại';
  end if;
  if translate(regexp_replace(v_live, '\s+', '', 'g'), '()', '') = translate(regexp_replace('auth.uid() = user_id', '\s+', '', 'g'), '()', '') then
    raise exception 'err.reconcileRollback: policy đang ở dạng YẾU — 20261123 chưa từng chạy (hoặc đã bị rollback trước đó)';
  end if;

  select pg_get_indexdef(c.oid) into v_def from pg_class c where c.oid = 'public.requests_picked_idx'::regclass;
  if v_def is null then
    raise exception 'err.reconcileRollback: requests_picked_idx không tồn tại';
  end if;
  if v_def not like '%WHERE (picked_at IS NOT NULL)%' then
    raise exception 'err.reconcileRollback: requests_picked_idx không phải partial index — 20261123 chưa từng chạy. Đang có: %', v_def;
  end if;

  /* `has_function_privilege(role, oid, 'EXECUTE')` — truyền oid từ
     to_regprocedure() chứ KHÔNG truyền 'literal'::regprocedure: planner gấp hằng
     số của phép cast đó ngay cả khi vế trước của `and` là false, nên trên database
     không có overload cũ (cài mới từ bundle) câu lệnh sẽ vỡ bằng 42883 thay vì
     bỏ qua. oid NULL ⇒ hàm trả NULL ⇒ coalesce về false. */
  if coalesce(has_function_privilege('authenticated',
       to_regprocedure('public.create_request(text,text,text,text,text,boolean)'), 'EXECUTE'), false) then
    raise exception 'err.reconcileRollback: overload cũ create_request vẫn còn mở — 20261123 chưa từng chạy';
  end if;
end $$;

/* ---------------------------------------------------------------------------
   A. TRẢ POLICY VỀ NGUYÊN VĂN CŨ (đọc từ comment mà 20261123 ghi lại)
   --------------------------------------------------------------------------- */
do $$
declare
  v_prev text;
begin
  select obj_description(p.oid, 'pg_policy') into v_prev
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';

  if v_prev is null or position('biểu thức WITH CHECK cũ:' in v_prev) = 0 then
    raise exception 'err.reconcileRollback: comment của policy không chứa biểu thức cũ — không thể khôi phục đúng nguyên văn, dừng lại thay vì đoán';
  end if;

  execute format('alter policy %I on public.request_comments with check (%s)',
    'request_comments_authenticated_insert', substring(v_prev from position('biểu thức WITH CHECK cũ:' in v_prev) + length('biểu thức WITH CHECK cũ:')));
  execute format('comment on policy %I on public.request_comments is %L',
    'request_comments_authenticated_insert', '20261123 rolled back — policy đã trả về biểu thức cũ. Nội dung cũ: ' || v_prev);
end $$;

/* ---------------------------------------------------------------------------
   B. TRẢ requests_picked_idx VỀ ĐỊNH NGHĨA CŨ (đọc từ comment của index)
   --------------------------------------------------------------------------- */
do $$
declare
  v_prev text;
begin
  select obj_description(c.oid, 'pg_class') into v_prev
    from pg_class c where c.oid = 'public.requests_picked_idx'::regclass;
  if v_prev is null or position('định nghĩa cũ:' in v_prev) = 0 then
    raise exception 'err.reconcileRollback: comment của index không chứa định nghĩa cũ — dừng thay vì đoán';
  end if;
  v_prev := substring(v_prev from position('định nghĩa cũ:' in v_prev) + length('định nghĩa cũ:'));

  drop index public.requests_picked_idx;
  execute v_prev;   /* chính câu CREATE INDEX đã đọc được trước khi đổi */
end $$;

/* ---------------------------------------------------------------------------
   C. TRẢ LẠI QUYỀN NHƯ TRƯỚC RECONCILE
   ---------------------------------------------------------------------------
   Trước reconcile: overload cũ có quyền PUBLIC mặc định của PostgreSQL (20261103
   chỉ GRANT cho authenticated, không revoke) ⇒ anon gọi được qua PUBLIC. Ba hàm
   phụ do migration cũ tạo cũng chưa từng bị revoke ⇒ PUBLIC mặc định. Khôi phục
   đúng thế, và nói rõ đây là mở lại lỗ hổng. */
do $$
begin
  if to_regprocedure('public.create_request(text,text,text,text,text,boolean)') is not null then
    execute 'grant execute on function public.create_request(text,text,text,text,text,boolean) to public, authenticated';
    execute 'comment on function public.create_request(text,text,text,text,text,boolean) is ' ||
      quote_literal('20261123 rolled back: EXECUTE đã được trả lại cho PUBLIC + authenticated (trạng thái trước reconcile). Overload này thiếu `for update` trên profiles ⇒ giới hạn 3 request/giờ có thể bị vượt khi gọi song song.');
  end if;

  if to_regprocedure('public.admin_expire_request(uuid)') is not null then
    execute 'grant execute on function public.admin_expire_request(uuid) to public';
  end if;
  if to_regprocedure('public.queue_expired_requests()') is not null then
    execute 'grant execute on function public.queue_expired_requests() to public';
  end if;
  if to_regprocedure('public.requests_video_url_guard()') is not null then
    execute 'grant execute on function public.requests_video_url_guard() to public';
  end if;

  /* Quyền trên request_comments: trước reconcile có thể là INSERT/UPDATE mức
     BẢNG (trạng thái 20260920). Rollback trả lại đúng thế — kèm cảnh báo rằng
     đây chính là thứ cho phép client tự đặt deleted_at, và rằng nó chỉ nên
     được trả khi bản reconcile gây sự cố thật. */
  execute 'grant insert, update on public.request_comments to authenticated';
  execute 'revoke insert (request_id, user_id, parent_id, body) on public.request_comments from authenticated';
end $$;

/* ---------------------------------------------------------------------------
   1. HẬU KIỂM TRA
   --------------------------------------------------------------------------- */
do $$
declare
  v_live text;
  v_def text;
begin
  select pg_get_expr(p.polwithcheck, p.polrelid) into v_live
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';
  if translate(regexp_replace(v_live, '\s+', '', 'g'), '()', '') <> translate(regexp_replace('auth.uid() = user_id', '\s+', '', 'g'), '()', '') then
    raise exception 'err.reconcileRollback: policy chưa trả về dạng cũ. Đang có: %', v_live;
  end if;

  select pg_get_indexdef(c.oid) into v_def from pg_class c where c.oid = 'public.requests_picked_idx'::regclass;
  if v_def like '%WHERE (picked_at IS NOT NULL)%' then
    raise exception 'err.reconcileRollback: index chưa trả về định nghĩa cũ. Đang có: %', v_def;
  end if;

  if to_regprocedure('public.create_request(text,text,text,text,text,boolean)') is not null
     and not coalesce(has_function_privilege('anon',
       to_regprocedure('public.create_request(text,text,text,text,text,boolean)'), 'EXECUTE'), false) then
    raise exception 'err.reconcileRollback: overload cũ chưa được mở lại cho anon như trước';
  end if;

  if not has_table_privilege('authenticated', 'public.request_comments', 'INSERT') then
    raise exception 'err.reconcileRollback: quyền INSERT mức bảng trên request_comments chưa được trả lại';
  end if;
  /* Trả lại quyền mức bảng nghĩa là client lại tự đặt được deleted_at — nói thẳng
     trong hậu kiểm để người đọc sau không tưởng đây là trạng thái an toàn. */
  if not coalesce(has_column_privilege('authenticated', 'public.request_comments', 'deleted_at', 'INSERT'), false) then
    raise exception 'err.reconcileRollback: deleted_at chưa mở lại cho client — trạng thái trước reconcile chưa được khôi phục đủ';
  end if;

  /* Vẫn không được đụng dữ liệu. */
  if (select count(*) from public.daily_login_rewards) is null then
    raise exception 'err.reconcileRollback: không đọc được daily_login_rewards';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
