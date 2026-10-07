/* Chốt chặn bảng funnel_events (migrations/20261110_funnel_events.sql).
   ---------------------------------------------------------
   Bảng này là MẮT của quyết định sản phẩm ("metric, not vibes") nhưng nằm
   đúng chỗ dễ phá kỷ luật free-tier nhất: ai đó "thêm nhanh một cron dọn
   dẹp" là ghi đè cam kết không thêm cron; ai đó "cho anon ghi cho đủ số" là
   mở một lỗ spam ghi; ai đó đọc thẳng bảng là biến số liệu sản phẩm thành
   kho dữ liệu định danh. Bốn nhóm chốt dưới đây canh đúng bốn điều đó, và
   cả phép mirror schema.sql ↔ migration (bài học "chạy lại schema là mở lỗ
   hổng cũ"). Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(at(rel), 'utf-8')
const mig = read('../migrations/20261110_funnel_events.sql')
const schema = read('../schema.sql')
/* Từ điển tách sang src/lib/strings.js (JS thuần) 07/10/2026. */
const i18n = read('../../src/lib/strings.js')

test('schema.sql chứa NGUYÊN VĂN migration funnel — cài mới và chạy lại là một', () => {
  assert.ok(schema.includes(mig),
    'schema.sql phải chứa nguyên văn 20261110_funnel_events.sql (append verbatim)')
})

test('free-tier: migration KHÔNG được thêm cron, và tự dọn dòng > 30 ngày', () => {
  assert.doesNotMatch(mig, /cron\.schedule|pg_cron/i,
    'không thêm cron — kể cả pg_cron: RPC tự quét, tối đa 1 lần/ngày qua cờ funnel_purge')
  assert.match(mig, /interval '30 days'/, 'thiếu luật xoá dòng > 30 ngày')
  assert.match(mig, /funnel_purge/, 'thiếu cờ "đã quét hôm nay" — sẽ quét mỗi lần ghi')
  assert.match(mig, /at most|MỘT lần/i, 'phải nói rõ tần suất quét trong chú thích')
})

test('đường ghi/đọc bị khoá đúng: chỉ RPC, chỉ authenticated ghi, chỉ admin đọc', () => {
  assert.match(mig, /revoke all on public\.funnel_events from public, anon, authenticated/,
    'phải revoke all — bảng sản phẩm không có đường CRUD trực tiếp')
  assert.match(mig, /revoke all on function public\.track_funnel\(text, jsonb\) from public, anon/,
    'track_funnel không được callable bởi anon/public')
  assert.match(mig, /grant execute on function public\.track_funnel\(text, jsonb\) to authenticated/)
  assert.match(mig, /public\.is_admin\(\)/, 'funnel_summary phải chặn bằng is_admin()')
  assert.match(mig, /security definer/, 'RPC phải chạy security definer — bảng bị revoke all')
  assert.match(mig, /enable row level security/, 'thiếu RLS')
})

test('meta không được chứa định danh thiết bị, và có trần kích thước', () => {
  assert.match(mig, /pg_column_size\([^)]*\)\s*<=\s*512|pg_column_size\(p_meta\) > 512/,
    'meta phải bị kẹp kích thước (≤ 512 byte)')
  /* BỎ COMMENT trước khi quét: chính chú thích của migration nhắc tới
     "không IP/fingerprint" để CẤM — quét nguyên văn là bắt oan mình. */
  const code = mig.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(code, /fingerprint|ip_hash|user_agent|device/i,
    'funnel là số liệu sản phẩm — không IP/fingerprint/user-agent (xem privacy.html)')
  assert.match(i18n, /'err\.funnelEvent'/, 'err.funnelEvent phải có bản dịch trong i18n')
})
