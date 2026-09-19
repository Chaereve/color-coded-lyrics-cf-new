/* Đồng hồ tiến độ: chốt hai điều.
   ---------------------------------------------------------
   1) Giá trị rác không được lọt ra màn hình. `pct` đi từ dữ liệu máy chủ
      (progress trong bảng requests) qua vài lần gộp nhóm, nên nó có thể là
      undefined, "abc", 150 hay -3. Trước đây con số này được in thẳng —
      `<span>{r.progress}%</span>` — nên một dòng dữ liệu méo là cả trang hiện
      "NaN%" hoặc "150%". Nay mọi giá trị bị kẹp về 0..100 tại một chỗ.
   2) Một khối duy nhất. Trước đây hàng request in số trần + chấm trạng thái,
      rồi BÊN DƯỚI là một cái vạch rời (.bar). Bài này canh cả hai đầu: markup
      của Progress, và việc không còn ai dựng thanh tiến độ bằng tay.

   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Progress kẹp giá trị rác về 0..100 và báo đúng cho trình đọc màn hình', async () => {
  const server = await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-prog-ui-test',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    const { default: Progress } = await server.ssrLoadModule('/src/components/Progress.jsx')
    const draw = (props) => renderToStaticMarkup(createElement(Progress, props))

    const plain = draw({ pct: 45, label: 'Build progress' })
    assert.match(plain, /class="prog"/)
    assert.match(plain, /role="progressbar"/)
    assert.match(plain, /aria-valuenow="45"/)
    assert.match(plain, /aria-valuemin="0"/)
    assert.match(plain, /aria-valuemax="100"/)
    assert.match(plain, /aria-label="Build progress"/, 'thiếu nhãn thì máy đọc chỉ đọc con số trơ')
    assert.match(plain, /--w:45%/, 'bề rộng vạch phải theo đúng giá trị')
    assert.match(plain, />45<span aria-hidden="true">%<\/span></, 'số đi cùng dấu %')
    assert.equal((plain.match(/<i /g) || []).length, 1, 'đúng MỘT vạch, không dựng thêm vạch nào')

    /* Giá trị rác: không NaN, không 150%, không -3%. */
    for (const [input, want] of [[150, 100], [-3, 0], ['abc', 0], [undefined, 0], [null, 0], [NaN, 0]]) {
      const html = draw({ pct: input, label: 'Build progress' })
      assert.match(html, new RegExp(`aria-valuenow="${want}"`), `pct=${String(input)} phải thành ${want}`)
      assert.doesNotMatch(html, /NaN|undefined/, `pct=${String(input)} không được lọt ra markup`)
    }

    /* Bản gọn (hàng admin): không lặp lại con số vì số tổng đã in ngay trên,
       nhưng vẫn là progressbar đúng nghĩa và tô màu theo trạng thái. */
    const wide = draw({ pct: 60, label: 'Build progress', color: 'var(--queued)', wide: true })
    assert.match(wide, /class="prog prog-wide"/)
    assert.match(wide, /--sc:var\(--queued\)/)
    assert.doesNotMatch(wide, /prog-num/, 'đã có .steps-pct in số rồi thì thanh không in lại')
    assert.match(wide, /aria-valuenow="60"/)
  } finally {
    await server.close()
  }
})

test('không còn thanh tiến độ nào dựng bằng tay', () => {
  const files = []
  for (const d of ['src', 'src/components', 'src/lib']) {
    for (const f of readdirSync(`${root}${d}`)) {
      /* file test tự nhắc tên lớp cũ trong câu khẳng định nên phải bỏ qua */
      if (/\.(jsx|js)$/.test(f) && !/\.test\.js$/.test(f)) files.push(`${d}/${f}`)
    }
  }
  const src = new Map(files.map(f => [f, readFileSync(root + f, 'utf8')]))
  const barUsers = [...src].filter(([, body]) => /className="bar"|className={`bar/.test(body)).map(([f]) => f)
  assert.deepEqual(barUsers, [], 'thanh tiến độ phải đi qua component Progress, không dựng lại .bar')

  /* .bar cũ đã bị gỡ khỏi CSS; .prog mới phải thật sự có luật. */
  const css = readFileSync(`${root}src/index.css`, 'utf8')
  assert.doesNotMatch(css, /^\.bar\s*\{/m, 'luật .bar cũ phải bị xoá')
  assert.match(css, /\.prog-track\s*\{[^}]*height:\s*6px/, 'vạch 6px, không phải sợi chỉ 3px khó thấy')
  assert.match(css, /\.prog-track > i\s*\{[^}]*width:\s*var\(--w, 0%\)/)
  assert.match(css, /\.prog-num\s*\{[^}]*tabular-nums/, 'số phải đứng yên khi tiến độ đổi')

  /* Ba chỗ dùng: hàng request, khối Up next, hàng admin. */
  assert.match(src.get('src/App.jsx'), /<Progress pct=\{r\.progress\}/)
  assert.match(src.get('src/App.jsx'), /<Progress pct=\{rep\.progress\}/)
  assert.match(src.get('src/components/AdminPanel.jsx'), /<Progress pct=\{pct\}[^>]*wide/)
})
