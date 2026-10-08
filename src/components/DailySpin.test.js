/* Render the actual JSX with Vite's SSR loader, without running browser effects
   or connecting to Supabase. Guard the requested layout against regressions:
   head / stage (wheel + action | status card) / footer, 7 honest sectors. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Daily Spin renders head, dial with its action, status card and footer', async () => {
  const server = await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-spin-ui-test',
    // A developer's .env must not turn this UI-only test into a live DB client.
    envPrefix: 'CCL_SPIN_UI_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    const { default: DailySpin } = await server.ssrLoadModule('/src/components/DailySpin.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(DailySpin, {
        userId: 'test-user', credits: 12, purchased: 7, bonus: 5,
        onBalance() {}, onVote() {},
      })))

    assert.doesNotMatch(html, /<img\b|<image\b|logo-\d|spin-wheel-halo|spin-intro|spin-eyebrow/)

    // 1. head: title, demo badge and the reset countdown chip (not buried below)
    const head = html.match(/<header class="spin-head">([\s\S]*?)<\/header>/)?.[1]
    assert.ok(head, 'the section needs a head band')
    assert.match(head, /Daily bonus wheel/)
    assert.match(head, /Next reset/)
    assert.match(head, /--:--:--/)
    /* Đầu trang CHỈ có tiêu đề + nhãn demo + đồng hồ đếm ngược (vòng 12):
       dòng trung bình Reward đã bị gỡ, và test này chốt đúng việc đó — dựng
       lại nó là hỏng ở đây. */
    assert.doesNotMatch(head, /3\.24|bonus votes on average/)

    // 2. stage: the wheel and the button that spins it stay in one column
    const dial = html.match(/<div class="spin-dial">([\s\S]*?)<aside class="spin-panel">/)?.[1]
    assert.ok(dial, 'stage must keep a dial column and a status card')
    assert.ok(dial.indexOf('spin-wheel-wrap') < dial.indexOf('spin-button'), 'action sits under the wheel')
    assert.match(dial, /class="spin-result"/)
    assert.doesNotMatch(dial, /spin-rules|spin-odds/)
    /* Không còn câu ghi chú "ô nào cũng có thưởng" nằm dưới nút: luật đó đã
       hiện ra bằng chính các ô có thưởng trên đĩa. */
    assert.doesNotMatch(dial, /spin-hint|Every sector wins/)

    /* 7 lát, MỖI LÁT MỘT MỨC THƯỞNG, độ rộng cung = trọng số đã duyệt
       (30%..1% — xác suất không đổi giữa bản vẽ và phép rút của server). Màu
       đi theo một thang sáng dần theo độ hiếm: t1..t7, đúng một lát mỗi tông. */
    assert.equal((html.match(/class="spin-sector [^"]*"/g) || []).length, 7)
    for (const tier of ['t1', 't2', 't3', 't4', 't5', 't6', 't7']) {
      assert.equal((html.match(new RegExp(`class="spin-sector ${tier}(?: |")`, 'g')) || []).length, 1,
        `đúng MỘT lát ${tier}`)
    }
    assert.equal((html.match(/class="spin-sector [^"]*weave/g) || []).length, 0,
      'không còn mẹo tô xen kẽ: ranh giới ô do nét viền vẽ ra')
    /* Mỗi ô in ĐÚNG MỘT nhãn; ô +20 — cung 3,6° nhỏ hơn cả chữ — là huy hiệu
       vàng nằm ngang đè đúng tâm ô. Bảy nhãn, không nhãn nào lặp lại. */
    const labels = [...html.matchAll(/class="spin-wheel-number[^"]*"[^>]*>([\s\S]*?)<\/text>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, '').trim())
    assert.deepEqual(labels, ['+1', '+2', '+3', '+5', '+8', '+10', '+20'], 'bảy nhãn, một nhãn cho một ô')
    assert.equal(new Set(labels).size, labels.length, 'không nhãn nào lặp lại')
    assert.equal((html.match(/class="spin-wheel-number jackpot"/g) || []).length, 1)
    assert.equal((html.match(/class="spin-wheel-jackpot-plate"/g) || []).length, 1,
      'ô giải cao nhất có đúng một huy hiệu vàng')
    /* Không nan hoa: nét viền lát đã tự kẻ ranh giới, đường kẻ từ trục ra vành
       chỉ làm bánh xe trông như nan hoa xe đạp. */
    assert.equal((html.match(/class="spin-wheel-spoke"/g) || []).length, 0, 'không còn nan hoa')
    /* Bánh xe chỉ còn NĂM lớp: vành + đường tóc ngoài, lát, số, trục, con trỏ.
       Vành chia độ 48 vạch, mũi chỉ trên trục, chấm trục, đường tóc trong lòng
       đĩa và cung ăn mừng ngoài vành đều đã bị gỡ — chúng nói lại điều lát và
       con trỏ đã nói. */
    assert.equal((html.match(/class="spin-wheel-tick/g) || []).length, 0, 'không còn vành chia độ')
    assert.equal((html.match(/class="spin-wheel-hub-mark"/g) || []).length, 0, 'không còn mũi chỉ trên trục')
    assert.equal((html.match(/class="spin-wheel-seam"/g) || []).length, 0, 'không còn đường tóc trong đĩa')
    assert.equal((html.match(/class="spin-wheel-rim"/g) || []).length, 1)
    assert.equal((html.match(/class="spin-wheel-hub"/g) || []).length, 1, 'trục là MỘT đĩa phẳng')
    /* Chưa có kết quả thì không được có dấu hiệu ăn mừng nào */
    assert.doesNotMatch(html, /spin-burst|spin-wheel-win-arc|spin-won-num/)
    assert.match(html,
      /aria-label="Wheel with 7 sectors: \+1 30%, \+2 25%, \+3 20%, \+5 12%, \+8 8%, \+10 4%, \+20 1%\. Brighter sectors are rarer\."/)
    // Nothing is highlighted before a result exists.
    assert.doesNotMatch(html, /has-won|is-won|spin-wheel-marker/)

    // 3. status card: three metrics (spins, purchased, bonus), the slot bar,
    //    two short rules (the reset line lives in the head chip, not twice)
    const panel = html.match(/<aside class="spin-panel">([\s\S]*?)<\/aside>/)?.[1]
    assert.ok(panel)
    // purchased and bonus balances are shown as their own metrics, not a
    // combined "Purchased + bonus" number
    assert.match(panel, /7<small>votes<\/small>/)
    assert.match(panel, /5<small>votes<\/small>/)
    assert.match(panel, /<span>Purchased<\/span>/)
    assert.match(panel, /<span>Bonus<\/span>/)
    assert.doesNotMatch(panel, /Purchased \+ bonus/)
    const pips = panel.match(/<span class="spin-pips"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    assert.equal((pips?.match(/<i /g) || []).length, 2, 'two daily slots, drawn as a bar')

    const rules = panel.match(/<ul class="spin-rules"[^>]*>([\s\S]*?)<\/ul>/)?.[1]
    assert.ok(rules)
    assert.equal((rules.match(/<li>/g) || []).length, 2)
    const words = rules.replace(/<[^>]*>/g, ' ').trim().split(/\s+/)
    assert.ok(words.length <= 25, 'rules should stay short')
    assert.match(rules, /2 spins daily, for one account per browser/)
    /* Mốc reset KHÔNG được nhắc lại ở đây: nó đã là một chip ở đầu khối. */
    assert.doesNotMatch(rules, /GMT/, 'reset chỉ được nói một lần, ở chip đếm ngược')
    assert.doesNotMatch(rules, /hardware|fingerprint|cookie|browser ID/i)

    // 4. today's rewards sit in the status card; the odds now live in the
    //    legend pills (swatch + reward + real chance from the weights) and the
    //    spend link stands next to its heading
    assert.doesNotMatch(html, /spin-odds|spin-chip|<footer class="spin-account"/)
    assert.match(dial, /\+20<\/b><small>1%<\/small>/, 'chú giải nói đúng tỉ lệ của bảng trọng số')
    assert.match(dial, /\+1<\/b><small>30%<\/small>/)
    assert.match(panel, /<div class="spin-history">/)
    assert.match(panel, /Today’s rewards/)
    assert.match(panel, /No spins yet\./)
    /* Chưa quay thì KHÔNG in dòng tổng: "+0 vote" là một con số vô nghĩa. */
    assert.doesNotMatch(panel, /spin-total/)
    assert.match(panel, /class="spin-vote-link"/)
  } finally {
    await server.close()
  }
})


test('Daily Spin uses flat site colours and opts out of the shared background', async () => {
  const [pageCss, siteCss] = await Promise.all([
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
    readFile(new URL('../index.css', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(pageCss, /(?:linear|radial|conic)-gradient\s*\(/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*background:\s*var\(--surface\)/)
  /* Bảy tông, tất cả là token — MỘT tông cho MỘT ô, sáng dần theo độ hiếm:
       +1 nền · +2/+3 xanh tím pha dần · +5 hổ phách pha · +8 lavender
       +10 hổ phách đặc · +20 vàng đặc (chữ mực đậm cho đủ tương phản). */
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-1:\s*var\(--surface-3\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-2:\s*color-mix\(in oklab, var\(--queued\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-3:\s*color-mix\(in oklab, var\(--queued\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-4:\s*color-mix\(in oklab, var\(--progress\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-5:\s*var\(--a-2\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-6:\s*var\(--progress\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-7:\s*var\(--paid\)/)
  /* Tông lát đi theo MỨC THƯỞNG: mỗi lớp tier trỏ về một token, nên đổi bảng
     thưởng là đổi luôn bảng màu — không phải sửa tay từng lát. */
  assert.match(pageCss, /\.spin-sector\s*\{[^}]*fill:\s*var\(--wc/)
  assert.match(pageCss, /\.spin-sector\.t1\s*\{[^}]*--wc:\s*var\(--w-1\)/)
  assert.match(pageCss, /\.spin-sector\.t7\s*\{[^}]*--wc:\s*var\(--w-7\)/)
  /* Ranh giới giữa các ô: nét mảnh màu nền thẻ, nằm trong lát. */
  assert.match(pageCss, /\.spin-sector\s*\{[^}]*stroke:\s*var\(--surface\)/)
  assert.doesNotMatch(pageCss, /\.spin-sector\.(?:alt|base)/, 'tông xen kẽ theo chẵn/lẻ đã bị gỡ')
  /* Nhãn ô CHỈ là con số thưởng; tỉ lệ đã nằm trong chú giải. */
  assert.doesNotMatch(pageCss, /\.spin-wheel-times\s*\{/)
  assert.doesNotMatch(pageCss, /--w-\d[abc]/, 'bảng 12 sắc độ đã bị gỡ')
  // Số thưởng đọc bằng màu chữ của trang; các lát SÁNG (t5/t6) và ô vàng đổi
  // sang mực đậm — trắng trên nền sáng chỉ được ~2:1.
  assert.match(pageCss, /\.spin-wheel-number\s*\{[^}]*fill:\s*var\(--txt\)/)
  assert.match(pageCss, /\.spin-wheel-number\.t5[^{]*\{[^}]*fill:\s*#1a1206/)
  assert.match(pageCss, /\.spin-wheel-number\.t6[^{]*\{[^}]*fill:\s*#1a1206/)
  assert.match(pageCss, /\.spin-wheel-number\.jackpot\s*\{[^}]*fill:\s*#1a1206/,
    'chữ trên ô vàng phải là mực đậm (trắng trên vàng chỉ ~2,5:1)')
  assert.match(pageCss, /\.spin-wheel-jackpot-plate\s*\{[^}]*fill:\s*var\(--paid\)/,
    'huy hiệu +20 cùng màu vàng với lát của nó')
  // Không quầng sáng màu nhấn: đĩa nổi bằng bóng đổ trung tính.
  assert.doesNotMatch(pageCss, /box-shadow[^;]*var\(--a-glow\)/, 'bỏ quầng sáng màu')
  // Con trỏ gõ theo nhịp THẬT do JS đặt (drivePointer), không rung đều vô hạn.
  assert.doesNotMatch(pageCss, /spinPointerTick|animation:\s*spinPointerTick/)
  assert.match(pageCss, /\.spin-wheel-pointer svg\s*\{[^}]*transition:\s*transform/)
  assert.match(pageCss, /\.daily-spin \.btn-primary::after\s*\{[^}]*content:\s*none/)
  assert.match(pageCss, /prefers-reduced-motion/)
  assert.match(siteCss, /html\[data-section="spin"\] \.bgfx\s*\{[^}]*display:\s*none/)
})

/* ---------- KÉO ĐĨA (vòng 13, phần dư) ---------- */

test('kéo đĩa: chuột/bút kéo được, ngón tay thì không, và nhả ra mới quay', async () => {
  const [jsx, pageCss] = await Promise.all([
    readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
  ])

  /* NGUYÊN TẮC: trên máy cảm ứng, kéo một ngón ở giữa màn hình là cuộn trang.
     Cướp thao tác đó để quay thì trang khó dùng hơn hẳn, mà nút quay 46px đã
     nằm ngay dưới đĩa. */
  assert.match(jsx, /e\.pointerType === 'touch'[^\n]*return/,
    'phải chặn kéo bằng ngón tay ngay đầu dragDown')
  assert.match(jsx, /onPointerDown=\{canDrag \? drag\.down : undefined\}/,
    'chỉ gắn tay kéo khi đĩa thật sự kéo được (còn lượt và đang đứng yên)')

  /* PHẦN KÉO NẰM Ở LỚP BỌC, KHÔNG Ở ĐĨA: đĩa đã có transform của nhịp quay
     CSS. Kéo ở lớp bọc rồi cộng dồn lúc nhả ra là cách duy nhất để đĩa không
     nhảy về vị trí cũ trước khi quay. */
  assert.match(jsx, /el\.style\.transform = `rotate\(\$\{d\.turned\}deg\)`/)
  assert.match(jsx, /angle\.current \+= d\.turned/,
    'lúc nhả phải cộng phần đã kéo vào góc thật TRƯỚC khi gọi lượt quay')
  assert.match(jsx, /discRef\.current\.style\.transform = `rotate\(\$\{angle\.current\}deg\)`/,
    'đặt lại transform của đĩa theo góc mới trong cùng khung hình')

  /* Tiếng tách khi kéo: cùng hàm đếm vạch, có sàn thời gian, và đi theo hướng
     nào cũng kêu (giá trị tuyệt đối). */
  assert.match(jsx, /dragTicks\(d\.tickAt, d\.turned, \{ ms: now - d\.last \}\)/)
  assert.match(jsx, /now - d\.lastTick < DRAG_TICK_GAP_MS/)
  assert.match(jsx, /Math\.min\(3, Math\.abs\(count\)\)/, 'một cú nhích dài không thành tràng tạch tạch')

  /* CSS: hình bàn tay chỉ hiện khi kéo được; lúc kéo thì tắt nhịp đàn hồi. */
  assert.match(pageCss, /\.spin-wheel-wrap\.can-drag \{[^}]*cursor:\s*grab/)
  assert.match(pageCss, /\.spin-wheel-wrap\.dragging \{[^}]*transition:\s*none/)
  assert.match(pageCss, /prefers-reduced-motion[\s\S]*\.spin-wheel-wrap \{[^}]*transition:\s*none !important/)
})
