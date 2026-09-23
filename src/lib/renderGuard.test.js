/* CHỐT CHẶN SAU KHI BỎ "MÀN HÌNH ĐEN" (19/09/2026)
   ---------------------------------------------------------
   Hai nhóm lỗi đã xảy ra thật, và cả hai đều im lặng với test cũ:

   1. Lưới "an toàn" lại là thứ che trang. Một component ném lỗi trong lúc
      render → React gỡ cây → màn lỗi phủ kín trang → người dùng mất cả app
      trong khi lỗi thật chỉ nằm trong console. Chủ dự án đã phải xoá tay các
      class đó ngay trên trình duyệt mới dùng được trang. Bộ khung đó (lưới
      index.html, màn lỗi, khoá i18n, CSS) nay bị gỡ hẳn — file này chặn việc
      nó quay lại qua một lần "cho chắc" nào đó.

   2. Một dòng dữ liệu lạ làm vỡ cả bảng. `STATUS_META[r.status].c` và
      `KIND_META[form.kind].titleKey` là tra bảng trần: trạng thái cũ còn sót
      trong DB, hay một khoá không có trong bảng, là TypeError ngay giữa lúc
      render. Dữ liệu thật luôn bẩn hơn dữ liệu mẫu — hàm tra bảng phải luôn
      trả về một kết quả. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { statusColor, inChain, kindCls, statusLabel, timeAgo, isPicked, compact, vnd, usd } from './meta.js'
import { boardItems, stageCounts, groupKey, songCount, voteTotals, fold, creditText } from './board.js'
import { unionActivityDays } from './streak.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (rel) => readFileSync(root + rel, 'utf8')

/* mọi file nguồn, trừ chính file này (nó nhắc tên các thứ đang bị cấm) */
function walk(dir, out = []) {
  for (const e of readdirSync(root + dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel, out)
    else if (/\.(jsx?|css|html)$/.test(e.name) && e.name !== 'renderGuard.test.js') out.push(rel)
  }
  return out
}

const t = (k) => k

