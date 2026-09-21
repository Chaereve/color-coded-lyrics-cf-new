/* SHARE CARD — khoá luật bằng SỐ cho phần vẽ tay (shareCard.js).
   ---------------------------------------------------------
   Card là ảnh tĩnh: vẽ sai một toạ độ thì KHÔNG có lỗi runtime nào kêu —
   chỉ có tấm ảnh lệch im lặng. Nên test ở đây làm hai việc:
   1. các hàm thuần (wrapLines/slugName/cardFilename) đúng từng ca biên;
   2. drawShareCard chạy trên một ctx GIẢ ghi lại mọi lời gọi — khẳng định
      không một tham số số nào là NaN/Infinity, và mọi chữ phải có mặt
      (tên, nhãn cột, câu streak, mốc 7/30/100, chân trang, tem ngày) đều
      thật sự được vẽ.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD_W, CARD_H, wrapLines, slugName, cardFilename, drawShareCard, makeShareCardBlob,
} from './shareCard.js'

/* ---- ctx giả: mọi lệnh vẽ đều được ghi lại, mọi con số đều bị soi ---- */
function stubCtx() {
  const nums = []          /* mọi tham số số từng truyền vào lệnh vẽ */
  const texts = []         /* [chuỗi, x, y] của fillText */
  const draws = []         /* drawImage */
  const note = (...args) => { for (const a of args) nums.push(a) }
  const ctx = {
    canvas: { width: CARD_W * 2, height: CARD_H * 2 },
    nums, texts, draws,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    fill() {}, stroke() {}, clip() {},
    scale(x, y) { note(x, y) },
    translate(x, y) { note(x, y) },
    moveTo(x, y) { note(x, y) },
    lineTo(x, y) { note(x, y) },
    arc(x, y, r, a, b) { note(x, y, r, a, b) },
    arcTo(x1, y1, x2, y2, r) { note(x1, y1, x2, y2, r) },
    fillRect(x, y, w, h) { note(x, y, w, h) },
    fillText(s, x, y) { note(x, y); texts.push([String(s), x, y]) },
    drawImage(img, x, y, w, h) { note(x, y, w, h); draws.push([x, y, w, h]) },
    /* đo chữ giả: mỗi ký tự 8px — đủ để wrapLines hoạt động như thật */
    measureText(s) { return { width: String(s).length * 8 } },
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    textAlign: '', textBaseline: '',
  }
  return ctx
}

const DATA = {
  name: 'Alice Nguyễn',
  subtitle: 'Chaereve community member',
  avatar: null,
  stats: [
    { value: 12, label: 'requests' },
    { value: 7, label: 'completed' },
    { value: 340, label: 'Votes received' },
  ],
  streakLine: '3-day streak · longest 12',
  milestones: [{ n: 7, got: true }, { n: 30, got: false }, { n: 100, got: false }],
  footer: 'chaereve · color coded lyrics request board',
  stamp: '2026-09-22',
}

test('wrapLines ngắt tham lam theo hàm đo, không bịa chữ', () => {
  const measure = (s) => s.length * 10
  assert.deepEqual(wrapLines('hello world foo', 120, measure), ['hello world', 'foo'])
  assert.deepEqual(wrapLines('hello', 120, measure), ['hello'])
  /* rỗng/toàn khoảng trắng -> không dòng nào (nơi vẽ tự lo chuỗi '') */
  assert.deepEqual(wrapLines('', 120, measure), [])
  assert.deepEqual(wrapLines('   ', 120, measure), [])
  /* null/undefined không nổ */
  assert.deepEqual(wrapLines(null, 120, measure), [])
})

test('slugName bỏ dấu tiếng Việt, cardFilename đúng tem ngày', () => {
  assert.equal(slugName('Alice Nguyễn'), 'alice-nguyen')
  assert.equal(slugName("O'Clock Café"), 'o-clock-cafe')
  assert.equal(slugName(''), 'member')
  assert.equal(slugName('★★★'), 'member')
  assert.equal(cardFilename('Alice Nguyễn', '2026-09-22'), 'chaereve-alice-nguyen-2026-09-22.png')
  assert.equal(cardFilename(null, '2026-09-22'), 'chaereve-member-2026-09-22.png')
})

test('drawShareCard: mọi con số hữu hạn, mọi chữ phải có mặt được vẽ', () => {
  const ctx = stubCtx()
  drawShareCard(ctx, DATA)
  /* 1. không một toạ độ NaN/Infinity — lệch im lặng là lỗi nguy hiểm nhất */
  for (const v of ctx.nums) {
    assert.ok(typeof v === 'number' && Number.isFinite(v), `tham số vẽ không hữu hạn: ${v}`)
  }
  /* 2. mọi chữ trên card đều đi qua fillText */
  const all = ctx.texts.map((r) => r[0]).join(' | ')
  for (const want of [
    'Alice', 'Chaereve community member', 'requests', 'completed', 'Votes received',
    '12', '7', '340',            /* giá trị cột */
    '7', '30', '100',            /* ba mốc — '7' trùng cột nhưng mốc vẽ riêng */
    '3-day streak', 'longest 12',
    'chaereve', '2026-09-22',
  ]) {
    assert.ok(all.includes(want), `card thiếu chữ "${want}" — đã vẽ: ${all}`)
  }
  /* 3. không avatar thì không drawImage; có avatar bitmap thì vẽ đúng một lần */
  assert.equal(ctx.draws.length, 0)
  const ctx2 = stubCtx()
  drawShareCard(ctx2, { ...DATA, avatar: { width: 96, height: 96 } })
  assert.equal(ctx2.draws.length, 1)
})

test('drawShareCard chịu được dữ liệu cụt: không streak, không mốc, tên dài', () => {
  const ctx = stubCtx()
  drawShareCard(ctx, {
    ...DATA,
    name: 'Một Cái Tên Rất Rất Rất Dài Viết Liền Không Ngắt AAAA BBBB CCCC DDDD',
    streakLine: null,
    milestones: null,
    stamp: undefined,
  })
  for (const v of ctx.nums) {
    assert.ok(Number.isFinite(v), `tham số vẽ không hữu hạn với dữ liệu cụt: ${v}`)
  }
})

test('makeShareCardBlob ném mã lỗi rõ khi không có DOM (node/jsdom tắt canvas)', async () => {
  await assert.rejects(() => makeShareCardBlob(DATA), (e) => {
    assert.equal(e.message, 'card-no-dom')
    return true
  })
})
