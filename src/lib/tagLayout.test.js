/* NHÃN KHÔNG ĐƯỢC CHỒNG NHAU — hai vế, một bài kiểm
   ---------------------------------------------------------
   Người dùng báo "các tag/label đôi khi bị chồng lên nhau" (vòng 9) và vẫn thấy
   vướng (vòng 10). Nhìn ảnh chụp thì không đoán được chỗ nào; nên hai luật dưới
   đây biến lời phàn nàn đó thành thứ máy kiểm được:

   1. MÃ JSX — cụm từ HAI nhãn trở lên phải nằm trong một hộp `.tags` (hộp đó
      biết xuống dòng và có khe). Dò theo dòng: dòng nào có từ hai nhãn mà trong
      8 dòng quanh nó không có `.tags` là lỗi. Đây là bài kiểm TĨNH, không dựng
      DOM — nó bắt đúng lỗi hay xảy ra (thêm một nhãn vào một hàng đã có nhãn mà
      quên bọc `.tags`), không cố làm việc của một trình biên dịch.

   2. CSS — mỗi nhãn phải KẸP được (nowrap + `flex: none` giữ nó khỏi bị bóp
      méo, `max-width: 100%` + cắt ba chấm giữ nó khỏi tràn ra ngoài khung bo
      góc), hộp chứa nhãn phải có khe và biết xuống dòng, và nhãn DÀI nhất của
      hệ phải thật sự cắt được bằng dấu ba chấm (xem `.pill.dup`: `text-overflow`
      không chạy trên hộp `inline-flex`).
   Chạy: npm test */

import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))

const jsxFiles = () => {
  const out = []
  for (const d of ['src', 'src/components', 'src/lib']) {
    for (const f of readdirSync(`${root}${d}`)) {
      if (/\.jsx$/.test(f) && !/\.test\.jsx?$/.test(f)) out.push(`${d}/${f}`)
    }
  }
  return out
}

/* Một "nhãn" trong JSX: `className="pill …"`, `className="kind"`, hoặc bản
   template literal `` className={`kind ${…}`} ``. */
const TAG = /className=(?:"|\{`)[^"`]*\b(pill|kind)\b/g

test('cụm từ hai nhãn trở lên nằm trong một hộp .tags (hộp biết xuống dòng)', () => {
  const bad = []
  for (const f of jsxFiles()) {
    const lines = readFileSync(root + f, 'utf8').split('\n')
    lines.forEach((ln, i) => {
      if ((ln.match(TAG) || []).length < 2) return
      /* cửa sổ 8 dòng mỗi bên: cụm nhãn có thể trải vài dòng của một biểu thức */
      const win = lines.slice(Math.max(0, i - 8), i + 9).join('\n')
      if (!/className="tags"/.test(win)) bad.push(`${f}:${i + 1}  ${ln.trim().slice(0, 90)}`)
    })
  }
  assert.deepEqual(bad, [], 'nhãn đứng cạnh nhau mà không nằm trong .tags thì chúng chồng nhau khi hộp hẹp')
})

test('mỗi nhãn kẹp được theo hộp cha: không tràn, không bị bóp méo', () => {
  const css = readFileSync(`${root}src/index.css`, 'utf8')
  const base = css.match(/\.pill, \.kind \{([^}]*)\}/)[1]
  assert.match(base, /flex:\s*none/, 'nhãn không được bị bóp méo khi hàng hết chỗ')
  assert.match(base, /white-space:\s*nowrap/, 'nhãn không được tự xuống dòng giữa chữ')
  assert.match(base, /line-height:\s*1/, 'chiều cao nhãn phải cố định, không phụ thuộc chữ trong đó')

  const clamp = css.match(/\.pill, \.kind \{[^}]*max-width:\s*100%[^}]*\}/)
  assert.ok(clamp, 'thiếu vế max-width: 100% — thiếu nó thì một nhãn dài vẫn tràn khỏi khung bo góc')
  assert.match(clamp[0], /overflow:\s*hidden/, 'muốn cắt thì phải giấu phần thừa')
  assert.match(clamp[0], /text-overflow:\s*ellipsis/, 'cắt mà không có dấu ba chấm là cắt cụt giữa chữ')

  /* NHÃN DÀI NHẤT: "3 requests for this song · 9 votes in total". */
  const dup = css.match(/\.pill\.dup \{([^}]*)\}/)
  assert.ok(dup, 'nhãn dài nhất của hệ phải có luật riêng')
  assert.match(dup[1], /display:\s*inline-block/,
    'text-overflow không chạy trên hộp inline-flex — nhãn dài phải về inline-block mới cắt được bằng ba chấm')
  const adm = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(adm, /className="pill dup" title=\{/,
    'phần chữ bị cắt phải đọc được ở title — cắt mà không có đường đọc lại là mất thông tin')
})

test('hộp chứa nhãn có khe và biết xuống dòng', () => {
  const css = readFileSync(`${root}src/index.css`, 'utf8')
  for (const [sel, re] of [
    ['.tags', /\.tags \{[^}]*flex-wrap:\s*wrap[^}]*\}/],
    ['.tags', /\.tags \{[^}]*gap:\s*\d/],
    ['.tags', /\.tags \{[^}]*min-width:\s*0/],
    ['.meta', /\.meta \{[^}]*flex-wrap:\s*wrap/],
    ['.vm-sub', /\.vm-sub \{[^}]*flex-wrap:\s*wrap/],
  ]) {
    assert.match(css, re, `${sel} phải có khe / biết xuống dòng, nếu không hai nhãn dài sẽ đè lên nhau`)
  }
  /* Chữ đứng cạnh nhãn phải co được, không thì nó đẩy nhãn ra ngoài khung. */
  const tx = css.match(/\.tags \.tx \{([^}]*)\}/)
  assert.ok(tx, 'thiếu luật cho chữ đứng cạnh nhãn trong .tags')
  assert.match(tx[1], /min-width:\s*0/, 'chữ trong .tags phải co được')
  assert.match(tx[1], /text-overflow:\s*ellipsis/, 'chữ dài trong .tags cắt bằng ba chấm, không đẩy nhãn đi')
})

test('nhãn không tự dựng lại ở chỗ khác: mọi nhãn đều đi qua .pill / .kind', () => {
  const files = jsxFiles()
  const stray = []
  for (const f of files) {
    const body = readFileSync(root + f, 'utf8')
    /* Nhãn viết tay: một <span> có class chứa "tag"/"badge" nhưng không phải
       .pill/.kind/.tags — đó là nhãn thứ hai của cùng một hệ, và hệ thứ hai thì
       luôn lệch khỏi hệ thứ nhất sau vài vòng sửa. */
    for (const m of body.matchAll(/className=(?:"|\{`)([^"`]*?)["`]/g)) {
      const cls = m[1]
      if (/\b(badge|taglabel|tagnum)\b/.test(cls) && !/\btags\b/.test(cls)) stray.push(`${f}: ${cls}`)
    }
  }
  assert.deepEqual(stray, [], 'một hệ nhãn thứ hai sẽ lệch khỏi hệ đang dùng')
})
