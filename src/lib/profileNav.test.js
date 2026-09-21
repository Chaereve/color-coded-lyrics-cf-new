/* Chốt chặn "ĐI LẠI TRONG APP" — trang cá nhân công khai và mọi link nội bộ.
   ---------------------------------------------------------
   Bốn lỗi người dùng báo trong hai ngày (bấm tên người gửi thì "quay về trang
   chủ", Back to board không ăn, bấm Recent Request không tìm ra bài, và
   `POP OFF LE SSERAFIM` không có kết quả) hoá ra là BỐN mặt của cùng một cách
   làm: mỗi link nội bộ tự ghép địa chỉ bằng tay rồi tự gọi `pushState`.

     · `pushState` ném SecurityError trong iframe bị sandbox / `file://` / chế độ
       riêng tư — mà `preventDefault()` đã chạy trước đó, nên cú bấm KHÔNG LÀM GÌ
       CẢ. Repo có `lib/history.js` sinh ra để chặn đúng lỗi này; ba chỗ kia
       không đi qua cửa đó.
     · "trang cá nhân đang mở" bị đọc từ `window.location` LÚC RENDER: địa chỉ
       không ghi được thì màn hình không đổi, và React cũng không render lại
       nếu mọi setState trong handler đều trùng giá trị.
     · từ khoá dựng "tên bài + nghệ sĩ" trong khi chuỗi để dò là "nghệ sĩ + tên
       bài + …", so bằng MỘT phép `includes` cả cụm → không bao giờ gặp nhau
       (phần này do board.test.js giữ).
     · câu truy vấn trang cá nhân chỉ chọn `status, votes` nên `recent` không có
       `title`/`artist` — demo thì đủ cột nên không lộ, chỉ hỏng trên bản deploy.

   Bài kiểm này giữ cả bốn vế: ba vế sau bằng hợp đồng trên mã nguồn (đổi lại
   là đỏ ngay), vế `spaLink` bằng cách chạy thật với sự kiện giả.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'
import { absolute, boardSearchUrl, profileUrl, songQuery } from './history.js'
import { spaLink } from './nav.js'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const files = walk(at('..')).filter((f) => ['.js', '.jsx'].includes(extname(f)) && !f.endsWith('.test.js'))
assert.ok(files.length >= 30, `phải thấy mã nguồn của app (thấy ${files.length} file)`)
const rel = (f) => f.split(/[\\/]/).slice(-2).join('/')

/* Quét MÃ, không quét chữ trong chú thích — và giữ nguyên số dòng để thông báo
   lỗi còn trỏ đúng chỗ. Chú thích "đừng tự gọi pushState" mà chính nó chứa
   chuỗi đó là chuyện bình thường; scan thô sẽ báo đỏ oan (đúng cái bẫy mà
   jsxHtml.test.js gặp với chữ `<a>` viết trong chú thích). */
const blank = (m) => m.replace(/[^\n]/g, ' ')
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, head) => head)

const src = Object.fromEntries(files.map((f) => [rel(f), stripComments(readFileSync(f, 'utf8'))]))
const app = src['src/App.jsx']
const historySrc = src['lib/history.js']
assert.ok(app && historySrc, 'phải đọc được App.jsx và lib/history.js')

/* =========================================================
   1. DỰNG ĐỊA CHỈ — một cửa, và cửa đó phải đúng
   ========================================================= */
test('profileUrl: dạng tham số, không phải /u/ — host tĩnh chỉ phục vụ index.html cho đúng "/"', () => {
  assert.equal(profileUrl('abc-123'), '/?profile=abc-123')
  assert.equal(profileUrl('a b&c'), '/?profile=a%20b%26c', 'id phải được encode')
  /* Đọc lại được bằng chính URLSearchParams — link dán ra ngoài phải mở đúng chỗ. */
  assert.equal(new URLSearchParams(profileUrl('abc-123').slice(2)).get('profile'), 'abc-123')
  assert.equal(profileUrl(null), '/?profile=')
})

test('boardSearchUrl: LUÔN kèm f=newest, và từ khoá là "tên bài nghệ sĩ"', () => {
  assert.equal(boardSearchUrl('Pop Off', 'LE SSERAFIM'), '/?f=newest&q=Pop+Off+LE+SSERAFIM')
  const p = new URLSearchParams(boardSearchUrl('Get Up', 'NewJeans').slice(2))
  assert.equal(p.get('f'), 'newest',
    'f phải là `newest`: `top` loại bài đã xong/đã vào dây chuyền nên link mở ra trang trống')
  assert.equal(p.get('q'), 'Get Up NewJeans')
  assert.equal(boardSearchUrl(null, undefined), '/?f=newest', 'không có tên thì không đẻ ra `q=` rỗng')
  assert.equal(songQuery('  Pop   Off ', ' LE SSERAFIM'), 'Pop Off LE SSERAFIM')
})

