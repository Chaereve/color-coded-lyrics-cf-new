/* Lọc + phân trang bình luận của trang quản trị.
   Đây là bản JS của CÙNG luật mà RPC `admin_comments_page` chạy trong database
   (migration 20261212): dùng cho chế độ demo, cho đường lui khi migration chưa
   áp dụng, và làm lưới test không cần database.
   Điều phải chốt: tìm được theo nội dung / người viết / tên bài, bỏ dấu, và
   tổng số là tổng THẬT chứ không phải số dòng của một trang.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_COMMENTS_PER_PAGE, matchAdminComment, pageAdminComments } from './adminComments.js'

const c = (o) => ({
  id: 'c1', body: 'Bài này hay quá', author: 'Minh', songTitle: 'Whiplash',
  songArtist: 'aespa', created_at: '2026-10-01T00:00:00.000Z', ...o,
})

const items = [
  c({ id: '1', body: 'Cho mình xin link nhé', author: 'Minh' }),
  c({ id: '2', body: 'Hay thật', author: 'Chung Hạ', songTitle: 'Pop Off', songArtist: 'LE SSERAFIM' }),
  c({ id: '3', body: 'Mình thích phần lyrics', author: 'An', songTitle: 'Get Up' }),
]

test('tìm theo nội dung, người viết và tên bài — mỗi từ dò độc lập', () => {
  assert.deepEqual(items.filter(x => matchAdminComment(x, 'lyrics')).map(x => x.id), ['3'])
  assert.deepEqual(items.filter(x => matchAdminComment(x, 'chung ha')).map(x => x.id), ['2'])
  assert.deepEqual(items.filter(x => matchAdminComment(x, 'whiplash minh')).map(x => x.id), ['1'])
  assert.deepEqual(items.filter(x => matchAdminComment(x, 'pop sserafim')).map(x => x.id), ['2'])
  assert.deepEqual(items.filter(x => matchAdminComment(x, '')).map(x => x.id), ['1', '2', '3'],
    'từ khoá rỗng không lọc gì')
})

test('từ khoá có dấu gõ đúng cũng khớp, và không khớp khi thiếu từ', () => {
  /* `fold` bỏ dấu ở CẢ hai phía, nên "Hạ" và "ha" là cùng một từ khoá. */
  assert.deepEqual(items.filter(x => matchAdminComment(x, 'chung hạ')).map(x => x.id), ['2'])
  assert.deepEqual(items.filter(x => matchAdminComment(x, 'chung ha minh')).map(x => x.id), [])
})

test('phân trang: tổng là tổng THẬT, không phải số dòng của một trang', () => {
  const many = Array.from({ length: 45 }, (_, i) => c({ id: String(i), body: `bình luận ${i}` }))
  const first = pageAdminComments(many, { page: 1, perPage: ADMIN_COMMENTS_PER_PAGE })
  assert.equal(first.total, 45)
  assert.equal(first.rows.length, ADMIN_COMMENTS_PER_PAGE)
  assert.equal(first.pages, 3)
  assert.deepEqual([first.from, first.to], [1, ADMIN_COMMENTS_PER_PAGE])

  const last = pageAdminComments(many, { page: 3, perPage: ADMIN_COMMENTS_PER_PAGE })
  assert.equal(last.rows.length, 45 - 2 * ADMIN_COMMENTS_PER_PAGE)
  assert.deepEqual([last.from, last.to], [41, 45])
})

test('tổng tính trên kết quả ĐÃ LỌC, nên thanh phân trang không hứa trang rỗng', () => {
  const page = pageAdminComments(items, { q: 'hay', page: 1 })
  assert.equal(page.total, 1, 'chỉ "Hay thật" khớp')
  assert.equal(page.pages, 1)
  assert.deepEqual(page.rows.map(x => x.id), ['2'])
})

test('trang vượt quá số trang thì lùi về trang cuối, không trả trang trắng', () => {
  const page = pageAdminComments(items, { page: 99, perPage: 2 })
  assert.equal(page.page, 2)
  assert.deepEqual(page.rows.map(x => x.id), ['3'])
  const empty = pageAdminComments([], { page: 5 })
  assert.deepEqual([empty.page, empty.total, empty.from, empty.to], [1, 0, 0, 0])
})
