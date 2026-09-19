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
       nhưng vẫn là progressbar đúng nghĩa. Màu do CSS quyết (`.prog { --sc }`)
       nên markup KHÔNG mang màu — cùng một bài phải cùng một màu ở mọi màn hình. */
    const wide = draw({ pct: 60, label: 'Build progress', wide: true })
    assert.match(wide, /class="prog prog-wide"/)
    assert.doesNotMatch(wide, /--sc/, 'màu vạch là việc của CSS, không phải của chỗ gọi')
    assert.doesNotMatch(wide, /prog-num/, 'đã có .steps-pct in số rồi thì thanh không in lại')
    const full = draw({ pct: 100, label: 'Build progress' })
    assert.match(full, /class="prog prog-full"/, 'tick hết mốc là một trạng thái, phải đánh dấu được')

    /* 0% KHÔNG có vạch. Bản trước luôn dựng vạch và luôn giữ `min-width: 6px`
       cho 1% dễ thấy, nên ở 0% vẫn có một que màu nằm trong rãnh trong khi con
       số cạnh nó ghi "0%" — hai chỗ nói ngược nhau. */
    for (const zero of [0, -3, 'abc', undefined, null]) {
      const html = draw({ pct: zero, label: 'Build progress' })
      assert.doesNotMatch(html, /<i /, `pct=${String(zero)} không được vẽ vạch nào`)
      assert.match(html, /class="prog-track"/, 'rãnh thì vẫn phải còn (nó là cái khung)')
    }
    assert.match(draw({ pct: 1, label: 'Build progress' }), /--w:1%/, '1% vẫn phải là một vạch thật')
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
  /* RÃNH 4px (vòng 17). Bản trước là 6px với lý do "đủ dày để đọc được mà
     không thành một dải băng" — nhưng chủ dự án gửi ảnh chụp và nói đúng bốn
     chữ: "thanh progress đang bị bự và xấu quá". Sáu pixel cạnh một con số in
     đậm màu vàng, trong một khối rộng 340px trên cột danh sách ~740px, thì nó
     ĐÚNG LÀ một dải băng. Bốn pixel vẫn đọc được ở 1x mà đọc ra là "một
     đường". Phép kiểm này chốt cả hai vế của lần siết đó: rãnh mảnh, và khối
     không được rộng lại. */
  assert.match(css, /\.prog-track\s*\{[^}]*height:\s*4px/, 'rãnh 4px — một đường, không phải một dải băng')
  assert.match(css, /\.prog \{[^}]*max-width:\s*220px/,
    'khối vạch + số không được rộng quá 220px (cột danh sách chỉ ~740px)')
  const numRule = css.match(/\.prog-num \{[^}]*\}/)[0]
  assert.match(numRule, /font-size:\s*10\.5px/, 'số là chú thích, không phải biển báo')
  assert.match(numRule, /font-weight:\s*500/, 'số không được in đậm — nó là thứ to tiếng nhất trong hàng')
  assert.match(numRule, /var\(--txt-2\)/, 'số pha với xám để không hét lên bằng màu bão hoà')
  assert.match(css, /\.prog-track > i\s*\{[^}]*width:\s*var\(--w, 0%\)/)
  assert.match(css, /\.prog-num\s*\{[^}]*tabular-nums/, 'số phải đứng yên khi tiến độ đổi')

  /* VẠCH PHẲNG (vòng 11) — khuôn lấy từ thanh tiến độ của Preline: rãnh bo
     tròn + ruột đặc một màu + nhãn ở cuối. Ba thứ bị gỡ cùng lúc, vì mỗi thứ
     là một lớp trang trí chồng lên một thanh cao 6px, và chủ dự án đọc đúng
     bản chất của chúng: "gradient progress bar nhìn kì cục và AI quá". */
  const fill = css.match(/\.prog-track > i \{([^}]*)\}/)[1]
  assert.match(fill, /background:\s*var\(--sc/, 'ruột vạch là MỘT màu đặc, không pha')
  assert.doesNotMatch(fill, /gradient|#fff|inset|box-shadow/,
    'ruột vạch không được có gradient, ánh sáng, quầng, hay bóng lõm')
  assert.doesNotMatch(css, /\.prog-track > i::before/, 'mũi sáng ở đầu vạch đã bị gỡ')
  assert.doesNotMatch(fill, /animation:/, 'vạch không mọc bằng animation nữa — chỉ dài ra khi số đổi')
  assert.match(css, /\.prog-track\s*\{[^}]*background:\s*var\(--surface-3\)/,
    'rãnh là một sắc nền, không phải bóng lõm')
  assert.match(css, /\.prog-track > i[^{]*\{[^}]*transition:\s*width/,
    'vạch dài ra có chuyển tiếp — khuôn của Preline (transition duration-500)')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.prog-track > i \{ transition: none/,
    'ai tắt hiệu ứng thì thanh đứng yên')
  assert.match(css, /\.prog-full \{ --sc: var\(--done\); \}/,
    'tick hết mốc thì --sc đổi sang màu xong')
  assert.match(src.get('src/components/Progress.jsx'), /prog-full/,
    'component phải thật sự đánh dấu trạng thái đã tick hết mốc')
  /* Bảng quản trị và trang chủ phải tô GIỐNG nhau: không truyền màu trạng thái
     vào vạch nữa (cùng một bài từng có hai màu vạch ở hai màn hình). */
  assert.doesNotMatch(src.get('src/components/AdminPanel.jsx'), /<Progress pct=\{pct\}[^>]*color=/,
    'bảng quản trị không được tự tô màu vạch khác trang chủ')
  /* Dấu % đi cùng tông với con số, không phải một màu xám thứ ba. */
  assert.match(css, /\.prog-num span \{[^}]*opacity:\s*\.55/)

  /* Ba chỗ dùng: hàng request, khối Up next, hàng admin. */
  assert.match(src.get('src/App.jsx'), /<Progress pct=\{r\.progress\}/)
  assert.match(src.get('src/App.jsx'), /<Progress pct=\{rep\.progress\}/)
  assert.match(src.get('src/components/AdminPanel.jsx'), /<Progress pct=\{pct\}[^>]*wide/)
})
