/* CHUỖI NGÀY HOẠT ĐỘNG — khoá luật bằng SỐ và khoá cả hợp đồng schema.
   ---------------------------------------------------------
   Streak là loại tính năng sai mà không ai gọi tên được: đếm thiếu một ngày
   biên thì "chuỗi 7 ngày" thành 6, và người mất badge không biết tại sao.
   Ba nhóm ca:
   1. luật đếm (biên nửa đêm VN, "hôm nay chưa hoạt động thì chuỗi còn sống",
      chỗ đứt, dữ liệu méo);
   2. cột mốc 7/30/100 bám chuỗi DÀI NHẤT — đã mở là không tắt lại;
   3. hợp đồng schema: bảng activity_days + BỐN trigger phải tồn tại ở CẢ
      migration lẫn schema.sql (repo từng hụt một file migration và người làm
      sau cài thiếu trigger — streak im lặng bằng 0 mãi mãi).
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  STREAK_MILESTONES, dayKeys, currentStreak, longestStreak, streakStats, unionActivityDays,
} from './streak.js'

const at = (p) => fileURLToPath(new URL(p, import.meta.url))

/* Chủ nhật 2025-09-21 17:30 UTC = thứ Hai 2025-09-22 00:30 giờ Việt Nam —
   cùng mốc NOW với season.test.js: ngày VN đang là 22/09. */
const NOW = Date.parse('2025-09-21T17:30:00Z')
const seq = (from, n) => Array.from({ length: n }, (_, i) => {
  const ms = Date.parse(`${from}T00:00:00Z`) + i * 86400000
  return new Date(ms).toISOString().slice(0, 10)
})

test('chuỗi hiện tại: hôm nay (giờ VN) chưa có dấu thì LÙI VỀ HÔM QUA mà đếm', () => {
  /* bảy dấu 15→21/09; ngày VN hiện tại là 22/09 và chưa có dấu nào */
  const days = seq('2025-09-15', 7)
  assert.equal(currentStreak(days, NOW), 7,
    '9 giờ sáng chưa hoạt động không được coi là đứt chuỗi — nó chỉ đứt khi hết ngày')
  /* có dấu của đúng ngày VN hiện tại thì tính cả hôm nay */
  assert.equal(currentStreak([...days, '2025-09-22'], NOW), 8)
  /* đứt một ngày giữa chừng: chuỗi chỉ còn phần đuôi */
  assert.equal(currentStreak([...seq('2025-09-19', 3), '2025-09-15'], NOW), 3)
  /* dấu cũ rích, hôm qua trống trơn: chuỗi đã chết, trả 0 chứ không đếm đuôi cũ */
  assert.equal(currentStreak(['2025-09-10'], NOW), 0)
})

test('biên nửa đêm giờ VN: một dấu đúng ngày VN là đủ, lệch múi giờ là sai liền', () => {
  /* 16:59 UTC Chủ nhật vẫn là Chủ nhật 21/09 theo giờ VN */
  const sun = Date.parse('2025-09-21T16:59:00Z')
  assert.equal(currentStreak(['2025-09-21'], sun), 1)
  /* qua 17:00 UTC là sang ngày VN mới: dấu Chủ nhật trở thành "hôm qua còn sống" */
  assert.equal(currentStreak(['2025-09-21'], NOW), 1)
  /* và nếu chỉ có dấu của ngày VN hiện tại thì không được đếm lùi thêm */
  assert.equal(currentStreak(['2025-09-22'], NOW), 1)
})

test('chuỗi dài nhất: chỗ đứt bắt nhịp mới, không cộng dồn qua lỗ hổng', () => {
  assert.equal(longestStreak([...seq('2025-09-01', 3), ...seq('2025-09-05', 6)]), 6)
  assert.equal(longestStreak([]), 0)
  assert.equal(longestStreak(seq('2025-09-01', 1)), 1)
})

test('dữ liệu méo không làm streak ném lỗi (kể cả ngày "hợp khuôn nhưng không thật")', () => {
  /* '2025-13-45' khớp khuôn YYYY-MM-DD nhưng Date.parse ra NaN — nếu lọt vào,
     toISOString() trên ngày NaN ném RangeError thẳng vào render */
  const junk = [null, 'hello', '2025-13-45', '2025-09-05T10:00:00Z', 1758000000000]
  assert.deepEqual([...dayKeys(junk)], [], 'mọi key méo phải bị lọc')
  assert.equal(longestStreak([...junk, '2025-09-05']), 1)
  assert.equal(currentStreak(junk, NOW), 0)
})

