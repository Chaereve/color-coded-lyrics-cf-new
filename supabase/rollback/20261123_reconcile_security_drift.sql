/* ============================================================================
   20261123_reconcile_security_drift — ROLLBACK
   ----------------------------------------------------------------------------
   Đảo ĐÚNG những việc của migration 20261123, không hơn — và KHÔNG bao giờ mở
   rộng quyền hơn trạng thái trước reconcile:
     A. trả policy `request_comments_authenticated_insert` về biểu thức ĐÃ GHI
        LẠI trong COMMENT của chính policy lúc migration chạy (không đoán);
     A2. trả ACL của `public.request_comments` về ĐÚNG trạng thái ĐÃ GHI LẠI
        trong comment đó (mức bảng và danh sách cột cho từng role). Nếu trước
        reconcile quyền vốn đã hẹp — đúng trường hợp production đo được ngày
        2026-10-06 (`insert mức bảng = f`, `deleted_at = f`) — thì rollback giữ
        nguyên trạng thái hẹp đó, KHÔNG grant lại `insert, update` mức bảng;
     B. trả `requests_picked_idx` về định nghĩa ĐÃ GHI LẠI trong COMMENT của
        chính index lúc migration chạy (production: `(picked_at DESC)`);
     C. mở lại EXECUTE cho overload cũ `create_request(text,text,text,text,text,boolean)`
        đúng như trước reconcile (mặc định PUBLIC + grant cho authenticated,
        theo migration 20261103) và trả ACL của ba hàm phụ về trạng thái
        mặc định PUBLIC (đúng như trước reconcile: chưa từng revoke).
        Đây là phần DUY NHẤT thật sự mở lại một đường đã bị đóng.

   FAIL-CLOSED: nếu trạng thái sống không phải trạng thái mà 20261123 để lại
   (policy chưa siết / index còn DESC / overload cũ đang mở), tệp này RAISE và
   abort — thà không làm gì còn hơn "rollback" trên một trạng thái hỗn hợp.
   Chạy hai lần: lần thứ hai abort (đúng ý), giống rollback của 20261121/20261122.

   CẢNH BÁO ĐỌC TRƯỚC KHI CHẠY: rollback này MỞ LẠI đúng hai đường mà
   20261123 đã đóng — policy yếu hơn (thiếu `deleted_at IS NULL`) và overload
   cũ gọi được. Nó chỉ dùng khi bản reconcile gây sự cố thật, và phải được
   duyệt riêng. ACL comment KHÔNG bị nới thêm.
   ============================================================================ */
begin;

/* ---------------------------------------------------------------------------
   0. TIỀN KIỂM TRA: chỉ chạy khi đang ĐÚNG trạng thái sau reconcile
   --------------------------------------------------------------------------- */
do $$
declare
  v_live text;
  v_def text;
  v_prev text;
  v_recorded text;
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
  /* Đang ở trạng thái TRƯỚC reconcile? So với chính chuỗi đã ghi trong comment
     (không phụ thuộc hình dạng), và vẫn nhận thêm literal yếu gốc để bắt được
     trường hợp comment đã bị xoá tay. */
  select obj_description(p.oid, 'pg_policy') into v_prev
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';
  if v_prev is not null and position('WITH CHECK cũ: ' in v_prev) > 0 then
    v_recorded := substring(v_prev from position('WITH CHECK cũ: ' in v_prev) + length('WITH CHECK cũ: '));
    if translate(regexp_replace(v_live, '\s+', '', 'g'), '()', '') =
       translate(regexp_replace(v_recorded, '\s+', '', 'g'), '()', '') then
      raise exception 'err.reconcileRollback: policy đang ở ĐÚNG dạng trước reconcile — 20261123 chưa từng chạy (hoặc đã bị rollback trước đó)';
    end if;
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

  if v_prev is null or position('WITH CHECK cũ: ' in v_prev) = 0 then
    raise exception 'err.reconcileRollback: comment của policy không chứa biểu thức cũ — không thể khôi phục đúng nguyên văn, dừng lại thay vì đoán';
  end if;

  execute format('alter policy %I on public.request_comments with check (%s)',
    'request_comments_authenticated_insert',
    substring(v_prev from position('WITH CHECK cũ: ' in v_prev) + length('WITH CHECK cũ: ')));
  execute format('comment on policy %I on public.request_comments is %L',
    'request_comments_authenticated_insert', '20261123 rolled back — policy đã trả về biểu thức cũ. Nội dung cũ: ' || v_prev);
end $$;

/* ---------------------------------------------------------------------------
   A2. TRẢ ACL public.request_comments VỀ ĐÚNG TRẠNG THÁI ĐÃ GHI LẠI
   ---------------------------------------------------------------------------
   Không "trả về dạng 20260920": làm vậy sẽ MỞ RỘNG quyền (grant `insert, update`
   mức bảng, để client tự đặt `deleted_at`) trên một database mà trước reconcile
   quyền vốn đã hẹp — đúng trường hợp production. Ở đây chỉ dựng lại đúng những
   gì dòng `ACL request_comments trước:` trong comment policy ghi lại. */
do $$
declare
  v_prev text;
  v_acl jsonb;
  v_role text;
  v_cols text;
  v_list text;
