/* LỌC và SẮP XẾP là HAI TRỤC, phải dùng được CÙNG LÚC.
   ---------------------------------------------------------
   Lỗi người dùng báo: "sau khi áp filter thì cho sort luôn, chứ hiện tại ko
   thể xài 2 cái cùng lúc". Nguyên nhân nằm ở mô hình dữ liệu: `filter` mang
   hai nghĩa — một chặng của dây chuyền (queued/picked/in_progress/completed)
   HOẶC một cách xếp cả bảng (newest/top/oldest/requests/az). Chọn sort thì
   `pickSort` dọn sạch `statusFilters`; chọn một chặng thì `toggleStage` ghi
   đè `filter` và cách xếp biến mất.

   Tệp này chốt hai việc:
     1. Ở tầng dữ liệu: `filterBoard` nhận CẢ `filter` (chặng) lẫn `sort`
        (cách xếp), và lọc theo chặng không bị cách xếp làm rỗng danh sách.
     2. Ở tầng giao diện: chọn sort không được đụng tới bộ lọc, và ngược lại.
*/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boardItems, filterBoard } from './board.js'

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

const rows = [
  { id: 'a', user_id: 'u1', title: 'Alpha', artist: 'X', status: 'queued', votes: 2, created_at: '2026-01-03T00:00:00Z' },
  { id: 'b', user_id: 'u1', title: 'Bravo', artist: 'X', status: 'queued', votes: 9, created_at: '2026-01-02T00:00:00Z' },
  { id: 'c', user_id: 'u1', title: 'Charlie', artist: 'X', status: 'completed', votes: 5, created_at: '2026-01-01T00:00:00Z' },
  { id: 'd', user_id: 'u1', title: 'Delta', artist: 'X', status: 'in_progress', votes: 1, picked_at: '2026-01-04T00:00:00Z', created_at: '2026-01-04T00:00:00Z' },
]
const pub = rows.filter(r => r.status !== 'pending' && r.status !== 'denied')
const ids = (list) => list.map(r => r.id)

test('lọc một chặng rồi xếp theo cách khác: giữ ĐÚNG tập đã lọc', () => {
  /* Trước đây `filter='top'` vừa là bộ lọc vừa là cách xếp, nên không có cách
     nào diễn đạt "hàng chờ, xếp theo vote". Nay là hai tham số riêng. */
  const queuedTop = filterBoard({ pub, filter: 'queued', sort: 'top' })
  assert.deepEqual(ids(queuedTop).sort(), ['a', 'b'], 'sort không được kéo bài đã xong vào hàng chờ')

  const doneTop = filterBoard({ pub, filter: 'completed', sort: 'top' })
  assert.deepEqual(ids(doneTop), ['c'],
    'chặng Done + xếp theo vote vẫn phải ra đúng bài đã xong — luật "Most voted bỏ bài đã xong" chỉ dành cho cả bảng')

  const inChainTop = filterBoard({ pub, filter: 'picked', sort: 'az' })
  assert.deepEqual(ids(inChainTop), ['d'], 'chặng Up next + xếp A→Z vẫn đúng tập dây chuyền')
})

test('cả bảng + Most voted vẫn bỏ bài đã xong như cũ', () => {
  const allTop = filterBoard({ pub, filter: 'all', sort: 'top' })
  assert.deepEqual(ids(allTop).sort(), ['a', 'b'],
    'khi KHÔNG giới hạn chặng, "Most voted" giữ nguyên luật cũ: bỏ bài đã xong và bài đã vào dây chuyền')
})

test('cách xếp áp lên tập đã lọc, không thay thế nó', () => {
  /* `boardItems` trả về ITEM: dòng lẻ (`r`) hoặc cụm (`rows`, bài trùng tên
     gộp làm một) — so bằng dòng đại diện. */
  const head = (list) => list.map(it => it.r?.id ?? it.rows?.[0]?.id)
  assert.deepEqual(head(boardItems(filterBoard({ pub, filter: 'queued' }), 'az')), ['a', 'b'],
    'xếp A→Z trên hàng chờ: Alpha trước Bravo')
  assert.deepEqual(head(boardItems(filterBoard({ pub, filter: 'queued' }), 'top')), ['b', 'a'],
    'cùng tập hàng chờ, xếp theo vote: Bravo trước Alpha')
})

