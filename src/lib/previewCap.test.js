/* =========================================================
   KIỂM THỬ LUẬT CỦA KHUNG XEM TRƯỚC 30 GIÂY
   ---------------------------------------------------------
   Lỗi chủ dự án báo lần hai: "tua nhanh qua 30s thì mốc 30 giây không còn
   tác dụng". Luật cắt nằm ở src/lib/previewCap.js và bây giờ có bài kiểm
   riêng, vì đó là chỗ dễ sai nhất mà mắt người không thấy: một chuỗi
   postMessage sai một chữ thì player IM LẶNG bỏ qua, không lỗi, không cảnh
   báo — đúng kiểu hỏng đã xảy ra hai lần ở tính năng này.
   Chạy: npm test
   ========================================================= */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PREVIEW_SECONDS, PLAYER_ID, PLAYER_ORIGIN,
  handshake, command, isPlayerOrigin, readWidgetEvent, mergeInfo, overCap, previewPct,
} from './previewCap.js'

test('mốc xem trước là 30 giây, một số nguyên dương', () => {
  assert.equal(PREVIEW_SECONDS, 30)
  /* `end=30` trong URL nhúng của VideoPreviewModal phải khớp con số này —
     communityPolish.test.js đọc thẳng cả hai chỗ và so. */
  assert.equal(PLAYER_ORIGIN, 'https://www.youtube-nocookie.com')
})

test('câu chào và lệnh điều khiển đúng phong bì của player nhúng', () => {
  const hello = JSON.parse(handshake())
  assert.deepEqual(hello, { event: 'listening', id: PLAYER_ID, channel: 'widget' })

  const pause = JSON.parse(command('pauseVideo'))
  assert.deepEqual(pause, { event: 'command', func: 'pauseVideo', args: [], id: PLAYER_ID, channel: 'widget' })

  const seek = JSON.parse(command('seekTo', [30, true]))
  assert.deepEqual(seek.args, [30, true], 'seekTo phải mang mốc giây trong args')
  assert.equal(seek.event, 'command')
  assert.equal(seek.channel, 'widget', 'thiếu channel thì player coi là tin lạ và bỏ qua')
})

test('chỉ nghe sự kiện đến từ tên miền YouTube qua https', () => {
  for (const ok of ['https://www.youtube-nocookie.com', 'https://www.youtube.com',
    'https://youtube.com', 'https://m.youtube.com', 'https://youtube-nocookie.com']) {
    assert.equal(isPlayerOrigin(ok), true, ok)
  }
  for (const no of ['http://www.youtube.com', 'https://youtube.com.evil.tld',
    'https://evil-youtube.com', '', null, undefined, 'not a url',
    /* trang mình là nơi NHẬN, không phải nơi gửi sự kiện của player */ 'https://chaereve.pages.dev']) {
    assert.equal(isPlayerOrigin(no), false, String(no))
  }
})

test('sự kiện từ player: đọc được, và bỏ qua mọi thứ khác', () => {
  const info = readWidgetEvent('https://www.youtube-nocookie.com',
    JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12.5 }, channel: 'widget', id: 1 }))
  assert.deepEqual(info, { kind: 'info', info: { currentTime: 12.5 } })

  /* `initialDelivery` là gói đầu tiên, có cả `duration` — nhận như info. */
  const first = readWidgetEvent('https://www.youtube.com',
    JSON.stringify({ event: 'initialDelivery', info: { currentTime: 0, duration: 214 }, channel: 'widget' }))
  assert.equal(first.kind, 'info')
  assert.equal(first.info.duration, 214)

  const state = readWidgetEvent('https://www.youtube.com',
    JSON.stringify({ event: 'onStateChange', info: 1, channel: 'widget' }))
  assert.deepEqual(state, { kind: 'state', state: 1 })

  /* 101/150 = chủ video không cho nhúng. Phải nhận ra để nói ra lý do, thay vì
     để một khung trắng không giải thích. */
  const err = readWidgetEvent('https://www.youtube.com',
    JSON.stringify({ event: 'onError', info: 150, channel: 'widget' }))
  assert.deepEqual(err, { kind: 'error', code: 150 })

  const junk = [
    ['https://www.youtube-nocookie.com', '{không phải json'],
    ['https://www.youtube-nocookie.com', JSON.stringify({ event: 'infoDelivery', info: {}, channel: 'khac' })],
    ['https://www.youtube-nocookie.com', JSON.stringify({ event: 'khong-biet', channel: 'widget' })],
    ['https://www.youtube-nocookie.com', JSON.stringify({ event: 'infoDelivery', channel: 'widget' })],
    ['https://www.youtube-nocookie.com', JSON.stringify({ event: 'onStateChange', info: 'x', channel: 'widget' })],
    ['https://evil.tld', JSON.stringify({ event: 'infoDelivery', info: { currentTime: 99 }, channel: 'widget' })],
    ['https://www.youtube-nocookie.com', null],
  ]
  for (const [origin, raw] of junk) {
    assert.equal(readWidgetEvent(origin, raw), null, `${origin} · ${raw}`)
  }
})

test('thông tin player gửi về là ảnh chụp từng phần, phải trộn chứ không gán đè', () => {
  const a = mergeInfo({}, { duration: 214, currentTime: 0, videoData: { video_id: 'abc', title: 'A' } })
  const b = mergeInfo(a, { currentTime: 12 })
  assert.equal(b.currentTime, 12)
  assert.equal(b.duration, 214, 'khoá không được gửi lại vẫn phải còn')
  assert.deepEqual(b.videoData, { video_id: 'abc', title: 'A' })

  const c = mergeInfo(b, { videoData: { title: 'B' } })
  assert.deepEqual(c.videoData, { video_id: 'abc', title: 'B' }, 'trộn sâu một tầng cho nhánh con')

  const d = mergeInfo(c, { currentTime: undefined, playerState: 1 })
  assert.equal(d.currentTime, 12, 'undefined không được xoá giá trị đang có')
  assert.equal(d.playerState, 1)

  assert.deepEqual(mergeInfo(null, { currentTime: 3 }), { currentTime: 3 })
  assert.equal(a.currentTime, 0, 'không sửa object cũ — React dựa vào tham chiếu mới')
})

test('luật cắt: đúng mốc 30 giây, và giá trị lạ thì KHÔNG cắt', () => {
  assert.equal(overCap(0), false)
  assert.equal(overCap(29.9), false)
  assert.equal(overCap(30), true, 'chạm đúng vạch 30 giây là hết phần xem trước')
  assert.equal(overCap(30.25), true)
  assert.equal(overCap(120), true, 'tua thẳng qua 30 giây cũng là quá mốc')
  assert.equal(overCap(undefined), false, 'chưa biết vị trí thì không được cắt')
  assert.equal(overCap(null), false)
  assert.equal(overCap(NaN), false)
  assert.equal(overCap('abc'), false)
  assert.equal(overCap(5, 5), true, 'mốc truyền vào phải được tôn trọng')
})

test('thanh tiến trình kẹp về 0..100 và không nhận giá trị rác', () => {
  assert.equal(previewPct(0), 0)
  assert.equal(previewPct(15), 50)
  assert.equal(previewPct(30), 100)
  assert.equal(previewPct(45), 100, 'vượt mốc thì thanh đứng ở đầy, không tràn')
  assert.equal(previewPct(-2), 0)
  assert.equal(previewPct(undefined), 0)
  assert.equal(previewPct('abc'), 0)
})