test('cột mốc 7/30/100 bám chuỗi DÀI NHẤT — đã mở là không tắt lại', () => {
  assert.deepEqual(STREAK_MILESTONES, [7, 30, 100])
  assert.deepEqual(streakStats(seq('2025-09-15', 7), NOW).earned, [7], 'đúng 7 ngày: mở mốc 7')
  assert.deepEqual(streakStats(seq('2025-08-23', 30), NOW).earned, [7, 30])
  assert.deepEqual(streakStats(seq('2025-06-14', 100), NOW).earned, [7, 30, 100])
  assert.deepEqual(streakStats(seq('2025-09-16', 6), NOW).earned, [], '6 ngày: chưa mở gì')
  /* chuỗi hiện tại ĐỨT nhưng quá khứ từng 30 ngày: mốc vẫn sáng (thành tích) */
  const past = seq('2025-07-01', 30)
  const s = streakStats([...past, '2025-09-10'], NOW)
  assert.deepEqual(s.earned, [7, 30], 'badge không tắt khi chuỗi hiện tại đứt')
  assert.equal(s.current, 0, 'nhưng chuỗi hiện tại thì phải nói thật là đã đứt')
})

/* ---------- hợp đồng schema ---------- */
const MIG = 'supabase/migrations/20260921_activity_days.sql'
const mig = readFileSync(at(`../../${MIG}`), 'utf8')
const schema = readFileSync(at('../../supabase/schema.sql'), 'utf8')

test('ngày server vừa đóng dấu được ghép vào, nhưng nguồn chưa đọc thì không bịa danh sách', () => {
  assert.equal(unionActivityDays(null, '2025-09-22'), null)
  assert.deepEqual(unionActivityDays(['2025-09-21'], '2025-09-22'), ['2025-09-22', '2025-09-21'])
  assert.deepEqual(unionActivityDays(['2025-09-22'], '2025-09-22'), ['2025-09-22'], 'không nhân đôi cùng một ngày')
  assert.deepEqual(unionActivityDays(['2025-09-21'], '2025-09-22T00:00:00Z'), ['2025-09-21'], 'ngày client tự chế không được nhận')
  assert.equal(currentStreak(unionActivityDays(seq('2025-09-15', 7), '2025-09-22'), NOW), 8)
})

test('migration tồn tại và schema.sql hợp nhất NGUYÊN VĂN (bài học hụt file 20261104)', () => {
  for (const frag of [
    'create table if not exists public.activity_days',
    'create trigger activity_on_request', 'create trigger activity_on_vote',
    'create trigger activity_on_comment', 'create trigger activity_on_spin',
    "at time zone 'Asia/Ho_Chi_Minh'",
    'revoke insert, update, delete on public.activity_days',
  ]) {
    assert.ok(mig.includes(frag), `migration thiếu: ${frag}`)
    assert.ok(schema.includes(frag), `schema.sql chưa hợp nhất: ${frag}`)
  }
  /* đọc công khai như bảng xếp hạng, ghi CHỈ qua trigger */
  assert.match(mig, /create policy "read activity days"[\s\S]*for select using \(true\)/)
})

test('db.js: lỗi đọc activity_days trả NULL (ẩn dải), không phải mảng rỗng (nói dối)', () => {
  const src = readFileSync(at('./db.js'), 'utf8')
  const fn = src.slice(src.indexOf('export async function fetchActivityDays'))
  assert.match(fn.slice(0, fn.indexOf('\n}')), /if \(error\) return null/)
  assert.match(fn, /demoActivityDays/, 'chế độ demo phải có bản gương của trigger')
  assert.match(fn, /\.range\(from, from \+ pageSize - 1\)/, 'không cắt mất chuỗi dài ở trần 400 hàng')
})

test('ngày ghé do server đóng, client không được gửi ngày hay user id', () => {
  const visit = readFileSync(at('../../supabase/migrations/20261109_activity_visit.sql'), 'utf8')
  const schema = readFileSync(at('../../supabase/schema.sql'), 'utf8')
  assert.ok(schema.includes(visit), 'schema.sql phải chứa nguyên văn migration ngày ghé')
  assert.match(visit, /create or replace function public\.touch_my_activity\(\)/)
  assert.match(visit, /v_uid uuid := auth\.uid\(\)/)
  assert.match(visit, /at time zone 'Asia\/Ho_Chi_Minh'/)
  assert.match(visit, /revoke all on function public\.touch_my_activity\(\) from public, anon/)
  assert.match(visit, /grant execute on function public\.touch_my_activity\(\) to authenticated/)
  assert.doesNotMatch(visit, /touch_my_activity\([^)]+\)/)
  assert.match(visit, /from public\.requests/)
  assert.match(visit, /from public\.votes/)
  assert.match(visit, /from public\.request_comments/)
  assert.match(visit, /from public\.daily_spins/)
  assert.match(visit, /exists \(select 1 from auth\.users/)
  const db = readFileSync(at('./db.js'), 'utf8')
  const fn = db.slice(db.indexOf('export async function touchMyActivity'))
  const body = fn.slice(0, fn.indexOf('\nexport '))
  assert.match(body, /rpc\('touch_my_activity'\)/)
  assert.doesNotMatch(body, /rpc\('touch_my_activity',\s*\{/)
  const app = readFileSync(at('../App.jsx'), 'utf8')
  assert.match(app, /touchMyActivity\(/)
  assert.doesNotMatch(app, /ccl\.streak\./)
})
