/* The mystery box is a STANDALONE page at /mystery-box (owner decision):
   its own route, its own nav entry, and a check-in gate that points back to
   /daily-login without ever claiming on the box's behalf. The page shell is
   rendered through Vite's SSR loader (async data stays "loading" server-side,
   which is exactly what must happen); the card is rendered with REAL payload
   shapes, like DailyLogin.test renders RewardCard.

   BẢNG GIẢI v3 được khoá ở đây: DUY NHẤT một outcome +5 votes (4%);
   0.4% = +1 free paid request; 0.1% = +2 free paid requests — hai mức paid
   KHÁC số lượng, không gộp, không nhãn mơ hồ. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
const card = (over = {}) => ({
  user_id: 'u1', day: '2026-10-08', enabled: true, checked_in: false,
  opened: false, result: null, reward_votes: 0, reward_kind: null, ...over,
})

async function withVite(run) {
  const server = await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-mystery-ui-test',
    envPrefix: 'CCL_MYSTERY_UI_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try { return await run(server) } finally { await server.close() }
}

test('the standalone page renders its own shell and waits for data server-side', async () => {
  await withVite(async server => {
    const { default: MysteryBoxPage } = await server.ssrLoadModule('/src/components/MysteryBoxPage.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(MysteryBoxPage, { userId: 'test-user', onDailyLogin() {} })))
    // Own heading + reset chip; nothing from the check-in page leaks in here.
    assert.match(html, /Daily box/)
    assert.match(html, /Next reset/)
    assert.doesNotMatch(html, /Your check-in calendar|Check-in rewards/)
    // Data arrives client-side only: server shows the loading state, never a
    // fake box, never a prize.
    assert.match(html, /aria-busy="true"/)
    assert.doesNotMatch(html, /[Cc]redits/)
  })
})

test('the card: locked points to check-in, ready offers the box, opened shows the committed result', async () => {
  await withVite(async server => {
    const { MysteryBox } = await server.ssrLoadModule('/src/components/MysteryBox.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const render = (mystery, checkedIn) => renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(MysteryBox, { userId: 'u1', mystery, checkedIn, onOpened() {} })))

    // MỘT vùng trạng thái aria-live (nhận focus sau reveal): mọi bước được đọc,
    // focus không bị rơi giữa animation. (vòng 5: vùng live = thanh kết quả.)
    const live = render(card({ checked_in: true }), true)
    assert.match(live, /class="box-bar r0" role="status" aria-live="polite" aria-atomic="true"/)

    // LOCKED: gate copy, hộp mờ có khoá; hộp vẫn là <button> nhưng DISABLED.
    const locked = render(card({ checked_in: false }), false)
    assert.match(locked, /Check in to unlock/)
    assert.match(locked, /<button[^>]*disabled/)
    assert.match(locked, /box-stage[^"]*is-locked/)
    assert.match(locked, /mystery-padlock/)
    assert.doesNotMatch(locked, /aria-label="Open daily box"/)

    // READY: chính HỘP là nút mở (vòng 5); chưa có dòng giải.
    const ready = render(card({ checked_in: true }), true)
    assert.match(ready, /Daily box is ready/)
    assert.match(ready, /aria-label="Open daily box"/)
    assert.match(ready, /Tap to open/)
    assert.doesNotMatch(ready, /mystery-padlock/)

    // OPENED (+5 votes): the committed result — DUY NHẤT outcome +5 của bảng.
    const opened = render(card({ checked_in: true, opened: true, result: 3, reward_votes: 5, reward_kind: 'votes' }), true)
    assert.match(opened, /\+5 votes/)
    assert.match(opened, /Next box in/)
    assert.match(opened, /box-prize votes/)
    assert.doesNotMatch(opened, /aria-label="Open daily box"/)

    // NOTHING (result 0): "Chúc may mắn" — KHÔNG giống thông báo lỗi, không +0.
    const nothing = render(card({ checked_in: true, opened: true, result: 0, reward_votes: 0, reward_kind: 'nothing' }), true)
    assert.match(nothing, /Better luck next time\./)
    assert.match(nothing, /box-prize nothing/)
    assert.doesNotMatch(nothing, /\+0/)

    // PAID +1 (result 5, v2 kind): nói rõ FREE PAID REQUEST, không mơ hồ.
    const paid1 = render(card({ checked_in: true, opened: true, result: 5, reward_votes: 0, reward_kind: 'free_paid_request' }), true)
    assert.match(paid1, /\+1 free paid request/)
    assert.match(paid1, /box-prize free_paid_request/)
    assert.doesNotMatch(paid1, /\+1 free request</, 'không còn nhãn mơ hồ cũ')

    // PAID +2 (result 6, cùng kind, KHÁC số lượng): phải phân biệt rõ với +1.
    const paid2 = render(card({ checked_in: true, opened: true, result: 6, reward_votes: 0, reward_kind: 'free_paid_request' }), true)
    assert.match(paid2, /\+2 free paid requests/)
    assert.doesNotMatch(paid2, /\+1 free paid request/, 'hai mức paid không được gộp nhãn')

    // Row v1 (legacy kind 'paid_request' = +1) vẫn đọc đúng, không vỡ.
    const legacy = render(card({ checked_in: true, opened: true, result: 5, reward_votes: 0, reward_kind: 'paid_request' }), true)
    assert.match(legacy, /\+1 free paid request/)
  })
})

/* Opening flow (vòng 5, bản mẫu): LẮC → MỞ NẮP → reel TRỒI LÊN NẰM TRÊN
   hộp → dừng đúng ô kết quả SERVER. RPC chạy song song với nhịp lắc; ô đích
   chỉ diễn tả lại kết quả. Không client pick, không random, không reflow. */
