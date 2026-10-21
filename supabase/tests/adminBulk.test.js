/* Chốt chặn cho migration 20261212 — đọc tệp, không cần database.
   ---------------------------------------------------------
   Bốn hàm *_many và một hàm đọc bình luận là thứ giao diện mới gọi tới. Nếu
   một trong số chúng biến mất (ai đó dọn "hàm không dùng" mà không biết web
   đang gọi), lỗi chỉ lộ ra khi admin bấm nút hàng loạt giữa lúc đang làm việc
   — đúng loại lỗi mà test tệp rẻ hơn nhiều so với việc phát hiện tại chỗ.

   Điều phải chốt:
     1. Đủ năm hàm, đúng chữ ký mà src/lib/db.js truyền tham số vào.
     2. MỌI hàm đều kiểm public.is_admin() trước khi làm việc.
     3. Chỉ cấp execute cho authenticated — không anon, không public.
     4. Không có câu lệnh phá dữ liệu (drop table / truncate / delete không
        kèm where trên bảng lịch sử).
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../migrations/', import.meta.url))
const file = readdirSync(dir).find(name => name.startsWith('20261212_'))
const sql = file ? readFileSync(dir + file, 'utf8') : ''
const auditFile = readdirSync(dir).find(name => name.startsWith('20261213_'))
const auditSql = auditFile ? readFileSync(dir + auditFile, 'utf8') : ''
const auditCode = auditSql.replace(/--.*$/gm, ' ')
/* Bản không chú thích: phần đầu tệp nhắc tới DROP/TRUNCATE để nói rằng nó
   KHÔNG làm những việc đó — soi nguyên văn là bắt nhầm tài liệu. */
const code = sql.replace(/--.*$/gm, ' ')

test('migration 20261212 tồn tại và là migration .sql thật', () => {
  assert.ok(file, 'thiếu migration 20261212_admin_bulk_and_comments_page.sql')
  assert.match(file, /\.sql$/, 'tệp phải có đuôi .sql để runner nhìn thấy')
})

test('đủ năm hàm mà bảng quản trị gọi, đúng chữ ký', () => {
  /* Chữ ký dưới đây khớp CHÍNH XÁC object tham số trong src/lib/db.js:
       admin_review_many  { p_ids, p_approve, p_reason, p_video_url }
       admin_update_many  { p_ids, ...adminUpdateParams(patch) }
       admin_delete_many  { p_ids }
       admin_pick_many    { p_ids, p_picked }
       admin_comments_page{ p_q, p_limit, p_offset }
     Lệch một tham số là PostgREST trả PGRST202 và giao diện rơi về đường cũ
     trong im lặng — chạy được nhưng chậm, đúng thứ không ai phát hiện. */
  const signatures = [
    ['admin_review_many', /create or replace function public\.admin_review_many\(\s*p_ids uuid\[\],\s*p_approve boolean,\s*p_reason text default null,\s*p_video_url text default null\s*\)/],
    ['admin_update_many', /create or replace function public\.admin_update_many\(\s*p_ids uuid\[\],[\s\S]{0,400}?p_title text default null\s*\)/],
    ['admin_delete_many', /create or replace function public\.admin_delete_many\(p_ids uuid\[\]\)/],
    ['admin_pick_many', /create or replace function public\.admin_pick_many\(p_ids uuid\[\], p_picked boolean default true\)/],
    ['admin_comments_page', /create or replace function public\.admin_comments_page\(\s*p_q text default null,\s*p_limit int default 20,\s*p_offset int default 0\s*\)/],
  ]
  for (const [name, re] of signatures) {
    assert.match(sql, re, `${name}: chữ ký lệch khỏi thứ src/lib/db.js gọi`)
  }
})

test('mọi hàm đều tự kiểm is_admin — không dựa vào cờ phía trình duyệt', () => {
  const bodies = code.split('create or replace function').slice(1)
  assert.equal(bodies.length, 6, 'admin_fold + năm hàm nghiệp vụ')
  for (const body of bodies) {
    const name = body.match(/public\.(\w+)/)?.[1]
    /* admin_fold chỉ là hàm dịch ký tự — nó không đọc/ghi dữ liệu nào, nên
       không cần (và không nên) đòi quyền admin. Năm hàm còn lại đều đụng bảng. */
    if (name === 'admin_fold') continue
    assert.match(body, /if not public\.is_admin\(\) then raise exception 'err\.adminOnly'; end if;/,
      `${name}: thiếu chốt is_admin`)
  }
})

