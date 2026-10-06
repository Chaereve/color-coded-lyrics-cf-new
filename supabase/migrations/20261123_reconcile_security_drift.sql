/* ============================================================================
   20261123_reconcile_security_drift — ĐỒNG BỘ PRODUCTION VỀ TRẠNG THÁI REPO
   ----------------------------------------------------------------------------
   Vì sao có tệp này: `db:verify-baseline -- --baseline 20261120` trả NOT READY
   trên database production. Sau khi tách 147 dòng `missing-constraint …
   expected NOT NULL` (khác biệt CƠ CHẾ CATALOG giữa PostgreSQL 17 và 18 — PG18
   ghi mỗi NOT NULL thêm một dòng trong pg_constraint, PG17 thì không) thì còn
   ĐÚNG HAI khác biệt thật:

     1. policy `request_comments_authenticated_insert` của production yếu hơn
        biểu thức mà repo tạo ra — thiếu điều kiện `deleted_at IS NULL`.
     2. index `requests_picked_idx` của production là `(picked_at DESC)` không
        có predicate, trong khi repo/bundle tạo partial index
        `(picked_at) WHERE picked_at IS NOT NULL`.

   Cộng thêm một việc chỉ là ACL: overload CŨ của `create_request`
   (`(text,text,text,text,text,boolean)`, từ 20261103) vẫn còn EXECUTE cho
   PUBLIC — nên `anon` gọi được. Bản 7 tham số (20261106) đã `revoke all … from
   public, anon, authenticated` rồi `grant … to authenticated`, nhưng 20261103
   chỉ GRANT cho `authenticated` mà không revoke mặc định, nên quyền PUBLIC mặc
   định của PostgreSQL còn nguyên. Overload cũ KHÔNG có `for update` trên
   `profiles` như bản mới, nên phép đếm-rồi-chèn của nó là racy: nhiều lời gọi
   song song cùng lọt qua giới hạn 3 request/giờ, và nó cũng bỏ qua yêu cầu
   phải có hàng `profiles`.

   PHẠM VI (đúng bốn việc, không hơn):
     A. siết policy về đúng biểu thức của repo;
     B. dựng lại `requests_picked_idx` thành partial index của repo;
     C. đóng overload CŨ của `create_request` cho mọi client role + dọn ACL của
        ba hàm do migration cũ của repo tạo mà chưa revoke khỏi PUBLIC
        (`admin_expire_request`, `queue_expired_requests`,
        `requests_video_url_guard`);
     D. đưa quyền trên `public.request_comments` về đúng trạng thái bundle:
        KHÔNG còn INSERT/UPDATE mức bảng cho client role, chỉ INSERT theo bốn cột
        `(request_id, user_id, parent_id, body)` — tức client không thể tự đặt
        `deleted_at` khi tạo comment (20261107_comments_spin_fixes.sql, chunk
        08). Đây là nửa còn lại của cùng một lỗ: policy yếu + quyền bảng rộng thì
        một comment tự-ẩn (hoặc reply vào comment đã ẩn) là hàng hợp lệ về quyền.
        Lưu ý: ACL KHÔNG nằm trong fingerprint nên verifier không bao giờ báo
        mục này — vì thế nó phải được kiểm bằng tay (xem C3 bên dưới).

   KHÔNG làm gì khác: không DROP TABLE, không DELETE/TRUNCATE, không UPDATE dữ
   liệu, không đụng bảng quiz, không đổi `daily_login_rewards`, không bật
   `free_vote_grant_enabled`, không tạo bảng/object mới (comment là metadata,
   không phải object mới nên fingerprint không đổi).

   FAIL-CLOSED: mỗi phần đọc trạng thái sống trước; trạng thái nào không thuộc
   nhóm đã biết thì RAISE và cả tệp abort — không "sửa cho qua". Trạng thái
   trước khi đổi được ghi lại vào COMMENT của chính policy/index để rollback
   khôi phục đúng nguyên văn và để người sau đọc được đã đổi cái gì.
   ============================================================================ */