begin
  select obj_description(p.oid, 'pg_policy') into v_prev
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';

  v_acl := (regexp_match(v_prev, 'ACL request_comments trước: (\{[^\n]*\})'))[1]::jsonb;
  if v_acl is null then
    raise exception 'err.reconcileRollback: comment của policy không chứa dòng "ACL request_comments trước:" — không thể khôi phục ACL đúng nguyên trạng, dừng thay vì đoán';
  end if;

  select string_agg(quote_ident(column_name), ', ' order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'request_comments';

  /* Xoá sạch phần INSERT/UPDATE của hai client role (mức bảng và mọi mức cột),
     rồi dựng lại đúng như đã ghi. Không đụng SELECT/DELETE. */
  execute 'revoke insert, update on public.request_comments from anon, authenticated';
  execute format('revoke insert (%s) on public.request_comments from anon, authenticated', v_cols);
  execute format('revoke update (%s) on public.request_comments from anon, authenticated', v_cols);

  foreach v_role in array array['anon', 'authenticated'] loop
    if (v_acl -> v_role ->> 'insert_table')::boolean then
      execute format('grant insert on public.request_comments to %I', v_role);
    elsif jsonb_array_length(v_acl -> v_role -> 'insert_cols') > 0 then
      select string_agg(quote_ident(x), ', ') into v_list
        from jsonb_array_elements_text(v_acl -> v_role -> 'insert_cols') x;
      execute format('grant insert (%s) on public.request_comments to %I', v_list, v_role);
    end if;
    if (v_acl -> v_role ->> 'update_table')::boolean then
      execute format('grant update on public.request_comments to %I', v_role);
    elsif jsonb_array_length(v_acl -> v_role -> 'update_cols') > 0 then
      select string_agg(quote_ident(x), ', ') into v_list
        from jsonb_array_elements_text(v_acl -> v_role -> 'update_cols') x;
      execute format('grant update (%s) on public.request_comments to %I', v_list, v_role);
    end if;
  end loop;
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

  /* ACL của request_comments KHÔNG được trả ở đây nữa: khối A2 khôi phục đúng
     trạng thái đã ghi lại, nên rollback không bao giờ mở rộng quyền hơn trước
     reconcile. Khối này chỉ còn phần hàm. */
end $$;

/* ---------------------------------------------------------------------------
   1. HẬU KIỂM TRA
   --------------------------------------------------------------------------- */
do $$
declare
  v_live text;
  v_def text;
  v_prev text;
  v_recorded text;
  v_prev_acl jsonb;
  v_live_acl jsonb;
begin
  select pg_get_expr(p.polwithcheck, p.polrelid), obj_description(p.oid, 'pg_policy')
    into v_live, v_prev
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';

  /* A. policy phải khớp ĐÚNG chuỗi đã ghi lúc reconcile — so với chính bản ghi
     thay vì một literal cứng, nên đúng cho cả hai hình dạng yếu đã gặp. */
  if v_prev is null or position('WITH CHECK cũ: ' in v_prev) = 0 then
    raise exception 'err.reconcileRollback: comment policy không còn bản ghi WITH CHECK cũ';
  end if;
  v_recorded := substring(v_prev from position('WITH CHECK cũ: ' in v_prev) + length('WITH CHECK cũ: '));
  if translate(regexp_replace(v_live, '\s+', '', 'g'), '()', '') <>
     translate(regexp_replace(v_recorded, '\s+', '', 'g'), '()', '') then
    raise exception 'err.reconcileRollback: policy chưa trả về đúng biểu thức đã ghi. Đang có: % — đã ghi: %', v_live, v_recorded;
  end if;

  /* A2. ACL phải khớp ĐÚNG bản ghi ACL trong comment — không rộng hơn, không hẹp hơn. */
  v_prev_acl := (regexp_match(v_prev, 'ACL request_comments trước: (\{[^\n]*\})'))[1]::jsonb;
  if v_prev_acl is null then
    raise exception 'err.reconcileRollback: comment policy không còn bản ghi ACL trước reconcile';
  end if;
  v_live_acl := jsonb_build_object(
    'authenticated', jsonb_build_object(
      'insert_table', has_table_privilege('authenticated', 'public.request_comments', 'INSERT'),
      'update_table', has_table_privilege('authenticated', 'public.request_comments', 'UPDATE'),
      'insert_cols', coalesce((select jsonb_agg(column_name order by column_name)
        from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'request_comments'
          and privilege_type = 'INSERT' and grantee = 'authenticated'), '[]'::jsonb),
      'update_cols', coalesce((select jsonb_agg(column_name order by column_name)
        from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'request_comments'
          and privilege_type = 'UPDATE' and grantee = 'authenticated'), '[]'::jsonb)),
    'anon', jsonb_build_object(
      'insert_table', has_table_privilege('anon', 'public.request_comments', 'INSERT'),
      'update_table', has_table_privilege('anon', 'public.request_comments', 'UPDATE'),
      'insert_cols', coalesce((select jsonb_agg(column_name order by column_name)
        from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'request_comments'
          and privilege_type = 'INSERT' and grantee = 'anon'), '[]'::jsonb),
      'update_cols', coalesce((select jsonb_agg(column_name order by column_name)
        from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'request_comments'
          and privilege_type = 'UPDATE' and grantee = 'anon'), '[]'::jsonb)));
  if v_live_acl <> v_prev_acl then
    raise exception 'err.reconcileRollback: ACL request_comments chưa trả về đúng bản ghi. Đang có: % — đã ghi: %', v_live_acl, v_prev_acl;
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

  /* Vẫn không được đụng dữ liệu. */
  if (select count(*) from public.daily_login_rewards) is null then
    raise exception 'err.reconcileRollback: không đọc được daily_login_rewards';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
