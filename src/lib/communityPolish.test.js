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

/* Chủ dự án yêu cầu: "ẩn mấy cái giao diện của YouTube lúc chiếu video, chỉ
   bấm play/pause được thôi". Ba tham số dưới đây là cả cách làm:
     · `controls=0` — bỏ thanh điều khiển (trong đó có nút *Watch on YouTube*);
     · `disablekb=1` — bỏ phím tắt của player ([l]/[→] nhảy 10 giây, [0-9] nhảy
       theo phần trăm: hai đường vòng qua mốc 30 giây);
     · `autoplay=1` — cũng là thứ giữ cho nút *Watch on YouTube* không hiện.
   Và đổi lại phải có nút play/pause TỰ VẼ: không có nó thì khung chỉ còn một
   tấm hình không bấm được gì. */
test('khung xem trước tắt giao diện YouTube và tự vẽ nút play/pause', () => {
  const modal = readFileSync(`${root}src/components/VideoPreviewModal.jsx`, 'utf8')
  for (const param of ['controls=0', 'disablekb=1', 'autoplay=1']) {
    assert.ok(modal.includes(param), `URL nhúng thiếu ${param}`)
  }
  assert.match(modal, /video-preview-controls/, 'phải có lớp điều khiển tự vẽ')
  assert.match(modal, /video-preview-toggle/, 'phải có nút play/pause tự vẽ')
  assert.match(modal, /command\(next \? 'playVideo' : 'pauseVideo'\)/,
    'nút phải gửi đúng chức năng playVideo/pauseVideo của player')
  assert.match(modal, /playButtonView\(/, 'trạng thái nút đọc qua luật ở previewCap.js')
  assert.match(modal, /command\('seekTo'/, 'thanh thời gian của trang phải gửi seekTo')
})

test('comments expose a reply action and persist the parent id', () => {
  const ui = readFileSync(`${root}src/components/Comments.jsx`, 'utf8')
  const db = readFileSync(`${root}src/lib/db.js`, 'utf8')
  assert.match(ui, /comment\.reply/)
  assert.match(ui, /replyTo\?\.id/)
  assert.match(db, /parent_id: parentId \|\| null/)
})