test('opening flow: lock instantly → shake 800ms (RPC song song) → lid flips → reel 4.6s lands on server result → reveal', async () => {
  const read = async f => (await import('node:fs/promises')).readFile(new URL(f, import.meta.url), 'utf8')
  const jsx = await read('./MysteryBox.jsx')
  // Nút bị chặn NGAY: busy-guard + chỉ mở từ trạng thái available.
  assert.match(jsx, /if \(busy\.current \|\| phase !== 'idle' \|\| opened \|\| !checkedIn\) return/)
  // Kết quả server quyết TRƯỚC: RPC chạy SONG SONG với nhịp charge 450ms.
  assert.match(jsx, /const rpc = openMysteryBox\(userId, day\)/)
  assert.match(jsx, /const \[result\] = await Promise\.all\(\[rpc, wait\(MYSTERY_SHAKE_MS\)\]\)/)
  // Ô đích GHỈ ĐÈ bằng kết quả thật — client không chọn gì, hai mức paid
  // phân biệt bằng con số trên ô (+1 / +2).
  /* Số trên ô paid đọc từ reward_amount SERVER trả; payload cũ thiếu trường
     thì mới derive theo result — không tự chế số. */
  assert.match(jsx, /Number\.isInteger\(result\?\.mystery\?\.reward_amount\)/)
  assert.match(jsx, /prizeResult === 6 \? 2 : 1/)
  assert.match(jsx, /setWinTile\(\{ kind: 's5', label: `\+\$\{amount\}` \}\)/)
  /* Filler TẤT ĐỊNH (chu kỳ cố định) — không random trên dải. */
  assert.match(jsx, /FILLER_CYCLE|TAIL_CYCLE/)
  assert.doesNotMatch(jsx, /Math\.random\(\)|weightedPick|pickPrize/,
    'client không được tự chọn phần thưởng')
  // Timeline chặt: lắc 800ms (RPC song song) → reel trồi lên 950ms rồi trượt
  // 4600ms tới ô đích → reveal.
  assert.match(jsx, /setPhase\('shaking'\)/)
  assert.match(jsx, /setPhase\('reeling'\)/)
  assert.match(jsx, /const MYSTERY_SHAKE_MS = 800/)
  assert.match(jsx, /const MYSTERY_RISE_MS = 950/)
  assert.match(jsx, /const MYSTERY_REEL_MS = 4600/)
  assert.match(jsx, /const MYSTERY_MISS_MS = 900/)
  assert.match(jsx, /sfx\.boxOpen\(\)/)
  assert.match(jsx, /sfx\.boxEmpty\(\)/)
  assert.match(jsx, /sfx\.boxWin\(/)
  assert.match(jsx, /is-miss/)
  assert.match(jsx, /setReveal\(true\)/)
  // Reel = component DÙNG CHUNG của mystery (không đụng Daily Spin);
  // hằng số hợp đồng sống ở lib để test node trần dùng chung một nguồn.
  assert.match(jsx, /import CaseOpeningReel from '\.\/CaseOpeningReel\.jsx'/)
  assert.match(jsx, /REEL_TARGET_INDEX, REEL_ITEM_COUNT,/)
  /* Reel GIỮ qua reveal (settled, không unmount) — ô đích sáng sau khi dừng. */
  assert.match(jsx, /\(phase === 'reeling' \|\| reveal\) && \(/)
  assert.match(jsx, /spinning=\{phase === 'reeling'\}\s*\n\s*settled=\{reveal\}/)
  assert.match(jsx, /targetIndex=\{REEL_TARGET_INDEX\}/)
  assert.match(jsx, /duration=\{MYSTERY_REEL_MS\} hold=\{MYSTERY_RISE_MS\} onSettled=\{finish\}/)
  // Reveal trả focus về vùng kết quả; callback cha neo bằng ref (đổi identity
  // mỗi render → không neo là cleanup vô hạn, reveal không bao giờ tới).
  assert.match(jsx, /outcomeRef\.current\?\.focus\?\.\(\{ preventScroll: true \}\)/)
  assert.match(jsx, /const onOpenedRef = useRef\(onOpened\)/)
  // Reduced-motion: bỏ charge + reel, fade thẳng kết quả đầy đủ.
  assert.match(jsx, /if \(quick\) \{\s*\n\s*resultRef\.current = await rpc/)
  // Không audio tự phát.
  assert.doesNotMatch(jsx, /<audio|autoplay|new Audio/)

  const css = await read('./MysteryBox.css')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  /* 3D phải GIỮ KHỐI: filter/opacity trên .cube/.lid/.box3d flatten mặt
     (hộp nhìn như mảng tối). overflow:hidden trên sân khấu thì được — clip
     tia/sao; khối 3D render trong .box3d (preserve-3d nội bộ). */
  assert.match(css, /\.box3d\s*\{[^}]*transform-style:\s*preserve-3d/)
  assert.match(css, /\.box-stage\s*\{[^}]*overflow:\s*hidden/)
  assert.doesNotMatch(css, /\.box-stage\.is-locked \.cube[\s\S]{0,80}filter:/,
    'filter trên .cube dẹt 3D — locked phải đổi màu từng mặt')
  assert.doesNotMatch(css, /\.box-stage\.is-opened \.cube[\s\S]{0,80}filter:/)
  assert.match(css, /transform:\s*rotateX\(158deg\)/,
    'nắp ngả ra sau gần nằm, không đứng 84°/112° che reel')
  /* Mặt 3D phải prefix box- — .f/.in/.s từng là CSS toàn cục, vào Daily Box
     xong rời đi là card trang chủ bị nhuộm gradient tím hồng. */
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(cssNoComment, /(^|}|,)(\s*)\.(f|fr|bk|lf|rt|in|s|lid|bd|gl|bow)(\s|,|\{)/,
    'không selector mặt hộp trần — CSS này sống sót sau khi rời /mystery-box')
  assert.match(css, /\.box-stage-fx\s*\{[^}]*overflow:\s*hidden/,
    'tia/beam phải clip trong lớp fx, không trong cây preserve-3d')
  // Keyframes động chỉ đụng transform/opacity — không gây reflow.
  for (const kf of ['box-tw', 'box-rot', 'box-shake', 'box-pulse', 'box-pop', 'box-rays-out', 'box-beam-out', 'box-spark', 'box-sway', 'box-floor-breathe']) {
    const block = css.match(new RegExp(`@keyframes ${kf} \\{([\\s\\S]*?)\\n\\}`))?.[1]
    assert.ok(block, `keyframes ${kf} tồn tại`)
    assert.doesNotMatch(block, /(^|[^-])\b(width|height|top|left|margin|padding)\b\s*:/,
      `${kf} không được đụng thuộc tính gây reflow`)
  }
  // Khung reel: overflow hidden + chiều cao cố định + mép mờ — không CLS,
  // không item lòi (luật viewport của case reel).
  const reelCss = await read('./CaseOpeningReel.css')
  assert.match(reelCss, /\.reel-viewport \{[^}]*overflow:\s*hidden/)
  assert.match(reelCss, /\.reel-viewport \{[^}]*height:\s*160px/)
  assert.match(reelCss, /\.reel-viewport \{[^}]*mask-image:\s*linear-gradient/)
})

test('BẢNG GIẢI v3: tổng 100%, DUY NHẤT +5@4%, hai mức paid tách bạch — lib/SQL/demo khớp nhau', async () => {
  const { MYSTERY_PRIZES } = await import('../lib/mysteryBox.js')
  const strings = readFileSync(new URL('../lib/strings.js', import.meta.url), 'utf8')
  const sqlV2 = readFileSync(new URL('../../supabase/migrations/20261202_mystery_paid_v2.sql', import.meta.url), 'utf8')
  const sql = readFileSync(new URL('../../supabase/migrations/20261204_mystery_odds.sql', import.meta.url), 'utf8')

  // Tổng trọng số đúng 100% và đủ 7 outcome (0..6).
  assert.equal(MYSTERY_PRIZES.length, 7)
  assert.equal(MYSTERY_PRIZES.reduce((sum, p) => sum + p.weight, 0), 1000, 'tổng 100%')
  assert.deepEqual(MYSTERY_PRIZES.map(p => p.result), [0, 1, 2, 3, 4, 5, 6])

  // DUY NHẤT một outcome +5 votes, ở 4% — không còn +5 trùng.
  assert.equal(MYSTERY_PRIZES.filter(p => p.kind === 'votes' && p.votes === 5).length, 1)
  const five = MYSTERY_PRIZES.find(p => p.kind === 'votes' && p.votes === 5)
  assert.equal(five.result, 3)
  assert.equal(five.weight, 40)

  // Hai mức paid: cùng kind 'free_paid_request', KHÁC số lượng, khác trọng số.
  const paid1 = MYSTERY_PRIZES.find(p => p.result === 5)
  const paid2 = MYSTERY_PRIZES.find(p => p.result === 6)
  assert.equal(paid1.kind, 'free_paid_request')
  assert.equal(paid2.kind, 'free_paid_request')
  assert.equal(paid1.requests, 1); assert.equal(paid1.votes, 0); assert.equal(paid1.weight, 4)
  assert.equal(paid2.requests, 2); assert.equal(paid2.votes, 0); assert.equal(paid2.weight, 1)

  // SQL v3 khớp bảng lib: dải roll siết + bonus_requests theo amount.
  assert.match(sql, /v_roll < 700/)
  assert.match(sql, /v_result := 5; v_kind := 'free_paid_request'; v_ask := 0;\s+v_free := 1/)
  assert.match(sql, /v_result := 6; v_kind := 'free_paid_request'; v_ask := 0;\s+v_free := 2/)
  assert.match(sql, /set bonus_requests = bonus_requests \+ v_free/)
  assert.match(sqlV2, /'nothing', 'votes', 'paid_request', 'free_paid_request'/,
    'constraint nhận thêm kind mới, vẫn đọc được row cũ')
  assert.ok(!/v_result := 6; v_kind := 'votes'/.test(sql), 'không còn outcome votes+5 ở 1%')

  // Copy: nói rõ "free paid request", không "credits", không nhãn mơ hồ.
  assert.match(strings, /'mystery\.paidRequestOne': '\+1 free paid request'/)
  assert.match(strings, /'mystery\.paidRequestTwo': '\+2 free paid requests'/)
  const mysteryCopy = [...strings.matchAll(/'mystery\.[a-zA-Z]+': '([^']*)'/g)].map(m => m[1])
  assert.ok(mysteryCopy.length > 10, 'đọc được các nhãn mystery từ strings.js')
  for (const copy of mysteryCopy) {
    assert.doesNotMatch(copy, /[Cc]redits/, 'cấm chữ credits trong copy mystery')
    assert.doesNotMatch(copy, /^\+1 free request$/, 'nhãn mơ hồ cũ phải biến mất')
  }
})

test('the odds table and the route/nav wiring are exactly the approved shape', async () => {
  await withVite(async server => {
    const { default: MysteryBoxPage } = await server.ssrLoadModule('/src/components/MysteryBoxPage.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    // Odds render with data; stub the fetch layer by loading the module with a
    // resolved status via the same loader is not possible statically — assert
    // the label logic instead: hai mức paid đọc từ prize.requests (không gộp).
    const pageSrc = readFileSync(new URL('./MysteryBoxPage.jsx', import.meta.url), 'utf8')
    void MysteryBoxPage; void I18nProvider
    assert.match(pageSrc, /prize\.kind === 'free_paid_request'\s*\n?\s*&& t\(prize\.requests === 2 \? 'mystery\.paidRequestTwo' : 'mystery\.paidRequestOne'\)/)
    assert.doesNotMatch(pageSrc, /mystery\.paidRequest'/, 'nhãn paid cũ (1 mức) phải khỏi trang')
    // Bảng giải gọn: nút mở popup, không chiếm layout bằng aside.
    assert.match(pageSrc, /mystery-odds-btn/)
    assert.match(pageSrc, /mystery-history-btn/)
    assert.match(pageSrc, /role="dialog"/)
    assert.match(pageSrc, /useModalExit\(oddsOpen\)/)
    assert.match(pageSrc, /useModalExit\(historyOpen\)/)
    assert.match(pageSrc, /useFocusTrap\(oddsRef, oddsOpen\)/)
    assert.match(pageSrc, /useFocusTrap\(historyRef, historyOpen\)/)
    assert.doesNotMatch(pageSrc, /mystery-side/, 'aside odds không còn chiếm cột')
    assert.doesNotMatch(pageSrc, /mystery-layout/, 'lịch sử không chiếm cột layout')
    assert.doesNotMatch(pageSrc, /mystery-month-grid/, 'lịch sử là popup danh sách, không lưới lịch')
    assert.match(pageSrc, /mystery-history-dialog/)
    assert.match(pageSrc, /fetchMysteryMonth/)
    assert.match(pageSrc, /buildMysteryMonth/)
  })
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  assert.match(app, /mystery: '\/mystery-box'/)
  assert.match(app, /const SECTIONS = \['board', 'login', 'mystery', 'spin', 'ranking', 'mine'\]/)
  assert.match(app, /import\('\.\/components\/MysteryBoxPage'\)/)
  // The page NEVER embeds inside DailyLogin (owner decision, 2026-10).
  const login = readFileSync(new URL('./DailyLogin.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(login, /[Mm]ystery/)
  const sidebar = readFileSync(new URL('./Sidebar.jsx', import.meta.url), 'utf8')
  assert.match(sidebar, /mystery: 'gift'/)
})