begin;

/* ---------------------------------------------------------------------------
   0. TIỀN KIỂM TRA — abort trước khi chạm bất cứ thứ gì
   --------------------------------------------------------------------------- */
do $$
declare
  v_pol_cmd "char";
  v_pol_roles text[];
  v_live text;
  v_fp text;
  v_earnings bigint;
begin
  /* --- A. policy phải tồn tại, đúng INSERT/authenticated ------------------ */
  select p.polcmd,
         (select array_agg(r.rolname::text order by r.rolname) from pg_roles r where r.oid = any(p.polroles)),
         pg_get_expr(p.polwithcheck, p.polrelid)
    into v_pol_cmd, v_pol_roles, v_live
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';

  if v_live is null then
    raise exception 'err.reconcilePreflight: policy request_comments_authenticated_insert không tồn tại trên public.request_comments';
  end if;
  if v_pol_cmd <> 'a' then
    raise exception 'err.reconcilePreflight: policy phải là INSERT, đang là %', v_pol_cmd;
  end if;
  if v_pol_roles <> array['authenticated']::text[] then
    raise exception 'err.reconcilePreflight: policy phải chỉ áp cho authenticated, đang áp cho %', v_pol_roles;
  end if;

  /* Chỉ nhận đúng hai hình dạng đã biết: biểu thức chặt của repo (đã xong), hoặc
     dạng yếu `auth.uid() = user_id` mà báo cáo drift đo được. Hình dạng thứ ba
     nào cũng là trạng thái lạ ⇒ dừng và in nguyên văn ra cho người đọc. */
  v_fp := translate(regexp_replace(coalesce(v_live, ''), '\s+', '', 'g'), '()', '');
  if v_fp <> translate(regexp_replace('auth.uid() = user_id', '\s+', '', 'g'), '()', '') and v_fp <> (
       select translate(regexp_replace(
         '((auth.uid() = user_id) AND (deleted_at IS NULL) AND ((parent_id IS NULL) OR (EXISTS ( SELECT 1 FROM request_comments p WHERE ((p.id = request_comments.parent_id) AND (p.request_id = request_comments.request_id) AND (p.deleted_at IS NULL))))))',
       '\s+', '', 'g'), '()', '')) then
    raise exception 'err.reconcilePreflight: policy có biểu thức KHÁC cả trước lẫn sau — cần người đọc. Đang có: %', v_live;
  end if;

  /* --- B. index phải là một trong hai hình dạng đã biết ------------------- */
  if to_regclass('public.requests_picked_idx') is null then
    raise exception 'err.reconcilePreflight: index requests_picked_idx không tồn tại';
  end if;
  if (select pg_get_indexdef(c.oid) from pg_class c where c.oid = 'public.requests_picked_idx'::regclass)
     not like '%WHERE (picked_at IS NOT NULL)%'
     and (select pg_get_indexdef(c.oid) from pg_class c where c.oid = 'public.requests_picked_idx'::regclass)
     not like '%(picked_at DESC)%' then
    raise exception 'err.reconcilePreflight: requests_picked_idx có định nghĩa KHÁC cả hai dạng đã biết — cần người đọc. Đang có: %',
      (select pg_get_indexdef(c.oid) from pg_class c where c.oid = 'public.requests_picked_idx'::regclass);
  end if;

  /* --- Chụp số hàng NGAY ĐẦU transaction để hậu kiểm so lại được ----------
     `daily_vote_quota_earnings` chỉ tồn tại SAU 20261121, nên không được nhắc
     tĩnh trong câu SQL (PostgreSQL phân tích cú pháp trước khi chạy): đếm bằng
     dynamic SQL khi bảng có mặt. */
  v_earnings := -1;
  if to_regclass('public.daily_vote_quota_earnings') is not null then
    execute 'select count(*) from public.daily_vote_quota_earnings' into v_earnings;
  end if;
  perform set_config('ccl.reconcile.rowcounts', (jsonb_build_object(
      'requests', (select count(*) from public.requests),
      'request_comments', (select count(*) from public.request_comments),
      'notifications', (select count(*) from public.notifications),
      'daily_login_rewards', (select count(*) from public.daily_login_rewards),
      'daily_quiz_questions', (select count(*) from public.daily_quiz_questions),
      'daily_quiz_config', (select count(*) from public.daily_quiz_config),
      'daily_quiz_attempts', (select count(*) from public.daily_quiz_attempts),
      'daily_quiz_answers', (select count(*) from public.daily_quiz_answers),
      'daily_quiz_seen', (select count(*) from public.daily_quiz_seen))
    || jsonb_build_object('vote_earnings', v_earnings))::text, true);

  /* --- C. bản create_request ĐANG DÙNG (7 tham số) phải tồn tại ----------- */
  if to_regprocedure('public.create_request(text,text,text,text,text,boolean,boolean)') is null then
    raise exception 'err.reconcilePreflight: thiếu create_request(text,text,text,text,text,boolean,boolean) — bản đang dùng. Không đóng overload cũ khi bản mới vắng mặt.';
  end if;
  if not has_function_privilege('authenticated',
       'public.create_request(text,text,text,text,text,boolean,boolean)'::regprocedure, 'EXECUTE') then
    raise exception 'err.reconcilePreflight: authenticated KHÔNG gọi được bản create_request 7 tham số — sẽ khoá luôn đường tạo request.';
  end if;
