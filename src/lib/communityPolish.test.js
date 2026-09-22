import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PREVIEW_SECONDS } from './previewCap.js'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Hall of Fame uses a 30-second modal preview, not an immediate external link', () => {
  const app = readFileSync(`${root}src/App.jsx`, 'utf8')
  const modal = readFileSync(`${root}src/components/VideoPreviewModal.jsx`, 'utf8')
  assert.match(app, /className="hall-card"[\s\S]*setHallVideo\(r\)/)
  assert.match(modal, /end=30/)
  assert.match(modal, /role="dialog"/)
})

/* `end=30` trong URL và vòng canh trong trang là HAI chỗ nói cùng một mốc.
   Lệch nhau thì cái khoá thật sẽ chặt ở 45 giây trong khi `end` đánh dấu 30 —
   và không có triệu chứng nào trên màn hình cho tới khi có người xem hết. */
test('mốc 30 giây là MỘT con số: URL nhúng và vòng canh không được lệch nhau', () => {
  const modal = readFileSync(`${root}src/components/VideoPreviewModal.jsx`, 'utf8')
  const urlEnd = Number((modal.match(/[?&]end=(\d+)/) || [])[1])
  assert.equal(urlEnd, PREVIEW_SECONDS, 'end=… trong URL nhúng phải bằng PREVIEW_SECONDS')
  /* Ba mảnh không thể thiếu của vòng canh: mở kênh postMessage
     (`enablejsapi=1` — thiếu là player không nghe cũng không gửi gì),
     `origin` thật của trang (thiếu là player gửi sự kiện về sai đích và trình
     duyệt chặn im lặng), và câu chào `listening`. */
  assert.match(modal, /enablejsapi=1/)
  assert.match(modal, /origin=\$\{encodeURIComponent\(origin\)\}/)
  assert.match(modal, /handshake\(\)/)
  assert.match(modal, /readWidgetEvent\(/)
})

test('comments expose a reply action and persist the parent id', () => {
  const ui = readFileSync(`${root}src/components/Comments.jsx`, 'utf8')
  const db = readFileSync(`${root}src/lib/db.js`, 'utf8')
  assert.match(ui, /comment\.reply/)
  assert.match(ui, /replyTo\?\.id/)
  assert.match(db, /parent_id: parentId \|\| null/)
})