test('absolute: link chia sẻ phải là URL tuyệt đối', () => {
  globalThis.window = { location: { origin: 'https://chaereve.pages.dev' } }
  assert.equal(absolute(boardSearchUrl('Get Up', 'NewJeans')),
    'https://chaereve.pages.dev/?f=newest&q=Get+Up+NewJeans')
  assert.equal(absolute(profileUrl('u1')), 'https://chaereve.pages.dev/?profile=u1')
  /* Không ghép được thì trả về nguyên trạng chứ không ném — đây là hàm chạy
     trong handler bấm, ném là mất cả cú bấm. */
  globalThis.window = { location: {} }
  assert.equal(absolute('/?profile=u1'), '/?profile=u1')
  delete globalThis.window
})

/* =========================================================
   2. spaLink — chạy thật với sự kiện giả
   ========================================================= */
const event = (over = {}) => {
  const e = {
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, prevented: false, stopped: false,
    preventDefault() { e.prevented = true }, stopPropagation() { e.stopped = true },
    ...over,
  }
  return e
}

test('spaLink: bấm thường thì đi trong app, và chặn cả mặc định lẫn nổi bọt', () => {
  const seen = []
  const handler = spaLink((id) => seen.push(id), 'u1')
  assert.equal(typeof handler, 'function')
  const e = event()
  handler(e)
  assert.deepEqual(seen, ['u1'], 'hàm nav phải được gọi với đúng tham số')
  assert.equal(e.prevented, true, 'không chặn mặc định thì trình duyệt tải lại trang → chạy lại màn chờ')
  assert.equal(e.stopped, true, 'link người gửi nằm trong hàng bấm-để-mở-cụm: không chặn nổi là làm hai việc một lúc')
})

test('spaLink: mở tab mới là ý người dùng, không được cướp', () => {
  for (const over of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
    let called = 0
    const e = event(over)
    spaLink(() => { called++ }, 'x')(e)
    assert.equal(called, 0, `phải nhả link cho trình duyệt với ${JSON.stringify(over)}`)
    assert.equal(e.prevented, false)
  }
})

test('spaLink: KHÔNG có đường đi trong app thì không gắn handler — href thật là đường lùi', () => {
  /* Đây là vế giữ cho component dựng NGOÀI App (một bài kiểm dựng rời, một khối
     đem dùng ở trang khác) không chết link: thẻ còn `href` nên trình duyệt đi
     thật, chậm hơn một nhịp nhưng vẫn tới nơi. */
  assert.equal(spaLink(null, 'x'), undefined)
  assert.equal(spaLink(undefined, 'x'), undefined)
  /* Sự kiện đã bị chặn trước đó (một handler khác xử lý rồi) thì không xen vào. */
  let called = 0
  spaLink(() => { called++ }, 'x')(event({ defaultPrevented: true }))
  assert.equal(called, 0)
})

/* =========================================================
   3. HỢP ĐỒNG TRÊN MÃ NGUỒN — không ai được quay lại cách cũ
   ========================================================= */
