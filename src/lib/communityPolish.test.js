import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PREVIEW_SECONDS, FRAME_FADE } from './previewCap.js'

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

/* BỐ CỤC POPUP (vòng 28) — chủ dự án gửi một mẫu để làm theo:
   "t muốn bạn làm tựa tựa v nè" (100jsprojects · video-trailer-popup). Mẫu đó
   có: sân khấu đen toàn màn hình, video to ở giữa, nút ✕ nổi ở góc, không có
   thanh tiêu đề và không có dải nào quanh khung.

   Bài này chốt cả HÌNH DÁNG lẫn vế "đừng quay lại": bốn dải phủ của vòng 27
   từng bị chê là "thấy gớm luôn", nên nếu ai đó dựng lại chúng thì phải là một
   quyết định có ý thức, không phải một lần sửa lén. */
test('popup theo bố cục trailer popup: sân khấu đen, một nút ✕, vệt mờ mềm', () => {
  const modal = readFileSync(`${root}src/components/VideoPreviewModal.jsx`, 'utf8')
  for (const cls of ['video-preview-scrim', 'video-preview-stage', 'video-preview-player',
    'video-preview-frame', 'video-preview-close', 'video-preview-meta']) {
    assert.ok(modal.includes(cls), `thiếu ${cls} trong popup`)
  }
  assert.ok(!modal.includes('video-preview-masks'),
    'lớp phủ bốn mép (vòng 27) đã bị chê — bỏ rồi thì đừng dựng lại mà không ghi lý do')
  assert.match(modal, /<h2 id="video-preview-title">/, 'tên bài phải còn (nhãn của hộp thoại)')

  const css = readFileSync(`${root}src/index.css`, 'utf8')
  const fade = css.slice(css.indexOf('.video-preview-fade'), css.indexOf('.video-preview-close'))
  assert.match(fade, /linear-gradient\(180deg, rgba\(0, 0, 0, \.\d+\), transparent\)/,
    'vệt mờ trên phải tan dần về `transparent` — không mép cứng')
  assert.match(fade, /linear-gradient\(0deg, rgba\(0, 0, 0, \.\d+\), transparent\)/,
    'vệt mờ dưới phải tan dần về `transparent` — không mép cứng')
  assert.ok(!/brightness|backdrop-filter/.test(fade),
    'vệt mờ chỉ được là một lớp gradient — không kéo theo bộ lọc của thời kỳ dải phủ')
  /* Vệt mờ phải nhẹ: hai mép cộng lại không quá 25% chiều cao (xem FRAME_FADE). */
  assert.ok(FRAME_FADE.top + FRAME_FADE.bottom <= 25,
    `hai vệt ${FRAME_FADE.top + FRAME_FADE.bottom}% — dày quá, quay về kiểu băng dán`)
  /* Nút ✕ nằm NGOÀI khung (nổi trên khung), không phải một thanh tiêu đề. */
  const close = css.slice(css.indexOf('.video-preview-close'))
  assert.match(close.slice(0, 260), /position:\s*absolute/,
    '✕ phải nổi theo khung, không nằm trong luồng văn bản')
  assert.ok(!/video-preview-head/.test(css),
    'thanh tiêu đề của bản cũ đã bỏ — mẫu không có nó')
})

test('comments expose a reply action and persist the parent id', () => {
  const ui = readFileSync(`${root}src/components/Comments.jsx`, 'utf8')
  const db = readFileSync(`${root}src/lib/db.js`, 'utf8')
  assert.match(ui, /comment\.reply/)
  assert.match(ui, /replyTo\?\.id/)
  assert.match(db, /parent_id: parentId \|\| null/)
})