end $$;

/* ---------------------------------------------------------------------------
   A. SIẾT POLICY VỀ ĐÚNG BIỂU THỨC CỦA REPO
   ---------------------------------------------------------------------------
   Nguyên văn dưới đây là bản cuối trong supabase/schema.sql (và migration
   20261107_comments_spin_fixes.sql), chép y nguyên để câu lệnh ALTER deparse ra
   đúng chuỗi mà fingerprint 20261120 mong đợi. */
do $$
declare
  v_live text;
  v_strict constant text :=
    'auth.uid() = user_id and deleted_at is null
     and (parent_id is null or exists (
       select 1 from public.request_comments p
        where p.id = request_comments.parent_id
          and p.request_id = request_comments.request_id
          and p.deleted_at is null
     ))';
begin
  select pg_get_expr(p.polwithcheck, p.polrelid) into v_live
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';

  /* Ghi nguyên văn trạng thái TRƯỚC vào comment của policy: rollback đọc lại
     chính chuỗi này (không phải đoán), và người kiểm toán thấy được đã đổi gì. */
  execute format('comment on policy %I on public.request_comments is %L',
    'request_comments_authenticated_insert',
    '20261123 ghi lại trước khi siết — biểu thức WITH CHECK cũ: ' || v_live);

  execute format('alter policy %I on public.request_comments with check (%s)',
    'request_comments_authenticated_insert', v_strict);
end $$;

/* ---------------------------------------------------------------------------
   B. DỰNG LẠI requests_picked_idx THÀNH PARTIAL INDEX CỦA REPO
   ---------------------------------------------------------------------------
   Bản `(picked_at DESC)` phục vụ được cả truy vấn sắp xếp giảm dần, nhưng repo
   (20260905_pick_lock.sql, schema.sql) và mọi baseline đều là partial index
   `WHERE picked_at IS NOT NULL`: nhỏ hơn, và mọi truy vấn của app đều hỏi
   "request đã được pick", tức luôn kèm `picked_at is not null`.
   Định nghĩa trước khi đổi được ghi vào comment của index để rollback khôi
   phục đúng nguyên văn.
   LƯU Ý KHOÁ: CREATE INDEX (không CONCURRENTLY) lấy SHARE lock trên
   public.requests và chặn ghi trong lúc dựng; runner bọc tệp này trong một
   transaction nên không dùng được CONCURRENTLY. Bảng requests hiện vài nghìn
   hàng ⇒ cửa sổ rất ngắn: đo được 4 ms cho drop+create trên 5.000 hàng
   (supabase/tests/securityReconcile.test.js, bài "cửa sổ khoá của phần B"). */
