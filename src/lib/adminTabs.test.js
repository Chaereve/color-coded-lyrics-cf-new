/* Địa chỉ của trang quản trị.
   ---------------------------------------------------------
   `?tab=…` là thứ duy nhất khiến một mục trong bảng quản trị dán được cho người
   khác, giữ được qua F5, và lùi được bằng nút Back. Hai lỗi phải chặn: nhận một
   mục KHÔNG có thật (gõ tay `?tab=abc` mà trang trắng), và in ra địa chỉ dài
   hơn cần thiết cho mục chính.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_ORDER_STATES, ADMIN_TABS, ADMIN_TAB_META, adminQuery, adminTabPath, readAdminTab, readAdminView } from './adminTabs.js'

test('chín mục: Tổng quan đứng đầu, nhật ký đứng cuối', () => {
  assert.deepEqual(ADMIN_TABS,
    ['overview', 'pending', 'active', 'expired', 'picked', 'orders', 'done', 'media', 'log'])
  /* Tổng quan là câu hỏi ĐẦU TIÊN của người mở bảng ("tuần này thế nào"), nên
     nó là mục mở ra mặc định — không phải hàng đợi. */
  assert.equal(ADMIN_TABS[0], 'overview')
  /* Đã pick đứng ngay sau nhóm hàng đợi: nó là "suất Up next đang do bài nào
     giữ", cùng nhóm câu hỏi với Chờ duyệt / Đang xử lý / Hết hạn. */
  assert.equal(ADMIN_TABS.indexOf('picked'), ADMIN_TABS.indexOf('expired') + 1)
  /* Mục Bình luận đã bị gỡ cùng tính năng bình luận (migration 20261216) —
     một mục trỏ tới bảng không còn tồn tại là mục chết. */
  assert.equal(ADMIN_TABS.includes('comments'), false)
  /* Nhật ký là chỗ TRA CỨU, không phải việc phải làm hôm nay — nó không được
     chen trước hàng đợi duyệt bài. */
  assert.equal(ADMIN_TABS.at(-1), 'log')
})

test('đọc mục từ địa chỉ: chỉ nhận mục có thật', () => {
  assert.equal(readAdminTab('?tab=orders'), 'orders')
  assert.equal(readAdminTab('?tab=media&x=1'), 'media')
  assert.equal(readAdminTab('?tab=abc'), null, 'mục không có thật phải rơi về mặc định')
  assert.equal(readAdminTab(''), null)
  assert.equal(readAdminTab(undefined), null)
})

test('mục chính (Tổng quan) dùng địa chỉ trần, các mục khác mới có tham số', () => {
  assert.equal(adminTabPath('/admin', 'overview'), '/admin')
  assert.equal(adminTabPath('/admin', 'pending'), '/admin?tab=pending')
  assert.equal(adminTabPath('/admin', 'orders'), '/admin?tab=orders')
  assert.equal(adminTabPath('/admin', null), '/admin')
})

test('dải số liệu lấy đúng danh sách mục, không có danh sách thứ hai', () => {
  /* Lỗi cũ: `AdminPanel` tự viết lại năm mục kèm nhãn + màu. Thêm mục ở một
     nơi thì mục đó có địa chỉ nhưng không có ô nào bấm tới. */
  assert.deepEqual(ADMIN_TAB_META.map(m => m.k), ADMIN_TABS)
  for (const m of ADMIN_TAB_META) {
    assert.ok(m.label, `${m.k}: thiếu nhãn`)
    assert.ok(m.tone, `${m.k}: thiếu màu`)
    /* Tổng quan KHÔNG đếm: nó là ba tấm thẻ tự đếm lấy (chờ duyệt / chờ lâu
       nhất / tiền đã nhận). `count: null` là khai báo có chủ ý, không phải sót. */
    if (m.k === 'overview') assert.equal(m.count, null, 'Tổng quan không có phép đếm riêng')
    else assert.ok(m.count, `${m.k}: thiếu tên phép đếm`)
  }
})

