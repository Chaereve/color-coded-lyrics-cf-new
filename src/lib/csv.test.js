/* CSV — ba cái bẫy của định dạng này, mỗi cái một ca.
   ---------------------------------------------------------
   File xuất ra phải mở được bằng Excel/Google Sheets mà không lệch cột. Lỗi ở
   đây không làm sập trang, nó chỉ làm dữ liệu sai âm thầm — đúng loại lỗi phải
   khoá bằng test chứ không bằng mắt.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, csvFileName, toCsv } from './csv.js'

const COLS = [
  { k: 'kind', label: 'Loại' },
  { k: 'artist', label: 'Nghệ sĩ' },
  { k: 'note', label: 'Ghi chú', get: (r) => r.note },
]

test('ô có dấu phẩy bị bọc nháy kép, nháy kép trong dữ liệu được nhân đôi', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('nói "không"'), '"nói ""không"""')
  assert.equal(csvCell('xuống\ndòng'), '"xuống\ndòng"')
  assert.equal(csvCell('bình thường'), 'bình thường')
  assert.equal(csvCell(null), '', 'null thành ô rỗng, không thành chữ "null"')
  assert.equal(csvCell(0), '0', 'số 0 phải giữ được, không bị coi là rỗng')
})

test('bảng có dòng tiêu đề, mỗi dòng đúng số cột, và có BOM cho Excel', () => {
  const csv = toCsv(
    [{ kind: 'CCL', artist: 'aespa', note: 'có, dấu phẩy' }],
    COLS)
  const lines = csv.replace(/^\ufeff/, '').trimEnd().split('\r\n')
  assert.equal(lines.length, 2, 'một dòng tiêu đề + một dòng dữ liệu')
  assert.equal(lines[0], 'Loại,Nghệ sĩ,Ghi chú')
  assert.equal(lines[1], 'CCL,aespa,"có, dấu phẩy"')
  assert.ok(csv.startsWith('\ufeff'), 'thiếu BOM là Excel đọc tiếng Việt thành ký tự lạ')
})

test('bảng rỗng vẫn ra file hợp lệ (chỉ còn dòng tiêu đề)', () => {
  const csv = toCsv([], COLS)
  assert.equal(csv.replace(/^\ufeff/, '').trim(), 'Loại,Nghệ sĩ,Ghi chú')
  assert.equal(toCsv(null, COLS).replace(/^\ufeff/, '').trim(), 'Loại,Nghệ sĩ,Ghi chú')
})

test('cột có thể lấy giá trị bằng hàm, và dòng thiếu trường không làm vỡ file', () => {
  const csv = toCsv([{ kind: 'CCL' }, {}], COLS)
  const lines = csv.replace(/^\ufeff/, '').trimEnd().split('\r\n')
  assert.deepEqual(lines.slice(1), ['CCL,,', ',,'])
})

test('tên file: có ngày, không dấu, không ký tự lạ', () => {
  const d = new Date('2026-09-19T00:00:00Z')
  assert.equal(csvFileName('Chờ duyệt', d), 'cho-duyet-2026-09-19.csv')
  assert.equal(csvFileName('', d), 'danh-sach-2026-09-19.csv')
  assert.equal(csvFileName('a/b:c*?', d), 'a-b-c-2026-09-19.csv')
})
