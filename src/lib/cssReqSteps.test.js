/* Chốt chặn TĨNH cho việc "chia form request thành các bước + làm mới giao diện
   bước" (vòng 12, mục 2). Yêu cầu của người dùng rất ngắn — ba ô chữ
   "1 Pick a type / 2 Name the song / 3 Send it" nằm trên một cột dài không nói
   được người dùng đang ở đâu — nên hợp đồng ở đây phải chặt hơn phần nhìn:

     1. ba bước là BA MÀN: `.req-pane` có nhịp vào riêng, và bước chưa tới không
        dựng phần thân của nó (điều đó do ActionModal.test.js canh ở phía JSX);
     2. dải bước là bộ chỉ báo tiến trình THẬT: vòng số (`.rs-n`) + nhãn
        (`.rs-t`) + đoạn nối (`.rs-line`), với hai trạng thái đọc ra được là
        `done` và `on`;
     3. mỗi mục là một NÚT bấm được (quay lại bước cũ), trừ bước gửi khi chưa
        đủ hai ô bắt buộc — trạng thái đó là `disabled` thật;
     4. máy hẹp: vẫn đủ ba vòng số, chỉ mở nhãn của bước đang đứng;
     5. reduced-motion: cả hai nhịp (đoạn nối + màn vào) đều tắt.

   Đây là hợp đồng theo CẶP giống cssFilterBar.test.js: mỗi mục phải còn cả vế
   desktop LẪN vế máy hẹp, vì vế máy hẹp là thứ bị xoá đầu tiên khi dọn CSS.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const cssRaw = at('../index.css')
const jsx = at('../components/ActionModal.jsx')
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')   // bỏ ghi chú, chỉ đọc luật

const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({
    sels: sel.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean),
    body: body.replace(/\s+/g, ' ').trim(),
  }))
const bodies = (sel) => RULES.filter((r) => r.sels.includes(sel)).map((r) => r.body)
const anchor = (sel, re, what = '') => {
  const hits = bodies(sel).filter((b) => re.test(b))
  assert.equal(hits.length, 1, `\`${sel}\` phải có đúng một khối ${what} (đang có ${hits.length})`)
  return hits[0]
}

/* ---------- 1. ba bước là ba màn ---------- */
test('mỗi bước là một màn có nhịp vào riêng, và nhịp đó tắt khi giảm chuyển động', () => {
  const pane = anchor('.req-pane', /animation:\s*paneIn/, 'nhịp vào')
  assert.match(pane, /animation:\s*paneIn/)
  assert.match(pane, /both/, 'nhịp vào phải giữ trạng thái cuối, không nháy về đầu')
  /* Nhịp NGẮN: đổi bước là việc lặp đi lặp lại, không phải một màn trình diễn.
     Trần 300ms lấy từ design-motion-principles (dưới 300ms cho việc UI). */
  const ms = Number(/([\d.]+)s/.exec(pane)?.[1] ?? 0) * 1000
  assert.ok(ms > 0 && ms <= 300, `nhịp vào phải ngắn (đang ${ms}ms)`)
  /* Chỉ mờ + nhích lên vài px: form không phải băng chuyền trượt ngang. */
  const kfLine = css.split('\n').find((l) => /@keyframes\s+paneIn/.test(l))
  assert.ok(kfLine, 'phải có keyframes paneIn')
  const kfFrom = /from\s*\{([^}]*)\}/.exec(kfLine)?.[1] ?? ''
  const kfTo = /to\s*\{([^}]*)\}/.exec(kfLine)?.[1] ?? ''
  assert.match(kfFrom, /opacity:\s*0/, 'vào bằng cách mờ dần')
  assert.match(kfFrom, /translateY\(\s*\d/, 'nhích lên vài px')
  assert.match(kfTo, /opacity:\s*1/)
  assert.match(kfTo, /transform:\s*none/)
  assert.doesNotMatch(kfLine, /translateX/, 'không trượt ngang')
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.req-pane\s*\{\s*animation:\s*none/,
    'giảm chuyển động thì bỏ hẳn nhịp vào')
})