test('bộ lọc của bảng quản trị sống ở địa chỉ: đọc lại đúng, giá trị lạ rơi về mặc định', () => {
  assert.deepEqual(readAdminView('?tab=active&q=  aespa &sort=votes&kind=Short', ['Short', 'Full Album']),
    { q: 'aespa', sort: 'votes', kind: 'Short', ost: 'all', focus: '' })
  /* loại bài lạ phải rơi về 'all' — nhưng chỉ khi biết danh sách loại có thật
     (bảng quản trị truyền KIND_META vào; hàm thuần không tự biết) */
  assert.deepEqual(readAdminView('?sort=abc&kind=Không-Có', ['Short']),
    { q: '', sort: 'default', kind: 'all', ost: 'all', focus: '' })
  assert.deepEqual(readAdminView(''), { q: '', sort: 'default', kind: 'all', ost: 'all', focus: '' })
  assert.deepEqual(readAdminView(undefined), { q: '', sort: 'default', kind: 'all', ost: 'all', focus: '' })
  assert.equal(readAdminView(`?q=${'x'.repeat(200)}`).q.length, 80, 'từ khoá dán vào địa chỉ phải bị cắt')
})

test('trạng thái đơn hàng đọc từ địa chỉ: chỉ nhận ba trạng thái có thật', () => {
  assert.deepEqual(ADMIN_ORDER_STATES, ['awaiting', 'paid', 'rejected'])
  assert.equal(readAdminView('?tab=orders&ost=paid').ost, 'paid')
  assert.equal(readAdminView('?ost=awaiting').ost, 'awaiting')
  /* gõ tay một trạng thái không có thật: danh sách phải hiện hết, không được
     lọc ra rỗng mà không ai hiểu vì sao */
  assert.equal(readAdminView('?ost=abc').ost, 'all')
  assert.equal(readAdminView('?ost=all').ost, 'all')
  /* đơn hàng dùng `ost`, KHÔNG dùng `kind`: một địa chỉ cũ của mục request
     không được lặng lẽ lọc mục đơn hàng */
  assert.equal(readAdminView('?kind=Short').ost, 'all')
})

test('địa chỉ chỉ ghi tham số KHÁC mặc định — danh sách chưa lọc vẫn là địa chỉ ngắn', () => {
  assert.equal(adminQuery({ tab: 'overview' }), '')
  assert.equal(adminQuery({ tab: 'pending' }), '?tab=pending')
  assert.equal(adminQuery({ tab: 'orders' }), '?tab=orders')
  assert.equal(adminQuery({ tab: 'active', q: 'aespa', sort: 'votes', kind: 'Short' }),
    '?tab=active&q=aespa&sort=votes&kind=Short')
  /* đi vòng: dựng địa chỉ rồi đọc lại phải ra đúng bộ lọc cũ */
  const url = adminQuery({ tab: 'active', q: 'aespa', sort: 'votes', kind: 'Short' })
  const back = readAdminView(url, ['Short', 'Full Album'])
  assert.deepEqual(back, { q: 'aespa', sort: 'votes', kind: 'Short', ost: 'all', focus: '' })
  assert.equal(readAdminTab(url), 'active')
  /* trạng thái đơn đi vòng y hệt; `all` không được ghi vào địa chỉ */
  assert.equal(adminQuery({ tab: 'orders', ost: 'all' }), '?tab=orders')
  const ordersUrl = adminQuery({ tab: 'orders', ost: 'awaiting', q: 'minji' })
  assert.equal(ordersUrl, '?tab=orders&q=minji&ost=awaiting')
  assert.equal(readAdminView(ordersUrl).ost, 'awaiting')
})

test('đi vòng qua lại không sinh ra hai địa chỉ cho cùng một mục', () => {
  for (const k of ADMIN_TABS) {
    const url = adminTabPath('/admin', k)
    const back = readAdminTab(url.split('?')[1] || '')
    assert.equal(back, k === ADMIN_TABS[0] ? null : k, `${k} phải đọc lại đúng chính nó`)
  }
})

test('?focus=<id> là đích của một lần mở, không phải bộ lọc được ghi lại', () => {
  assert.equal(readAdminView('?tab=pending&focus=abc-123').focus, 'abc-123')
  assert.equal(readAdminView('?focus=').focus, '', 'rỗng thì không mở gì')
  assert.equal(readAdminView(`?focus=${'x'.repeat(200)}`).focus.length, 64,
    'id dán vào địa chỉ phải bị cắt, không được làm địa chỉ phình ra')
  /* Nếu `focus` được ghi lại thì F5 sau khi đóng khung sửa vẫn mở lại khung đó. */
  assert.equal(adminQuery({ tab: 'pending', focus: 'abc-123' }), '?tab=pending')
})
