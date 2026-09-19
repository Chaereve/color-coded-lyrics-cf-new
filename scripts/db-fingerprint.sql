-- =========================================================
-- DẤU VÂN TAY CỦA SCHEMA PUBLIC — dùng cho cả nguồn lẫn bản phục hồi
-- ---------------------------------------------------------
-- Chạy y hệt câu này trên hai database rồi so từng dòng:
--     pg_dump  → sao lưu → pg_restore → chạy lại → phải giống HỆT
--
-- Vì sao không chỉ so số dòng từng bảng: thiếu một POLICY RLS thì số dòng
-- vẫn khớp nhưng bản phục hồi đã HỞ QUYỀN; thiếu một TRIGGER thì dữ liệu
-- vẫn khớp nhưng mọi bất biến (chống trùng, chống farm vote) biến mất. Ba
-- thứ đó phải nằm trong phép so, không chỉ có dữ liệu.
--
-- Vì sao không so tổng số dòng: một bảng mất 2 dòng còn bảng khác thừa 2
-- dòng vẫn ra "khớp". Mỗi bảng một dòng riêng thì không lách được.
--
-- Chạy bằng:  psql "$URL" -X -q -A -t -f scripts/db-fingerprint.sql
-- =========================================================

select line from (
  -- số dòng của mọi bảng thật trong public
  select 'table|' || c.relname || '|' ||
         (xpath('/row/c/text()', query_to_xml(
            format('select count(*) as c from %I.%I', n.nspname, c.relname),
            false, true, '')))[1]::text as line
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'

  union all
  -- hàm: tên + số lượng (quá tải thì đếm, không liệt kê chữ ký)
  select 'function|' || p.proname || '|' || count(*)::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  group by p.proname

  union all
  -- policy RLS: mất một cái là hở quyền, mà số dòng không đổi
  select 'policy|' || pol.polname || '|' || count(*)::text
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
  group by pol.polname

  union all
  -- trigger (bỏ trigger nội bộ của Postgres: chúng tự sinh theo ràng buộc)
  select 'trigger|' || t.tgname || '|' || count(*)::text
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  group by t.tgname

  union all
  -- sequence: mất sequence thì bản phục hồi vẫn có dữ liệu nhưng id tiếp
  -- theo bắt đầu lại từ 1 và đâm vào khoá chính ngay request kế tiếp
  select 'sequence|' || c.relname || '|0'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'

  union all
  -- index, tính cả index sinh ra bởi ràng buộc unique: mất một unique là mất
  -- luôn tầng chống trùng của lá chắn (một tài khoản vote hai lần), mà bảng
  -- và số dòng thì vẫn khớp hoàn hảo
  select 'index|' || c.relname || '|' || count(*)::text
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
  group by c.relname

  union all
  -- view (kể cả materialized): view public_* là thứ app đọc, mất nó là app
  -- trắng bảng dù dữ liệu còn nguyên
  select 'view|' || c.relname || '|0'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
) f
order by line;
