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

/* ĐIỀU KHIỂN CỦA KHUNG XEM TRƯỚC — lịch sử bốn vòng, và bản đang chạy.
   -------------------------------------------------------------------------
     · vòng 26: "ẩn mấy cái giao diện của YouTube lúc chiếu video, chỉ bấm
       play/pause được thôi" → thêm `controls=0` + `disablekb=1`, trang tự vẽ
       một nút play/pause phủ giữa khung;
     · vòng 27–28: phủ bốn dải rồi gỡ bốn dải (xem bài bố cục ở dưới);
     · vòng 29: "ko cần chèn cái nút pause/play trong video đâu" → NÚT TỰ VẼ BỊ
       GỠ. Bản nháp hiểu thành "bật lại điều khiển của YouTube"; chủ dự án gửi
       ảnh chụp đúng cái thanh điều khiển đó (0:01 / 3:34, vạch tiến trình, ô
       chất lượng, CC, tấm "Video khác", logo YouTube, toàn màn hình) và nói
       "bỏ cái phần trong hình t gửi và để video giống bản trước đó". Nên
       `controls=0` + `disablekb=1` Ở LẠI, và LỚP PHỦ CHẶN CÚ BẤM cũng đi:
       lớp đó chỉ để nút của trang là chỗ bấm duy nhất — bỏ nó thì cú bấm rơi
       vào chính player, mà player vẫn tự hiểu bấm-vào-hình là play/pause.

   Bốn điều bài này giữ, vì cả bốn đều là chỗ dễ trôi:
     1. thanh điều khiển của YouTube phải TẮT (ảnh chụp của chủ dự án là đúng
        cái thanh đó — quay lại là hỏng);
     2. trang không được chèn lại nút play/pause của mình;
     3. cú bấm phải tới được player (không còn lớp phủ `inset: 0` nào chặn);
     4. vạch 0→30 giây của trang thì VẪN CÒN — chỗ nói ra phần xem trước dài
        bao nhiêu, và là đường tua duy nhất bị kẹp trong 30 giây. */
test('khung xem trước: không nút tự vẽ, không thanh điều khiển của YouTube', () => {
  const modal = readFileSync(`${root}src/components/VideoPreviewModal.jsx`, 'utf8')
  /* Chỉ soi CHUỖI URL nhúng: chú thích trong tệp có nhắc lại `controls=0` để kể
     lịch sử bốn vòng, và nhắc lại là chuyện nên làm chứ không phải lỗi. */
  const query = (modal.match(/const EMBED_QUERY = '([^']+)'/) || [])[1] || ''
  for (const param of ['controls=0', 'disablekb=1']) {
    assert.ok(query.includes(param),
      `URL nhúng thiếu ${param} — thanh điều khiển (và tấm "Video khác", phím tắt nhảy 10 giây) sẽ quay lại (${query})`)
  }
  assert.match(query, /autoplay=1/, 'vẫn phải tự chạy khi mở khung')
  assert.match(query, /enablejsapi=1/, 'vòng canh 30 giây vẫn cần kênh postMessage')
  /* Soi CHỖ DÙNG, không soi chuỗi trần: chú thích trong tệp có nhắc tên mấy lớp
     đã gỡ để kể lại vòng 26–29, và nhắc lại là chuyện nên làm. Còn `playButtonView`
     thì phải vắng ở ĐÚNG chỗ nó từng được nhập vào. */
  const imports = modal.slice(modal.indexOf('import {'), modal.indexOf("} from '../lib/previewCap.js'"))
  for (const dead of ['className="video-preview-controls', 'className="video-preview-toggle',
    '<PreviewControls', "command(next ? 'playVideo' : 'pauseVideo')"]) {
    assert.ok(!modal.includes(dead),
      `nút play/pause tự vẽ đã gỡ (vòng 29), nhưng ${dead} vẫn còn trong JSX`)
  }
  /* Nhánh file video không có YouTube để mượn nút, nên ở đó điều khiển là của
     trình duyệt (`controls` trên chính thẻ <video>). */
  assert.match(modal, /className="video-preview-file" src=\{url\} playsInline controls/,
    'nhánh file video phải có điều khiển của trình duyệt, không thì khung không bấm phát được')
  assert.ok(!imports.includes('playButtonView'),
    'luật trạng thái nút đã xoá khỏi previewCap.js — component cũng không được nhập nó nữa')
  assert.match(modal, /command\('seekTo'/, 'vạch thời gian của trang phải gửi seekTo')

  const css = readFileSync(`${root}src/index.css`, 'utf8')
  assert.ok(!css.includes('video-preview-toggle') && !css.includes('video-preview-controls'),
    'CSS của nút tự vẽ phải được gỡ cùng nút — để lại là rác, và là chỗ dựng lại lúc nào không biết')
  /* Lớp phủ chặn cú bấm từng được khai bằng `inset: 0` ngay trên iframe; nó
     không được quay lại, vì nó khoá luôn đường bấm vào player. */
  const layer = css.slice(css.indexOf('.video-preview-fade'))
  assert.match(layer.slice(0, 200), /pointer-events:\s*none/,
    'vệt mờ phải để cú bấm đi qua (`pointer-events: none`) — nếu không nó thành lớp chắn mới')
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
