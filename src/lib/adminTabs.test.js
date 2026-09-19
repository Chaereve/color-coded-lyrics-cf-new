/* Địa chỉ của trang quản trị.
   ---------------------------------------------------------
   `?tab=…` là thứ duy nhất khiến một mục trong bảng quản trị dán được cho người
   khác, giữ được qua F5, và lùi được bằng nút Back. Hai lỗi phải chặn: nhận một
   mục KHÔNG có thật (gõ tay `?tab=abc` mà trang trắng), và in ra địa chỉ dài
   hơn cần thiết cho mục chính.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_TABS, adminTabPath, readAdminTab } from './adminTabs.js'

test('năm mục, đúng thứ tự ưu tiên: việc gấp nhất đứng trước', () => {
  assert.deepEqual(ADMIN_TABS, ['pending', 'active', 'orders', 'done', 'media'])
})

test('đọc mục từ địa chỉ: chỉ nhận mục có thật', () => {
  assert.equal(readAdminTab('?tab=orders'), 'orders')
  assert.equal(readAdminTab('?tab=media&x=1'), 'media')
  assert.equal(readAdminTab('?tab=abc'), null, 'mục không có thật phải rơi về mặc định')
  assert.equal(readAdminTab(''), null)
  assert.equal(readAdminTab(undefined), null)
})

test('mục chính dùng địa chỉ trần, các mục khác mới có tham số', () => {
  assert.equal(adminTabPath('/admin', 'pending'), '/admin')
  assert.equal(adminTabPath('/admin', 'orders'), '/admin?tab=orders')
  assert.equal(adminTabPath('/admin', null), '/admin')
})

test('đi vòng qua lại không sinh ra hai địa chỉ cho cùng một mục', () => {
  for (const k of ADMIN_TABS) {
    const url = adminTabPath('/admin', k)
    const back = readAdminTab(url.split('?')[1] || '')
    assert.equal(back, k === 'pending' ? null : k, `${k} phải đọc lại đúng chính nó`)
  }
})
