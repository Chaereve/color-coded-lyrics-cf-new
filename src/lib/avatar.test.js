import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import {
  AVATAR_STORED_CHARS, ANIMATED_AVATAR_MAX_BYTES, ANIMATED_AVATAR_MAX_KB,
  processAnimatedAvatar, usesCloudinary,
} from './avatar.js'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('GIF avatar bypasses canvas so animation is not reduced to the first frame', () => {
  const src = readFileSync(`${root}src/lib/avatar.js`, 'utf8')
  const panel = readFileSync(`${root}src/components/ProfilePanel.jsx`, 'utf8')
  assert.match(src, /processAnimatedAvatar/)
  assert.match(src, /file\.type !== 'image\/gif'/)
  assert.match(panel, /file\.type === 'image\/gif'/)
  assert.match(panel, /processAnimatedAvatar\(file\)/)
  assert.match(panel, /accept="image\/jpeg,image\/png,image\/gif,image\/webp"/)
})

/* =========================================================
   LỖI CHỦ DỰ ÁN BÁO: "set avt = gif không được".
   ---------------------------------------------------------
   Phía trình duyệt hứa "tối đa 2,5 MB", còn `update_my_profile()`
   trong database chặn ở 200.000 ký tự (`length(p_avatar) > 200000`
   → raise 'err.avatarBig'). Một GIF 1-2 MB vì thế đi hết đường:
   app báo "GIF sẵn sàng", bấm Save mới lỗi.

   Bốn ca dưới đây chạy THẬT hàm `processAnimatedAvatar` (không đọc
   mã nguồn): nạp một `FileReader` giả, còn `File` là của Node. Phải
   như vậy thì mới chốt được ba điều mà đọc chữ không thấy:
     · ảnh vừa trần đi qua NGUYÊN BYTES (không vẽ lại → còn chuyển động);
     · ảnh quá trần bị chặn TRƯỚC khi dựng chuỗi base64 (không tốn công);
     · con số trần của client đúng bằng con số của database.
   ========================================================= */