test('không component nào tự gọi pushState / tự phát popstate', () => {
  for (const [name, text] of Object.entries(src)) {
    if (name === 'lib/history.js') continue      // đó chính là cái cửa
    assert.doesNotMatch(text, /window\.history\.(pushState|replaceState)/,
      `${name} tự ghi địa chỉ — phải qua pushUrl/putUrl của lib/history.js (pushState ném trong iframe sandbox)`)
    assert.doesNotMatch(text, /PopStateEvent/,
      `${name} tự phát popstate — đổi state trước, địa chỉ ghi sau (xem lib/nav.js)`)
  }
  /* history.js cũng không gọi thẳng: nó đi qua `window.history[fn]` có try/catch. */
  assert.doesNotMatch(historySrc, /window\.history\.(pushState|replaceState)\(/,
    'lib/history.js phải gọi trong try/catch, không gọi thẳng')
  assert.match(historySrc, /catch \{/, 'lib/history.js phải nuốt lỗi ghi địa chỉ')
})

test('không chỗ nào tự ghép chuỗi địa chỉ nội bộ bằng tay', () => {
  for (const [name, text] of Object.entries(src)) {
    if (name === 'lib/history.js') continue
    assert.doesNotMatch(text, /\?profile=/, `${name} tự ghép link trang cá nhân — dùng profileUrl()`)
    assert.doesNotMatch(text, /\?f=(top|newest|queued)&q=/, `${name} tự ghép link vào bảng — dùng boardSearchUrl()`)
    assert.doesNotMatch(text, /\/u\/\$\{/, `${name} tự ghép link /u/ — dạng đó host tĩnh không phục vụ`)
  }
})

test('mọi link nội bộ đều là THẺ THẬT (có href) và đi trong app (spaLink)', () => {
  /* Năm lớp link nội bộ. Thiếu `spaLink` thì bấm là tải lại trang (mất vị trí
     cuộn + chạy lại màn chờ 560ms); thiếu `href` thì middle-click / "mở trong
     tab mới" / trình đọc màn hình mất đường đi. */
  const INTERNAL = ['requester-link', 'comment-author', 'public-request-link', 'weekly-card', 'profile-back']
  let found = 0
  for (const [name, text] of Object.entries(src)) {
    for (const line of text.split('\n')) {
      const cls = INTERNAL.find(c => line.includes(`className="${c}`))
      if (!cls) continue
      found++
      /* href có thể là biểu thức (dựng bằng hàm) hoặc "/" cho nút Back; điều
         phải giữ là CÓ href — và không ai tự ghép chuỗi truy vấn (test trên). */
      assert.match(line, /href=/, `${name}: .${cls} phải là thẻ link thật (có href)`)
      assert.match(line, /spaLink\(/, `${name}: .${cls} phải đi trong app bằng spaLink`)
    }
  }
  assert.ok(found >= INTERNAL.length, `phải quét đủ ${INTERNAL.length} loại link nội bộ, chỉ thấy ${found}`)
  /* `spaLink` chỉ có MỘT định nghĩa. */
  const defs = Object.entries(src).filter(([, t]) => /export (function|const) spaLink/.test(t)).map(([n]) => n)
  assert.deepEqual(defs, ['lib/nav.js'])
})

test('trang cá nhân đang mở là STATE, không phải thứ đọc từ địa chỉ lúc render', () => {
  assert.match(app, /const \[profileId, setProfileId\] = useState\(readProfileId\)/,
    'phải khởi tạo từ readProfileId và giữ trong state')
  /* Đúng MỘT chỗ đọc tham số `profile` từ địa chỉ: trong readProfileId. */
  const reads = (app.match(/\.get\('profile'\)/g) || []).length
  assert.equal(reads, 1, 'chỉ readProfileId được đọc tham số profile từ window.location')
  assert.match(app, /setProfileId\(readProfileId\(\)\)/,
    'nút Back/Forward của trình duyệt cũng phải đọc lại trang cá nhân đang mở')
  /* Mở/đóng đi qua hàm, và hàm đó đổi state TRƯỚC khi ghi địa chỉ. */
  for (const fn of ['openProfile', 'closeProfile', 'openSong']) {
    const body = app.match(new RegExp(`const ${fn} = useCallback\\(([\\s\\S]*?)\\n  \\}, \\[`))?.[1]
    assert.ok(body, `không tìm thấy ${fn} trong App.jsx`)
    assert.match(body, /setProfileId\(/, `${fn} phải đổi state`)
    const setStateAt = body.indexOf('setProfileId(')
    const pushAt = body.indexOf('pushUrl(')
    assert.ok(pushAt < 0 || setStateAt < pushAt,
      `${fn}: state phải đổi TRƯỚC khi ghi địa chỉ — ngược lại là iframe sandbox mất chức năng`)
  }
})

test('mở một bài từ trang cá nhân phải dọn CẢ HAI bộ lọc nhiều-chọn', () => {
  const body = app.match(/const openSong = useCallback\(([\s\S]*?)\n  \}, \[/)?.[1]
  assert.ok(body, 'không tìm thấy openSong')
  assert.match(body, /setStatusFilters\(\[\]\)/, 'không dọn chip giai đoạn thì bài đã xong vẫn bị giấu')
  assert.match(body, /setKindFilters\(\[\]\)/, 'không dọn chip loại bài thì bài khác loại vẫn bị giấu')
  assert.match(body, /setKindFilter\('all'\)/, 'bản sao một-lựa-chọn (dùng cho ?k=) cũng phải về all')
  assert.match(body, /setFilter\('newest'\)/, 'phải về cách nhìn thấy MỌI bài')
  assert.match(body, /if \(!query\) return/, 'hàng thiếu tên bài thì đừng đẩy người ta vào danh sách rỗng')
  assert.match(body, /boardSearchUrl\(/, 'địa chỉ phải dựng bằng hàm dùng chung')
})

test('mở một bài thì cuộn XUỐNG kết quả, mở trang cá nhân thì cuộn lên đầu', () => {
  /* Trên bảng yêu cầu, danh sách nằm SAU bốn ô thống kê, video của kênh, This
     week, Hall of Fame và Up next — tức là cách đầu trang cả một màn hình. Bấm
     một bài ở trang cá nhân mà trang cuộn LÊN ĐẦU là đưa người bấm tới chỗ chưa
     có kết quả nào: họ phải tự kéo xuống và tự hỏi cú bấm có ăn không. */
  const song = app.match(/const openSong = useCallback\(([\s\S]*?)\n  \}, \[/)?.[1]
  assert.match(song, /scrollToList\(\)/, 'openSong phải cuộn xuống thanh lọc/danh sách')
  assert.doesNotMatch(song, /toTop\(\)/, 'openSong không được cuộn lên đầu trang')
  /* Còn mở/đóng trang cá nhân là đổi CẢ trang đang xem → đầu trang là đúng. */
  for (const fn of ['openProfile', 'closeProfile']) {
    const body = app.match(new RegExp(`const ${fn} = useCallback\\(([\\s\\S]*?)\\n  \\}, \\[`))?.[1]
    assert.match(body, /toTop\(\)/, `${fn} phải đưa người xem về đầu trang`)
  }
  /* Đích cuộn phải hỏi DOM chứ không giữ ref: hàm này được truyền xuống cây và
     gọi ngay lúc render để dựng handler, đọc `ref.current` ở đó là `react(refs)`. */
  const scroll = app.match(/const scrollToList = useCallback\(([\s\S]*?)\n  \}, \[\]\)/)?.[1]
  assert.ok(scroll, 'không tìm thấy scrollToList')
  assert.match(scroll, /document\.querySelector\('\.board \.fbar'\)/,
    'cuộn tới thanh lọc của BẢNG (mục "Của tôi" cũng có một .list riêng)')
  assert.doesNotMatch(scroll, /Ref\.current/, 'scrollToList không được đọc ref')
})

test('màn chờ không thể bật lại giữa phiên — đi trong app không bao giờ thấy splash', () => {
  assert.match(app, /const \[booting, setBooting\] = useState\(true\)/)
  assert.doesNotMatch(app, /setBooting\(true\)/,
    'màn chờ chỉ được TẮT đi: bật lại giữa phiên là mỗi lần bấm link nội bộ người dùng chờ thêm 560ms')
  assert.match(app, /if \(booting\) return <Splash \/>/)
})

test('trang cá nhân công khai: câu truy vấn phải chọn ĐỦ cột để dựng link', () => {
  const db = src['lib/db.js']
  const select = db.match(/\.select\('id, title, artist[^']*'\)/)?.[0]
  assert.ok(select, 'fetchPublicProfile phải chọn id/title/artist cho recent — bản cũ chỉ chọn status, votes')
  for (const col of ['id', 'title', 'artist', 'kind', 'status', 'created_at']) {
    assert.ok(select.includes(col), `thiếu cột ${col}: thiếu một cột là link hoặc nhãn trên trang cá nhân rỗng`)
  }
  assert.match(db, /\.order\('created_at', \{ ascending: false \}\)/, '"gần đây" phải là mới nhất trước')
  /* Không công bố bài chưa duyệt / bị từ chối trên trang cá nhân. */
  assert.match(db, /status !== 'pending' && r\.status !== 'denied'/,
    'phải lọc cả pending lẫn denied — RLS cho đọc cả bảng requests')
  assert.match(db, /export const PUBLIC_RECENT = \d+/, 'giới hạn số bài "gần đây" phải là hằng số dùng chung')
})

test('PublicProfile không dựng link từ hàng thiếu tên, và nhãn trạng thái đi qua statusLabel', () => {
  const pp = src['components/PublicProfile.jsx']
  assert.match(pp, /filter\(r => r && \(r\.title \|\| r\.artist\)\)/,
    'hàng không đọc ra tên thì không được dựng link — link rỗng dẫn tới danh sách rỗng')
  assert.match(pp, /PUBLIC_RECENT/, 'giới hạn phải lấy từ lib/db.js, không viết lại con số 8 ở đây')
  assert.match(pp, /statusLabel\(r, t\)/, 'nhãn trạng thái phải đúng chữ mà hàng trên bảng dùng')
  assert.match(pp, /role="status"/, 'trạng thái đang tải / không tìm thấy phải cho trình đọc màn hình biết')
  /* "Votes received", không phải "Votes given": RLS của `votes` là read-own nên
     số phiếu người đó đi bỏ KHÔNG đọc được ở đây — nhãn sai là nói dối. */
  assert.match(pp, /Votes received/, 'nhãn phải đúng nghĩa con số (tổng phiếu các bài của họ nhận được)')
  assert.doesNotMatch(pp, /Votes given/)
})