do $$
declare
  v_def text;
begin
  select pg_get_indexdef(c.oid) into v_def from pg_class c where c.oid = 'public.requests_picked_idx'::regclass;
  if v_def like '%WHERE (picked_at IS NOT NULL)%' then
    raise notice '20261123: requests_picked_idx đã là partial index của repo — bỏ qua phần B';
  else
    drop index public.requests_picked_idx;
    create index requests_picked_idx on public.requests (picked_at) where picked_at is not null;
    /* Gắn định nghĩa CŨ lên index MỚI (index cũ vừa bị drop nên comment trên nó
       sẽ mất): rollback đọc lại đúng chuỗi này thay vì đoán. */
    execute format('comment on index public.requests_picked_idx is %L',
      '20261123 ghi lại trước khi đổi — định nghĩa cũ: ' || v_def);
  end if;
end $$;

/* ---------------------------------------------------------------------------
   C1. ĐÓNG OVERLOAD CŨ CỦA create_request
   ---------------------------------------------------------------------------
   Không DROP: bundle cũ còn trong cache trình duyệt gọi hàm này. Giữ hàm lại
   nhưng rút quyền thì PostgREST trả 42501 "permission denied for function", và
   `errMsg` của app đã biến đúng dạng lỗi đó thành câu mời nạp lại trang
   (src/lib/i18n.jsx, err.featureRetiredClient) — người dùng cũ nhận một câu xử
   lý được thay vì lỗi thô. DROP sẽ cho PGRST202 "could not find the function",
   tức câu generic — nên DROP để giai đoạn dọn dẹp riêng, sau khi hết bundle cũ. */
do $$
begin
  if to_regprocedure('public.create_request(text,text,text,text,text,boolean)') is null then
    raise notice '20261123: overload cũ create_request(...5 tham số) không còn — bỏ qua phần C1';
  else
    execute 'revoke all on function public.create_request(text,text,text,text,text,boolean) from public, anon, authenticated';
    execute 'comment on function public.create_request(text,text,text,text,text,boolean) is ' ||
      quote_literal('20261123: đã rút EXECUTE khỏi public/anon/authenticated. Đây là overload 20261103 (không có `for update` trên profiles nên giới hạn 3 request/giờ là racy, và không đòi hàng profiles). '
        || 'Rollback: supabase/rollback/20261123_reconcile_security_drift.sql. Giai đoạn dọn dẹp có thể DROP sau khi hết bundle cũ.');
  end if;
end $$;

/* ---------------------------------------------------------------------------
   C2. DỌN ACL CỦA BA HÀM DO MIGRATION CŨ TẠO MÀ CHƯA REVOKE KHỎI PUBLIC
   ---------------------------------------------------------------------------
   Cả ba đều SECURITY DEFINER. `queue_expired_requests()` GHI dữ liệu
   (expired_at + notifications) và không kiểm tra người gọi; `admin_expire_request`
   có kiểm `is_admin()` nhưng vẫn không cần thiết phải mở cho PUBLIC;
   `requests_video_url_guard()` là hàm trigger — không client nào cần EXECUTE.
   Giữ đúng quyền mà migration gốc muốn: authenticated cho admin_expire_request,
   service_role cho queue_expired_requests (cron chạy bằng owner nên không cần). */
do $$
begin
  if to_regprocedure('public.admin_expire_request(uuid)') is not null then
    execute 'revoke all on function public.admin_expire_request(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.admin_expire_request(uuid) to authenticated';
  else
    raise notice '20261123: admin_expire_request(uuid) không có — bỏ qua';
  end if;

  if to_regprocedure('public.queue_expired_requests()') is not null then
    execute 'revoke all on function public.queue_expired_requests() from public, anon, authenticated';
    execute 'grant execute on function public.queue_expired_requests() to service_role';
  else
    raise notice '20261123: queue_expired_requests() không có — bỏ qua';
  end if;

  if to_regprocedure('public.requests_video_url_guard()') is not null then
    execute 'revoke all on function public.requests_video_url_guard() from public, anon, authenticated';
  else
    raise notice '20261123: requests_video_url_guard() không có — bỏ qua';
  end if;