test('chỉ role authenticated được gọi — public và anon bị thu hồi', () => {
  for (const name of ['admin_review_many', 'admin_update_many', 'admin_delete_many',
    'admin_pick_many', 'admin_comments_page', 'admin_fold']) {
    const revoke = new RegExp(`revoke all on function public\\.${name}\\(`)
    assert.match(sql, revoke, `${name}: thiếu revoke khỏi public/anon`)
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s*to authenticated`),
      `${name}: thiếu grant cho authenticated`)
  }
  assert.doesNotMatch(sql, /grant execute on function public\.admin_\w+\([^)]*\)\s*to anon/,
    'không hàm quản trị nào được cấp cho anon')
})

test('trần 200 dòng và không có câu lệnh phá dữ liệu', () => {
  assert.match(sql, /cardinality\(p_ids\) > 200 then raise exception 'err\.bulkTooMany'/, 'thiếu trần số dòng')
  /* Bỏ chú thích trước khi soi: câu "không DROP/TRUNCATE bảng nào" trong phần
     đầu tệp là tài liệu, không phải lệnh. */
  assert.doesNotMatch(code, /drop table|truncate|delete from public\.(requests|orders|request_comments)\s*;/i,
    'migration chỉ được thêm hàm, không được xoá dữ liệu')
  assert.match(sql, /notify pgrst, 'reload schema'/, 'thiếu reload schema cache của PostgREST')
})

/* ---------------- 20261213: nhật ký + sửa request đầy đủ ---------------- */

test('migration 20261213 có bảng nhật ký, trigger và RPC sửa request', () => {
  assert.ok(auditFile, 'thiếu migration 20261213_admin_actions_and_request_edit.sql')
  assert.match(auditSql, /create table if not exists public\.admin_actions/, 'thiếu bảng nhật ký')
  /* Ghi bằng trigger, không phải bằng cách nhớ gọi hàm log trong từng RPC:
     mọi đường đi (web, RPC, SQL tay) đều phải để lại dấu. */
  assert.match(auditSql, /create trigger requests_admin_audit[\s\S]{0,160}log_admin_action\(\)/,
    'thiếu trigger trên bảng requests')
  assert.match(auditSql, /create trigger orders_admin_audit[\s\S]{0,160}log_admin_order\(\)/,
    'thiếu trigger trên bảng orders')
  assert.match(auditSql, /create or replace function public\.admin_actions_page\(p_limit int default 20, p_offset int default 0\)/,
    'chữ ký admin_actions_page lệch khỏi thứ src/lib/db.js gọi')
  assert.match(auditSql, /create or replace function public\.admin_request_edit\(\s*p_id uuid,\s*p_kind text default null,\s*p_note text default null,\s*p_is_paid boolean default null,\s*p_requester text default null\s*\)/,
    'chữ ký admin_request_edit lệch khỏi thứ src/lib/db.js gọi')
})

test('nhật ký: chỉ admin đọc được, và KHÔNG ai chèn tay được một dòng', () => {
  assert.match(auditSql, /alter table public\.admin_actions enable row level security/)
  assert.match(auditSql, /create policy admin_actions_read on public\.admin_actions\s*\n?\s*for select to authenticated using \(public\.is_admin\(\)\)/,
    'policy đọc phải giới hạn ở admin')
  /* Không có policy INSERT/UPDATE/DELETE: dòng nhật ký chỉ đi vào qua trigger
     security definer, nên client không đổ tội cho người khác được. */
  assert.doesNotMatch(auditCode, /create policy \w+ on public\.admin_actions\s+(for )?(insert|update|delete|all)/i,
    'không được mở đường ghi trực tiếp vào nhật ký')
  assert.match(auditSql, /revoke all on public\.admin_actions from anon, authenticated/,
    'thu hồi quyền mặc định trước khi cấp đúng quyền đọc')
})

test('nhật ký chỉ ghi khi NGƯỜI GỌI là admin — người dùng tự sửa bài không làm đầy nhật ký', () => {
  const bodies = auditCode.split('create or replace function').slice(1)
  const byName = Object.fromEntries(bodies.map(b => [b.match(/public\.(\w+)/)?.[1], b]))
  for (const name of ['log_admin_action', 'log_admin_order']) {
    assert.match(byName[name] || '', /if auth\.uid\(\) is null or not public\.is_admin\(\) then/,
      `${name}: thiếu chốt "chỉ ghi khi admin"`)
  }
  /* Hàm trigger không được cấp cho client: gọi tay được là ghi được dòng giả. */
  for (const name of ['log_admin_action', 'log_admin_order']) {
    assert.match(auditSql, new RegExp(`revoke all on function public\\.${name}\\(\\) from public, anon, authenticated`),
      `${name}: không được cấp execute cho client`)
  }
})

test('admin_request_edit chỉ nhận bốn loại bài có thật và không đụng status/tiến độ', () => {
  assert.match(auditSql, /p_kind not in \('Color Coded Lyrics', 'Full Album', '1 Hour Loop', 'Short'\)/,
    'danh sách loại bài phải khớp KIND_META')
  const body = auditCode.split('create or replace function public.admin_request_edit')[1] || ''
  assert.doesNotMatch(body, /status\s*=|progress\s*=|picked_at\s*=/,
    'ba thứ đó có đường riêng; sửa ở đây là mở đường thứ hai lệch luật')
  assert.match(auditSql, /revoke all on function public\.admin_request_edit\(uuid, text, text, boolean, text\) from public, anon;/)
  assert.match(auditSql, /grant execute on function public\.admin_request_edit\(uuid, text, text, boolean, text\) to authenticated;/)
})