/** Trình duyệt tối thiểu đủ cho một lần đọc file: chỉ `FileReader`. */
function fakeReader(t) {
  const state = { reads: 0 }
  class FakeFileReader {
    readAsDataURL(blob) {
      state.reads += 1
      blob.arrayBuffer().then(
        (buf) => {
          this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`
          this.onload?.()
        },
        () => this.onerror?.(new Error('read failed')),
      )
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  Object.defineProperty(globalThis, 'FileReader', { value: FakeFileReader, configurable: true, writable: true })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'FileReader', previous)
    else delete globalThis.FileReader
  })
  return state
}

const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // "GIF89a" — validateImageFile soi 6 byte đầu

/** Một GIF thật đúng nghĩa: có chữ ký, và phần còn lại là dữ liệu đệm. */
function gifBytes(bytes) {
  const buf = new Uint8Array(bytes)
  buf.set(GIF_HEAD)
  return buf
}
const gifFile = (bytes) => new File([gifBytes(bytes)], 'nhay.gif', { type: 'image/gif' })

test('ảnh động vừa trần: đi nguyên bytes nên còn chuyển động', async (t) => {
  assert.equal(usesCloudinary, false, 'ca này phải chạy đúng đường KHÔNG có Cloudinary')
  const state = fakeReader(t)
  const raw = gifBytes(120 * 1024)
  const { url, bytes, hosted } = await processAnimatedAvatar(new File([raw], 'nhay.gif', { type: 'image/gif' }))

  assert.equal(hosted, false)
  assert.equal(bytes, raw.length)
  assert.equal(state.reads, 1, 'phải đọc file đúng một lần')
  /* So NGUYÊN VĂN với data URL dựng từ chính bytes đó: khác một ký tự là
     ảnh đã bị vẽ lại (canvas chỉ giữ khung đầu) hoặc bị nén lại. */
  assert.equal(url, `data:image/gif;base64,${Buffer.from(raw).toString('base64')}`)
  assert.ok(url.length <= AVATAR_STORED_CHARS, `${url.length} ký tự phải nằm trong trần ${AVATAR_STORED_CHARS}`)
})

test('ảnh động quá trần bị chặn TRƯỚC khi dựng chuỗi base64', async (t) => {
  const state = fakeReader(t)
  const file = gifFile(300 * 1024)
  await assert.rejects(() => processAnimatedAvatar(file), (e) => {
    assert.equal(e.message, 'err.avatarAnimBig')
    assert.equal(e.vars.kb, 300)
    assert.equal(e.vars.max, ANIMATED_AVATAR_MAX_KB)
    return true
  })
  assert.equal(state.reads, 0, 'biết là quá trần thì không đọc file nữa')
})

test('trần của client đúng bằng trần của database, sát từng byte', async (t) => {
  const state = fakeReader(t)
  /* Con số lớn nhất còn nằm dưới trần: vừa đúng thì qua, hơn một byte thì chặn. */
  const edge = await processAnimatedAvatar(gifFile(ANIMATED_AVATAR_MAX_BYTES))
  assert.ok(edge.url.length <= AVATAR_STORED_CHARS,
    `đúng trần mà ra ${edge.url.length} ký tự (> ${AVATAR_STORED_CHARS}) là sai số học`)
  await assert.rejects(() => processAnimatedAvatar(gifFile(ANIMATED_AVATAR_MAX_BYTES + 1)),
    (e) => e.message === 'err.avatarAnimBig' && e.vars.max === ANIMATED_AVATAR_MAX_KB)
  assert.equal(state.reads, 1, 'chỉ đọc cho file hợp lệ')
})

test('database vẫn giữ nguyên trần 200.000 ký tự mà client đang bám theo', () => {
  const sql = ['supabase/schema.sql', 'supabase/migrations/20261106_security_audit.sql']
    .map((p) => readFileSync(`${root}${p}`, 'utf8'))
  for (const text of sql) {
    assert.match(text, new RegExp(`length\\(p_avatar\\) > ${AVATAR_STORED_CHARS}\\b`),
      `SQL phải chặn ở đúng ${AVATAR_STORED_CHARS} ký tự`)
    assert.match(text, /raise exception 'err\.avatarBig'/)
  }
  /* Và phía client không được quay lại hứa 2,5 MB: đó chính là lỗi cũ. */
  const src = readFileSync(`${root}src/lib/avatar.js`, 'utf8')
  assert.doesNotMatch(src, /2\.5\s*\*\s*1024\s*\*\s*1024/)
  assert.doesNotMatch(src, /\[\s*MAX_FILE_MB\s*:\s*2\.5\s*\]/)
  assert.ok(ANIMATED_AVATAR_MAX_KB < 1024, 'trần thật nhỏ hơn 1 MB, nên nhãn KB mới đúng')
})

test('giao diện nói ra con số và mở lối thoát, không để người dùng bế tắc', () => {
  const panel = readFileSync(`${root}src/components/ProfilePanel.jsx`, 'utf8')
  const dict = readFileSync(`${root}src/lib/i18n.jsx`, 'utf8')
  /* Kiểm NGAY khi chọn file, không đợi tới lúc bấm Save. */
  const check = panel.indexOf('!usesCloudinary && file.size > ANIMATED_AVATAR_MAX_BYTES')
  const process = panel.indexOf('await processAnimatedAvatar(file)')
  assert.ok(check > 0 && process > check, 'phép kiểm dung lượng phải đứng TRƯỚC lời gọi xử lý ảnh')
  assert.match(panel, /t\('prof\.gifTooBig'/, 'phải nói rõ quá bao nhiêu KB và trần là bao nhiêu')
  assert.match(panel, /t\('prof\.gifStill'\)/, 'ảnh động quá lớn vẫn phải có lối lấy khung đầu tiên')
  /* Lưới an toàn khi database từ chối: nhận đúng mã lỗi rồi mở lại lối thoát. */
  assert.match(panel, /e\?\.message === 'err\.avatarBig'/)
  for (const key of ['prof.gifTooBig', 'err.avatarAnimBig']) {
    const line = dict.split('\n').find((l) => l.includes(`'${key}'`))
    assert.ok(line, `thiếu câu chữ cho ${key}`)
    assert.match(line, /\{kb\}/)
    assert.match(line, /\{max\}/)
  }
})
