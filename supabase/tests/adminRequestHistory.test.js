/* Chốt chặn hai migration của vòng "admin P3/P4":
     20261214_request_history.sql        — lịch sử của ĐÚNG MỘT request
     20261215_notify_requester_review.sql — báo người gửi khi duyệt / từ chối
   ---------------------------------------------------------
   Cả hai đều đụng vào đường quyền: một hàm đọc lịch sử quản trị (dữ liệu nội
   bộ) và một hàm ghi hộp thư của NGƯỜI KHÁC. Ba thứ dễ sai và đều im lặng khi
   sai:
     · thiếu `is_admin()` → mọi tài khoản đọc được lịch sử quản trị;
     · thiếu `security definer` + revoke → hàm không chạy được (RLS chặn), hoặc
       tệ hơn là chạy được với quyền của client;
     · `admin_review` ghi tin MỖI LẦN gọi → bấm hai lần là hai tin trùng.
   Không có Postgres ở đây (bộ test thuần đọc file); phần chạy thật nằm ở
   PGlite harness dùng một lần khi soát migration. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(at(rel), 'utf-8')
const hist = read('../migrations/20261214_request_history.sql')
const notify = read('../migrations/20261215_notify_requester_review.sql')
/* Bỏ chú thích trước khi quét: chính chú thích nhắc tới `delete`/`cron` để CẤM
   — quét nguyên văn là bắt oan mình (bài học từ funnel.test.js). */
const code = (sql) => sql.replace(/--[^\n]*/g, '')

test('lịch sử theo request: chỉ admin đọc, chạy definer, cấp đúng một chữ ký', () => {
  const sql = code(hist)
  assert.match(sql, /create or replace function public\.admin_request_history\(p_id uuid, p_limit int default 20\)/)
  assert.match(sql, /security definer/, 'phải chạy definer — bảng admin_actions bị revoke khỏi client')
  assert.match(sql, /if not public\.is_admin\(\) then raise exception 'err\.adminOnly'/,
    'thiếu chặn is_admin: mọi tài khoản đọc được lịch sử quản trị')
  assert.match(sql, /revoke all on function public\.admin_request_history\(uuid, int\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.admin_request_history\(uuid, int\) to authenticated;/)
  /* Đọc thuần: không được ghi gì, kể cả "đánh dấu đã xem". */
  assert.doesNotMatch(sql, /\binsert into\b|\bupdate public\.|\bdelete from\b/,
    'hàm đọc lịch sử không được ghi vào bảng nào')
  assert.match(sql, /where a\.target_id = p_id/, 'phải lọc theo đúng bài, không trả danh sách toàn cục')
  assert.match(sql, /p_id is null/, 'id rỗng phải trả rỗng, không ném lỗi giữa lúc đang mở khung sửa')
})

test('lịch sử theo request: lọc + sắp xếp có index đỡ, và trả cùng hình dạng với trang nhật ký', () => {
  const sql = code(hist)
  assert.match(sql, /create index if not exists admin_actions_target_time_idx\s+on public\.admin_actions \(target_id, created_at desc, id desc\)/,
    'thiếu index (target_id, created_at desc) — mỗi lần mở khung sửa sẽ quét cả lịch sử của bài')
  /* Cùng khoá với `admin_actions_page` để web chỉ cần một cách đọc. */
  for (const key of ['id', 'action', 'target_id', 'label', 'detail', 'created_at', 'actor_name']) {
    assert.ok(sql.includes(`'${key}',`), `thiếu khoá ${key} trong jsonb trả về`)
  }
  assert.match(sql, /'total', v_total/, 'phải trả tổng để màn hình nói được "còn bao nhiêu"')
})

test('báo người gửi: giữ nguyên chữ ký admin_review, chỉ thêm phần ghi tin', () => {
  const sql = code(notify)
  assert.match(sql, /create or replace function public\.admin_review\(p_id uuid, p_approve boolean, p_reason text default null, p_video_url text default null\)/,
    'không được đổi chữ ký — web và admin_review_many đang gọi đúng bốn tham số này')
  assert.match(sql, /returns public\.requests/, 'kiểu trả về phải giữ nguyên')
  assert.match(sql, /if not public\.is_admin\(\) then raise exception 'err\.adminOnly'/,
    'không được làm rơi chặn quyền khi viết lại hàm')
  assert.match(sql, /err\.denyVideo/, 'không được làm rơi phép kiểm link video')
  assert.match(sql, /grant execute on function public\.admin_review\(uuid, boolean, text, text\) to authenticated;/)
  /* Vẫn là chỗ DUY NHẤT đổi status sang queued/denied: thêm một câu update
     thứ hai ở đây là mở đường cho hai bộ luật lệch nhau. */
  assert.equal((sql.match(/update public\.requests/g) || []).length, 1)
})

test('báo người gửi: chỉ báo khi trạng thái THẬT SỰ đổi, và không sinh tin trùng', () => {
  const sql = code(notify)
  assert.match(sql, /select status into v_before from public\.requests where id = p_id for update/,
    'phải đọc trạng thái cũ trước khi update (và khoá dòng để hai lần duyệt không đua nhau)')
  assert.match(sql, /if v_before is distinct from r\.status and r\.user_id is not null then/,
    'bấm Duyệt hai lần không được sinh hai tin; bài không có người gửi thì không có ai để báo')
  assert.match(sql, /'review\|' \|\| r\.id::text \|\| '\|' \|\| r\.status/,
    'sig phải gồm cả trạng thái mới: từ chối rồi duyệt lại là hai sự việc, cùng trạng thái thì một tin')
  assert.match(sql, /on conflict \(user_id, sig\) where sig is not null do nothing/,
    'thiếu chống trùng theo (user_id, sig) — index unique sẽ ném lỗi vào mặt admin')
  assert.match(sql, /case when p_approve then 'approved' else 'denied' end/,
    'hai loại tin đã có sẵn trong check constraint của notifications')
})

test('hai migration không tự chạy job, không xoá dữ liệu, và không đụng bảng khác', () => {
  for (const [name, sql] of [['20261214', hist], ['20261215', notify]]) {
    const body = code(sql)
    assert.doesNotMatch(body, /cron\.schedule|pg_cron/i, `${name}: free-tier — không thêm cron`)
    assert.doesNotMatch(body, /\bdelete from public\./, `${name}: migration không được xoá dữ liệu`)
    assert.doesNotMatch(body, /\bdrop table\b/i, `${name}: không được drop bảng`)
  }
})