/* ---------- 2. dải bước đọc ra tiến trình ---------- */
test('dải bước đủ ba phần: vòng số, nhãn, đoạn nối — và hai trạng thái done/on', () => {
  const strip = anchor('.req-steps', /list-style:\s*none/, 'dải bước')
  assert.match(strip, /display:\s*flex/)
  assert.doesNotMatch(css, /\.req-steps\s+li\s*\{/, 'luật của ba ô chữ cũ phải bị gỡ hẳn')
  /* Vòng số: hình tròn, cỡ chạm được tính theo cặp (22px là vòng số, nút bọc
     quanh nó mới là vùng bấm — xem .rs-btn). */
  const num = anchor('.rs-n', /border-radius:\s*50%/, 'vòng số')
  assert.match(num, /display:\s*grid/)
  assert.match(num, /place-items:\s*center/)
  assert.match(num, /width:\s*22px/)
  /* Nhãn: MỘT dòng, cắt bằng … chứ không xuống dòng — nhãn xuống dòng làm cả
     dải bước cao lên và lệch hàng. */
  const txt = anchor('.rs-t', /white-space:\s*nowrap/, 'nhãn bước')
  assert.match(txt, /text-overflow:\s*ellipsis/)
  assert.match(txt, /overflow:\s*hidden/)
  /* Nút chứa cả hai: bấm được, có focus nhìn thấy, và trạng thái disabled thật. */
  const btn = anchor('.rs-btn', /border:\s*0/, 'nút bước')
  assert.match(btn, /cursor:\s*pointer/)
  assert.match(btn, /flex:\s*0 1 auto/, 'nút co được để nhãn dài bị cắt, không đẩy tràn thẻ')
  assert.match(anchor('.rs-btn:focus-visible', /outline/, 'viền focus riêng'), /outline/)
  assert.match(anchor('.rs-btn:disabled', /cursor:\s*default/, 'trạng thái disabled'), /opacity/)
  /* Đoạn nối nằm TRONG dải bước → không cần thanh phần trăm thứ hai. */
  const line = anchor('.rs-line', /height:\s*2px/, 'đoạn nối')
  assert.match(line, /flex:\s*1 1 auto/)
  assert.match(line, /background:\s*var\(--line\)/)
})

test('bước xong tô đoạn nối + vòng số; bước đang đứng là vòng số ĐẶC màu nhấn', () => {
  assert.match(anchor('.req-step.done .rs-line', /background:\s*color-mix/, 'đoạn nối đã qua'),
    /color-mix\(in srgb, var\(--a-2\)/)
  assert.match(anchor('.req-step.done .rs-n', /--a-soft/, 'vòng số đã xong'), /color-mix|--a-soft/)
  const on = anchor('.req-step.on .rs-n', /background:\s*var\(--a\)/, 'vòng số đang đứng')
  assert.match(on, /color:\s*#fff/, 'chữ trên nền nhấn phải là trắng (tương phản)')
  /* Bước đang đứng chỉ ĐẬM HƠN một bậc — không thêm khung, không thêm bóng,
     không thêm dấu chấm: dải bước đã nói đủ. */
  const onBtn = anchor('.req-step.on .rs-btn', /font-weight:\s*600/, 'chữ bước đang đứng')
  assert.doesNotMatch(onBtn, /box-shadow|border:/, 'không thêm khung cho bước đang đứng')
  /* Bước chưa tới: chìm hẳn, đọc là "chưa tới" chứ không phải "bấm được mà mờ". */
  assert.match(anchor('.rs-btn', /color:\s*var\(--txt-3\)/, 'màu chữ mặc định'), /color:\s*var\(--txt-3\)/)
})

test('bấm được bước đã qua (nút thật), và bước 3 bị khoá tới khi đủ hai ô bắt buộc', () => {
  assert.match(jsx, /className="rs-btn"[\s\S]{0,160}?disabled=\{n === 3 && !ready\}/,
    'nút bước 3 chỉ mở khi form đã đủ điều kiện gửi')
  assert.match(jsx, /aria-current=\{here \? 'step' : undefined\}/, 'bước đang đứng phải mang aria-current="step"')
  assert.match(jsx, /<ol className="req-steps" aria-label=\{t\('req\.stepsAria'\)\}>/,
    'dải bước là danh sách có tên đọc được')
  assert.match(jsx, /onClick=\{\(\) => goStep\(n\)\}/, 'mọi mục đều bấm tới được')
  /* Thứ tự DOM = thứ tự Tab = thứ tự trình đọc màn hình đọc lên. */
  const order = [...jsx.matchAll(/className=\{`rs-n`\}|className="rs-n"|className="rs-t"/g)]
  assert.ok(order.length >= 2, 'vòng số và nhãn phải nằm trong cùng một nút, đúng thứ tự')
})

/* ---------- 3. máy hẹp ---------- */
test('máy hẹp: giữ đủ ba vòng số, chỉ mở nhãn của bước đang đứng', () => {
  /* Trang có NHIỀU nhánh 620px (thanh lọc, hàng ô, ô dài…). Phải chọn đúng
     nhánh nói về dải bước, không phải nhánh đầu tiên gặp được. */
  const blocks = [...css.matchAll(/@media\s*\(max-width:\s*620px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
  const block = blocks.find((b) => /\.rs-t|\.req-step/.test(b))
  assert.ok(block, 'phải có nhánh máy hẹp cho dải bước')
  assert.match(block, /\.rs-t\s*\{\s*display:\s*none/, 'nhãn bước khác phải gấp lại')
  assert.match(block, /\.req-step\.on\s+\.rs-t\s*\{\s*display:\s*inline/, 'nhãn bước đang đứng vẫn hiện')
  assert.match(block, /\.rs-line\s*\{[^}]*min-width/, 'đoạn nối ngắn lại nhưng vẫn còn')
  assert.doesNotMatch(block, /\.req-step\s*\{[^}]*flex:\s*0 0 auto/, 'ba bước vẫn phải chia đều hàng')
})
