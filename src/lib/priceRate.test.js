/* GIÁ BÁN — hai vế của một con số, và tỷ giá giữ chúng khớp nhau
   ---------------------------------------------------------
   Mỗi gói vote (và một paid request) có HAI giá: `usd` để hiện cho khách nước
   ngoài, `vnd` để chuyển khoản trong nước. Hai vế đó là hai lần gõ tay cho cùng
   một món hàng, nên chúng lệch nhau lúc nào không ai biết: trang vẫn chạy, chỉ
   có người trả tiền là trả sai giá.

   `USD_VND` trong src/lib/db.js là tỷ giá dùng khi quy đổi, và trước đây nó chỉ
   nằm trong một câu chú thích — không dòng code nào đọc, nên nó không giữ được
   gì cả. Test này biến nó thành hợp đồng: đổi `usd` mà quên `vnd` (hoặc ngược
   lại) là đỏ ngay, kèm con số đúng để gõ vào.

   Luật: `vnd = round(usd × USD_VND / 1000) × 1000` — làm tròn tới nghìn đồng
   gần nhất, vì tiền Việt không ai chuyển lẻ tới đồng.

   Nạp db.js qua Vite (như adminGroup.test.js) vì db.js import không ghi đuôi
   (`'./youtube'`) — node thuần không giải được, Vite thì được.
   Chạy: npm test */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server, db

async function load() {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-pricerate-test',
    /* .env của người lập trình không được biến test này thành client thật */
    envPrefix: 'CCL_PRICERATE_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  db = db || await server.ssrLoadModule('/src/lib/db.js')
  assert.equal(db.hasSupabase, false, 'test phải chạy ở chế độ demo')
  return db
}

after(async () => { await server?.close() })

const roundTo1000 = (usd) => Math.round((usd * db.USD_VND) / 1000) * 1000

test('tỷ giá USD_VND là một con số dùng được', async () => {
  const { USD_VND } = await load()
  assert.ok(Number.isFinite(USD_VND) && USD_VND > 10000 && USD_VND < 100000,
    `USD_VND = ${USD_VND} — tỷ giá phải là một con số thật, không phải chỗ giữ chỗ`)
})

test('mỗi gói vote: giá VND đúng bằng giá USD quy đổi theo USD_VND', async () => {
  const { VOTE_PACKS, USD_VND } = await load()
  assert.ok(VOTE_PACKS.length >= 3, 'còn ít nhất ba gói để bán')
  for (const p of VOTE_PACKS) {
    assert.equal(p.vnd, roundTo1000(p.usd),
      `gói ${p.id}: usd ${p.usd} × ${USD_VND} = ${roundTo1000(p.usd)}đ, không phải ${p.vnd}đ`)
    assert.ok(p.qty > 0, `gói ${p.id} phải có số vote`)
    assert.ok(p.usd > 0 && p.vnd > 0, `gói ${p.id} phải có giá`)
  }
  /* Gói to hơn phải rẻ hơn tính theo từng vote — nếu không thì chẳng ai mua gói
     to, và bảng giá thành ba dòng nói cùng một chuyện. */
  const perVote = VOTE_PACKS.map(p => p.vnd / p.qty)
  for (let i = 1; i < perVote.length; i++) {
    assert.ok(perVote[i] < perVote[i - 1],
      `gói ${VOTE_PACKS[i].id} phải rẻ hơn tính theo từng vote so với ${VOTE_PACKS[i - 1].id}`)
  }
})

test('mua lẻ và paid request cũng theo đúng tỷ giá đó', async () => {
  const { USD_VND, SINGLE_VOTE, PAID_REQUEST } = await load()
  assert.equal(SINGLE_VOTE.vnd, roundTo1000(SINGLE_VOTE.usd),
    `mua lẻ: usd ${SINGLE_VOTE.usd} × ${USD_VND} = ${roundTo1000(SINGLE_VOTE.usd)}đ`)
  assert.equal(PAID_REQUEST.vnd, roundTo1000(PAID_REQUEST.usd),
    `paid request: usd ${PAID_REQUEST.usd} × ${USD_VND} = ${roundTo1000(PAID_REQUEST.usd)}đ`)
})

test('singlePrice(n) nhân đúng cả hai vế và vẫn làm tròn tới nghìn', async () => {
  const { singlePrice, SINGLE_VOTE } = await load()
  for (const n of [1, 2, 5, 12]) {
    const g = singlePrice(n)
    assert.equal(g.usd, Math.round(SINGLE_VOTE.usd * n * 100) / 100,
      `${n} vote: giá USD phải là giá lẻ × ${n}, làm tròn tới xu`)
    assert.equal(g.vnd, Math.round((SINGLE_VOTE.vnd * n) / 1000) * 1000,
      `${n} vote: giá VND phải làm tròn tới nghìn`)
  }
})
