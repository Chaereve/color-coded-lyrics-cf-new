/* Xóa thông báo phải nằm ở server, không chỉ lọc mảng trên trình duyệt.
   DELETE vẫn bị thu hồi — người dùng không được xóa dòng của người khác,
   và cũng không được tự UPDATE cột dismissed_at. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../supabase/migrations/20261108_dismiss_notification.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.indexOf('create or replace function public.dismiss_notification'))

test('dismiss chỉ ghi dismissed_at của chính người gọi', () => {
  assert.match(fn, /auth\.uid\(\)/)
  assert.match(fn, /raise exception 'err\.signin'/)
  assert.match(fn, /where user_id = v_uid/)
  assert.match(fn, /set dismissed_at = coalesce\(dismissed_at, now\(\)\)/)
  assert.doesNotMatch(fn, /delete from public\.notifications/i)
  assert.match(sql, /revoke all on function public\.dismiss_notification\(bigint, text\) from public, anon/)
  assert.match(sql, /grant execute on function public\.dismiss_notification\(bigint, text\) to authenticated/)
  assert.match(sql, /revoke update \(dismissed_at\) on public\.notifications from public, anon, authenticated/)
  assert.match(sql, /dismissed_at is null/)
})

test('video_url không còn được ghi javascript: qua admin_update', () => {
  assert.match(sql, /function public\.requests_video_url_guard/)
  assert.match(sql, /raise exception 'err\.denyVideo'/)
  assert.match(sql, /new\.video_url is not distinct from old\.video_url/)
})