test('không còn bộ khung "màn hình đen": lưới an toàn, màn lỗi, CSS, khoá i18n', () => {
  const files = walk('src')
  assert.ok(files.length > 40, `quét được ${files.length} file — đường dẫn sai thì test này vô nghĩa`)
  for (const f of files) {
    const s = readFileSync(root + f, 'utf8')
    for (const [re, what] of [
      [/__cclBoot/, 'cờ boot của lưới an toàn'],
      [/bootfail/, 'khối chữ thay trang đen'],
      [/className="crash/i, 'màn lỗi che trang'],
      [/'crash\./, 'khoá i18n của màn lỗi'],
      [/^\.crash|[\s,}]\.crash[\s,{]/m, 'CSS .crash'],
    ]) {
      assert.ok(!re.test(s), `${f} còn ${what}`)
    }
  }
  assert.ok(!existsSync(root + 'src/components/ErrorBoundary.jsx'),
    'component màn lỗi phải bị xoá hẳn, không để lại file chết')
  assert.ok(!existsSync(root + 'src/components/ErrorBoundary.test.js'))
  const html = read('index.html')
  assert.match(html, /<div id="root"><\/div>/, '#root vẫn phải là chỗ React dựng')
  assert.match(read('src/main.jsx'), /createRoot\(document\.getElementById\('root'\)\)/,
    'main.jsx dựng app thẳng vào #root, không bọc màn lỗi')
})

test('dữ liệu bẩn không làm vỡ bảng: trạng thái, loại bài, thời gian, link', () => {
  /* một dòng "cũ" đúng kiểu có thể còn nằm trong DB thật: thiếu trường, sai
     kiểu, trạng thái lạ, ngày không phân tích được */
  const junk = [
    { id: 'a', kind: 'Không có trong bảng', status: 'weird', artist: null, title: undefined,
      votes: null, created_at: 'rác', is_paid: null, progress: null, video_url: 'không-phải-link' },
    { id: 'b', kind: 'Short', status: 'in_progress', artist: 'A', title: 'T', votes: 3,
      created_at: new Date().toISOString(), progress: 250, picked_at: null },
    { id: 'c', status: 'queued', artist: 'A', title: 'T', votes: '5', created_at: 0, picked_at: 'x' },
    null,
  ]
  /* tra bảng luôn có kết quả */
  for (const s of ['weird', '', undefined, null, 'PENDING']) {
    assert.match(statusColor(s), /var\(--/, `statusColor(${String(s)}) phải trả về một biến màu`)
  }
  assert.equal(kindCls('Không có trong bảng'), 'ccl')
  assert.equal(kindCls(undefined), 'ccl')
  assert.ok(statusLabel({ status: 'weird' }, t).length > 0)
  assert.ok(timeAgo('rác', t).length > 0, 'ngày rác vẫn phải ra một câu, không NaN')
  assert.ok(!/NaN|undefined/.test(timeAgo('rác', t)))
  for (const n of [null, undefined, 'x', NaN, -1]) {
    assert.ok(!/NaN|undefined/.test(compact(n) + vnd(n) + usd(n)), `số ${String(n)} in ra chữ rác`)
  }
  assert.equal(isPicked(junk[0]), false)
  assert.equal(isPicked(undefined), false)
  /* Dây chuyền đang chạy: đã chốt (picked_at + queued/in_progress) HOẶC đang
     làm. Bài đang làm mà thiếu picked_at vẫn phải thuộc dây chuyền, nếu không
     nó không hiện ở tab nào. */
  assert.equal(inChain({ status: 'in_progress' }), true)
  assert.equal(inChain({ status: 'queued', picked_at: '2026-09-19T00:00:00Z' }), true)
  assert.equal(inChain({ status: 'in_progress', picked_at: '2026-09-19T00:00:00Z' }), true)
  assert.equal(inChain({ status: 'queued' }), false)
  assert.equal(inChain({ status: 'completed', picked_at: '2026-09-19T00:00:00Z' }), false)
  assert.equal(inChain(null), false)
  /* dựng bảng từ dữ liệu bẩn: không được ném lỗi, và không được mất dòng */
  assert.doesNotThrow(() => boardItems(junk, 'newest'))
  assert.doesNotThrow(() => boardItems(junk, 'top'))
  assert.equal(typeof groupKey(junk[1]), 'string')
  assert.equal(fold(null), '')
  const st = stageCounts(junk)
  assert.ok(Number.isInteger(st.total) && st.total >= 1)
  assert.equal(st.queued + st.picked + st.in_progress + st.completed, st.total)
  assert.ok(Number.isInteger(songCount(junk)))
  assert.doesNotThrow(() => voteTotals(junk))
  assert.doesNotThrow(() => creditText({ artist: null, title: undefined }, 8))
})

test('chỗ render dùng hàm tra bảng, không tra trần', () => {
  const app = read('src/App.jsx')
  const adm = read('src/components/AdminPanel.jsx')
  for (const [f, s] of [['App.jsx', app], ['AdminPanel.jsx', adm]]) {
    /* Không chỉ "không tra trần": KHÔNG được nhắc tới hai bảng này nữa. Một lần
       bỏ import mà quên chỗ dùng (STATUS_META.in_progress.c) là ReferenceError
       ngay giữa lúc render — đúng loại lỗi làm mất cả trang. */
    assert.ok(!/STATUS_META/.test(s), `${f} còn dùng STATUS_META — dùng statusColor()`)
    /* KIND_META vẫn được LIỆT KÊ khoá (ô lọc loại bài, danh sách kind) — cái bị
       cấm là TRA THẲNG một khoá để lấy nhãn/màu. */
    assert.ok(!/KIND_META\[/.test(s), `${f} còn tra KIND_META trần — dùng kindCls()`)
  }
  assert.match(app, /import \{[^}]*statusColor[^}]*\} from '\.\/lib\/meta'/, 'App.jsx phải nhập statusColor')
  assert.match(read('src/components/ActionModal.jsx'), /KIND_META\[form\.kind\] \|\|/,
    'ActionModal phải có nhánh dự phòng khi loại bài không có trong bảng')
})

test('dấu ngày của lượt ghé phải được kiểm trước khi lấy .day (khách chưa đăng nhập)', () => {
  /* 23/09/2026: trang TRẮNG TRƠN với mọi người chưa đăng nhập, ngay sau lượt
     deploy chứa commit bc41a33. Dòng cũ là
     `visitStamp?.uid === user?.id ? visitStamp.day : null` — khách chưa đăng
     nhập có user = null VÀ visitStamp = null, hai vế optional-chain CÙNG là
     `undefined` nên phép so trả true, rồi nhánh đúng đọc `visitStamp.day` trên
     null → TypeError giữa useMemo → React gỡ cả cây → #root rỗng. Không có màn
     lỗi che (đã bỏ theo quyết định 19/09), nên triệu chứng đúng là trang trống.
     So uid phải nằm SAU một phép kiểm visitStamp thật, không được để
     `visitStamp?.uid` đứng một mình. */
  const app = read('src/App.jsx')
  assert.ok(!/visitStamp\?\.uid\s*===/.test(app),
    'App.jsx so `visitStamp?.uid` trần — thêm `visitStamp && …` trước phép so')
  assert.match(app, /visitStamp && visitStamp\.uid === user\?\.id \? visitStamp\.day : null/,
    'activityView phải đọc visitStamp.day sau khi đã kiểm visitStamp tồn tại')
  /* unionActivityDays tự trả null khi nguồn chưa đọc được — dải streak ẩn chứ
     không bịa danh sách ngày cho khách. */
  assert.equal(unionActivityDays(null, null), null)
  assert.equal(unionActivityDays(null, undefined), null)
})

test('thiếu dữ liệu từ máy chủ thì vẫn quay, không chặn người thật', () => {
  const spin = read('src/components/DailySpin.jsx')
  assert.match(spin, /rewards = data\.status\?\.rewards\?\.length \? data\.status\.rewards : SPIN_REWARDS/,
    'bảng ô phải có nhánh dự phòng về 16 ô mặc định khi máy chủ trả thiếu khoá')
  const db = read('src/lib/db.js')
  const guarded = db.match(/fingerprintHash\(\)\.catch\(\(\) => null\)/g) || []
  assert.ok(guarded.length >= 2,
    `vân tay hỏng phải được tha ở CẢ đường quay lẫn đường vote (đang có ${guarded.length} chỗ)`)
})