test('link cũ `?f=top` vẫn đọc thành "cả bảng + xếp theo vote"', () => {
  /* readBoard tách giá trị sort nằm trong `f` thành sort riêng, để link đã dán
     ra ngoài và lịch sử duyệt web không mở ra một bảng trống. */
  const body = app.match(/const readBoard = \(\) => \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(body, 'không tìm thấy readBoard')
  assert.match(body, /SORTS\.includes\(fRaw\)/, 'phải nhận ra giá trị sort nằm trong `f`')
  assert.match(body, /f: legacySort \? 'all' : fRaw/, 'chặng phải về "all" khi `f` là một cách xếp')
  assert.match(body, /s: legacySort \|\| pickBoardParam\(p\.get\('s'\)/, 'cách xếp đọc từ `s`, và vẫn nhận dạng cũ')
})

test('chọn Sort KHÔNG dọn bộ lọc, chọn bộ lọc KHÔNG dọn Sort', () => {
  /* Chính là lỗi người dùng báo. Hai handler này là chỗ duy nhất được phép
     đổi trục của mình. */
  const pickSort = app.match(/const pickSort = \(k\) => \{([^}]*)\}/)?.[1]
  assert.ok(pickSort, 'không tìm thấy pickSort')
  assert.match(pickSort, /setSort\(k\)/, 'pickSort phải đặt cách xếp')
  assert.doesNotMatch(pickSort, /setStatusFilters|setFilter\(/, 'pickSort không được xoá chặng đang lọc')

  for (const fn of ['toggleStage', 'removeStage']) {
    const body = app.match(new RegExp(`const ${fn} = \\(k\\) => \\{([\\s\\S]*?)\\n  \\}`))?.[1]
    assert.ok(body, `không tìm thấy ${fn}`)
    assert.doesNotMatch(body, /setSort\(/, `${fn} không được xoá cách xếp đang chọn`)
  }
})

test('hai trục có hai ô nhớ: `filter` là chặng, `sort` là cách xếp', () => {
  assert.match(app, /const boardStage = STAGES\.includes\(filter\) \? filter : 'all'/,
    'phải quy `filter` về chặng (hoặc "all"), không để nó mang giá trị sort')
  assert.match(app, /const \[sort, setSort\] = useState\(board\.s\)/, 'cách xếp phải có state riêng')
  /* Địa chỉ và bộ nhớ cục bộ phải mang CẢ HAI, nếu không F5 là mất một trục. */
  assert.match(app, /if \(sort\) p\.set\('s', sort\)/, 'địa chỉ phải mang cách xếp')
  assert.match(app, /JSON\.stringify\(\{ f: filter, s: sort, k: kindFilter \}\)/,
    'bộ lọc đã lưu phải nhớ cả cách xếp')
  /* Nút Sort in cách xếp đang dùng; chưa chọn thì chỉ in tên trường. */
  assert.match(app, /const sortKey = sort\n/, 'nhãn nút Sort lấy từ state sort')
})

test('bảng chọn Sort vẫn là radio một lựa chọn và có nhãn cho trình đọc màn hình', () => {
  const menu = app.match(/id="fb-sort-menu"[\s\S]*?<\/div>\n                    \)/)?.[0] || app
  assert.match(menu, /role="menuitemradio" aria-checked=\{sortKey === k\}/,
    'mỗi mục Sort phải là radio và phản ánh đúng cách xếp đang chọn')
  assert.match(app, /ARIA|aria-label=\{t\('board\.sortAria'\)\}/, 'nút Sort phải có tên đọc được')
})
