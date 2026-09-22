import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PREVIEW_SECONDS, CHROME_COVER } from './previewCap.js'

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

/* MẶT NẠ BỐN MÉP (vòng 27) — chủ dự án gửi ảnh chụp: "vẫn chưa ẩn hoàn toàn
   giao diện yt". `controls=0` chỉ bỏ thanh điều khiển; tiêu đề + avatar kênh ở
   mép trên, logo / CC / ô chất lượng / nút share ở mép dưới, và tấm "Video
   khác" vẫn nguyên — chúng nằm BÊN TRONG iframe khác tên miền, CSS của trang
   không chạm tới được, nên cách duy nhất là phủ lên.

   Số đo dưới đây là SÀN, đo từ chính ảnh chụp đó (khung video 914×537):
     · tiêu đề + avatar: 4%..13% chiều cao      → dải trên phải ≥ 13%
     · tấm "Video khác": 80%..94% chiều cao     → dải dưới phải ≥ 20%
     · logo/CC/chất lượng/share: 88%..99%       → nằm trong dải dưới
   Sửa số nhỏ hơn sàn là giao diện YouTube lộ lại ở đúng mép đó. */
test('mặt nạ phủ mép khung đủ rộng để che giao diện YouTube', () => {
  assert.ok(CHROME_COVER.top >= 13, `dải trên ${CHROME_COVER.top}% — hụt so với tiêu đề/kênh (13%)`)
  assert.ok(CHROME_COVER.bottom >= 20, `dải dưới ${CHROME_COVER.bottom}% — hụt so với tấm "Video khác" (20%)`)
  for (const side of ['left', 'right']) {
    assert.ok(CHROME_COVER[side] >= 3, `dải ${side} ${CHROME_COVER[side]}% — quá mỏng`)
  }
  /* Bốn dải phải còn là MẶT NẠ chứ không phải thanh đen đặc kín cả khung: quá
     nửa chiều cao bị phủ là video không còn chỗ để xem. */
  assert.ok(CHROME_COVER.top + CHROME_COVER.bottom < 50,
    `phủ ${CHROME_COVER.top + CHROME_COVER.bottom}% chiều cao — quá nửa khung, video hết chỗ xem`)

  const modal = readFileSync(`${root}src/components/VideoPreviewModal.jsx`, 'utf8')
  for (const cls of ['video-preview-masks', 'vp-m-top', 'vp-m-bottom', 'vp-m-left', 'vp-m-right']) {
    assert.ok(modal.includes(cls), `thiếu ${cls} trong khung xem trước`)
  }
  assert.match(modal, /'--vp-top': `\$\{CHROME_COVER\.top\}%`/,
    'số đo mặt nạ phải lấy từ CHROME_COVER, không chép lại vào JSX')

  const css = readFileSync(`${root}src/index.css`, 'utf8')
  const block = css.slice(css.indexOf('.video-preview-masks'))
  assert.match(block, /pointer-events:\s*none/,
    'mặt nạ chỉ để nhìn — cú bấm phải đi qua nó tới nút play/pause')
  assert.match(block, /backdrop-filter:\s*blur\(/,
    'mặt nạ phải MỜ chứ không phải thanh đen đặc')
  assert.match(block, /height:\s*calc\(var\(--vp-top\)/,
    'chiều cao dải trên phải theo biến --vp-top (một nguồn số)')
})

test('comments expose a reply action and persist the parent id', () => {
  const ui = readFileSync(`${root}src/components/Comments.jsx`, 'utf8')
  const db = readFileSync(`${root}src/lib/db.js`, 'utf8')
  assert.match(ui, /comment\.reply/)
  assert.match(ui, /replyTo\?\.id/)
  assert.match(db, /parent_id: parentId \|\| null/)
})