end $$;

/* ---------------------------------------------------------------------------
   C3. QUYỀN TRÊN public.request_comments — trạng thái bundle, không phải bảng mở
   ---------------------------------------------------------------------------
   Bundle (20261107) cấp quyền theo CỘT. Bản cũ hơn (20260920) cấp `insert,
   update` mức BẢNG, và nếu production còn ở trạng thái đó thì client tự đặt
   được `deleted_at` lúc INSERT. Hai câu dưới là bản sao nguyên văn của
   20261107_comments_spin_fixes.sql, nên chạy trên database đã đúng là no-op. */
do $$
begin
  execute 'revoke insert, update on public.request_comments from anon, authenticated';
  execute 'grant insert (request_id, user_id, parent_id, body) on public.request_comments to authenticated';
end $$;

/* ---------------------------------------------------------------------------
   1. HẬU KIỂM TRA — trong cùng transaction; sai một mục là abort cả tệp
   --------------------------------------------------------------------------- */
do $$
declare
  v_live text;
  v_def text;
  v_acl jsonb;
  v_counts jsonb;
  v_reward_triggers int;
  v_earnings bigint;
begin
  /* A. policy đã đúng biểu thức chặt (so khớp token, bỏ paren/khoảng trắng) */
  select pg_get_expr(p.polwithcheck, p.polrelid) into v_live
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'request_comments'
     and p.polname = 'request_comments_authenticated_insert';
  if translate(regexp_replace(v_live, '\s+', '', 'g'), '()', '') <> (
       select translate(regexp_replace(
         '((auth.uid() = user_id) AND (deleted_at IS NULL) AND ((parent_id IS NULL) OR (EXISTS ( SELECT 1 FROM request_comments p WHERE ((p.id = request_comments.parent_id) AND (p.request_id = request_comments.request_id) AND (p.deleted_at IS NULL))))))',
         '\s+', '', 'g'), '()', '')) then
    raise exception 'err.reconcilePostcheck: policy sau khi siết không khớp biểu thức repo. Đang có: %', v_live;
  end if;

  /* B. index đã là partial index của repo */
  select pg_get_indexdef(c.oid) into v_def from pg_class c where c.oid = 'public.requests_picked_idx'::regclass;
  if v_def not like '%WHERE (picked_at IS NOT NULL)%' then
    raise exception 'err.reconcilePostcheck: requests_picked_idx chưa phải partial index. Đang có: %', v_def;
  end if;

  /* C1. overload cũ đã đóng với mọi client role */
  if to_regprocedure('public.create_request(text,text,text,text,text,boolean)') is not null then
    select jsonb_build_object(
      'public', has_function_privilege('public', 'public.create_request(text,text,text,text,text,boolean)'::regprocedure, 'EXECUTE'),
      'anon', has_function_privilege('anon', 'public.create_request(text,text,text,text,text,boolean)'::regprocedure, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', 'public.create_request(text,text,text,text,text,boolean)'::regprocedure, 'EXECUTE'))
      into v_acl;
    if (v_acl ->> 'public')::boolean or (v_acl ->> 'anon')::boolean or (v_acl ->> 'authenticated')::boolean then
      raise exception 'err.reconcilePostcheck: overload cũ create_request vẫn còn EXECUTE cho client role: %', v_acl;
    end if;
  end if;

  /* C2. ba hàm chỉ còn đúng quyền đã định */
  if to_regprocedure('public.queue_expired_requests()') is not null then
    if has_function_privilege('anon', 'public.queue_expired_requests()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.queue_expired_requests()', 'EXECUTE') then
      raise exception 'err.reconcilePostcheck: queue_expired_requests() vẫn mở cho client role';
    end if;
  end if;
  if to_regprocedure('public.requests_video_url_guard()') is not null then
    if has_function_privilege('anon', 'public.requests_video_url_guard()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.requests_video_url_guard()', 'EXECUTE') then
      raise exception 'err.reconcilePostcheck: requests_video_url_guard() vẫn mở cho client role';
    end if;
  end if;

  /* C3. quyền bảng comment: không mức-bảng cho client role, đúng bốn cột */
  if has_table_privilege('authenticated', 'public.request_comments', 'INSERT')
     or has_table_privilege('anon', 'public.request_comments', 'INSERT')
     or has_table_privilege('authenticated', 'public.request_comments', 'UPDATE') then
    raise exception 'err.reconcilePostcheck: public.request_comments còn INSERT/UPDATE mức bảng cho client role';
  end if;
  if not has_column_privilege('authenticated', 'public.request_comments', 'request_id', 'INSERT')
     or not has_column_privilege('authenticated', 'public.request_comments', 'body', 'INSERT')
     or not has_column_privilege('authenticated', 'public.request_comments', 'parent_id', 'INSERT')
     or not has_column_privilege('authenticated', 'public.request_comments', 'user_id', 'INSERT') then
    raise exception 'err.reconcilePostcheck: thiếu quyền INSERT theo cột cho authenticated (app sẽ không gửi được comment)';
  end if;
  if has_column_privilege('authenticated', 'public.request_comments', 'deleted_at', 'INSERT') then
    raise exception 'err.reconcilePostcheck: authenticated vẫn đặt được deleted_at khi INSERT — đúng lỗ mà policy phải chặn';
  end if;

  /* D. KHÔNG có dòng dữ liệu nào đổi: đếm lại y hệt cách đã chụp ở tiền kiểm
        tra và so nguyên khối. Đây là điều kiện cứng: lệch một bảng là abort,
        kể cả khi nguyên nhân là "chỉ vừa có người dùng ghi" — migration này
        không được phép chạy trong lúc bảng đang nhận ghi mới. */
  v_earnings := -1;
  if to_regclass('public.daily_vote_quota_earnings') is not null then
    execute 'select count(*) from public.daily_vote_quota_earnings' into v_earnings;
  end if;
  select jsonb_build_object(
    'requests', (select count(*) from public.requests),
    'request_comments', (select count(*) from public.request_comments),
    'notifications', (select count(*) from public.notifications),
    'daily_login_rewards', (select count(*) from public.daily_login_rewards),
    'daily_quiz_questions', (select count(*) from public.daily_quiz_questions),
    'daily_quiz_config', (select count(*) from public.daily_quiz_config),
    'daily_quiz_attempts', (select count(*) from public.daily_quiz_attempts),
    'daily_quiz_answers', (select count(*) from public.daily_quiz_answers),
    'daily_quiz_seen', (select count(*) from public.daily_quiz_seen))
    || jsonb_build_object('vote_earnings', v_earnings)
    into v_counts;
  if v_counts <> current_setting('ccl.reconcile.rowcounts')::jsonb then
    raise exception 'err.reconcilePostcheck: số hàng đã đổi giữa đầu và cuối migration. Trước: % — sau: %',
      current_setting('ccl.reconcile.rowcounts'), v_counts;
  end if;

  /* E. trigger bất biến của lịch điểm danh vẫn sống (không được để reconcile
        làm rơi thứ mà 20261122 cần cho preflight của nó) */
  select count(*) into v_reward_triggers from pg_trigger
   where tgrelid = 'public.daily_login_rewards'::regclass and not tgisinternal;
  if v_reward_triggers <> 1 then
    raise exception 'err.reconcilePostcheck: daily_login_rewards phải còn đúng 1 trigger, đang có %', v_reward_triggers;
  end if;

  raise notice '20261123 reconcile xong: %', v_counts;
end $$;

/* PostgREST giữ schema cache; policy/quyền vừa đổi thì phải nạp lại. */
notify pgrst, 'reload schema';

commit;
