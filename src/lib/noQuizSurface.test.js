/* Chốt bề mặt "Daily Quiz đã nghỉ hưu" — bài kiểm này là thứ giữ cho việc gỡ
   quiz không quay lại.
   -----------------------------------------------------------------------------
   Bốn lớp được khoá cùng lúc:
     1. mã nguồn giao diện: không tệp nào dưới `src/` còn nhắc tới đường dẫn cũ,
        ngoại trừ ĐÚNG một dòng khai báo chuyển hướng trong App.jsx (đã bóc
        comment trước khi đếm, nên comment không thể là chỗ trốn);
     2. từ điển i18n: chỉ còn đúng sáu mã lỗi `err.dailyQuiz*` mà SQL còn raise
        (bắt buộc giữ bản dịch theo i18nKeys.test.js) — chúng là chuỗi chết,
        không màn nào gọi, và biến mất ở giai đoạn dọn DB;
     3. bề mặt tĩnh: index.html, sitemap.xml, manifest.webmanifest sạch tuyệt đối;
        `_redirects` chỉ có đúng một rule 301 cho đường dẫn cũ, và nó phải đứng
        trước SPA fallback;
     4. mã nguồn đã xoá: không còn controller/component/lib quiz, không ai import
        chúng, và bài test DB của quiz đã nằm trong quarantine.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = rel => fileURLToPath(new URL(rel, import.meta.url))
const repo = at('../..')
const walk = dir => {
  let out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
      out = out.concat(walk(join(dir, entry.name)))
    } else out.push(join(dir, entry.name))
  }
  return out
}
const read = rel => readFileSync(join(repo, rel), 'utf8')

/* Từ điển là nơi duy nhất còn được phép mang chữ quiz trong mã nguồn, và chỉ
   cho sáu mã lỗi SQL cũ. Danh sách này đóng băng: thêm một key nữa là đỏ. */
const LEGACY_ERROR_CODES = [
  'err.dailyQuizSession', 'err.dailyQuizAnswers', 'err.dailyQuizUnavailable',
  'err.dailyQuizRetired', 'err.dailyQuizQuestion', 'err.dailyQuizOption',
]

test('không tệp giao diện nào còn nhắc tới màn quiz, ngoài đúng một dòng chuyển hướng', () => {
  const src = walk(at('..')).filter(f => ['.js', '.jsx'].includes(extname(f)))
  const stripped = f => readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // comment khối
    .replace(/\/\/[^\n]*/g, ' ')          // comment dòng
  const offenders = []
  for (const file of src) {
    const rel = file.replace(repo, '').replace(/\\/g, '/')
    if (rel.endsWith('/i18n.jsx') || rel.endsWith('/strings.js') || /\.test\.js$/.test(file)) continue
    const code = stripped(file)
    const hits = code.match(/quiz/i) || []
    if (!hits.length) continue
    if (!/(^|\/)src\/App\.jsx$/.test(rel)) { offenders.push(`${rel} (${hits.length}×)`); continue }
    /* App.jsx: sau khi bóc comment chỉ còn đúng bảng chuyển hướng được phép
       nhắc đường dẫn cũ — và nó không được dựng JSX/route nào. */
    assert.equal(hits.length, 1, `App.jsx chỉ được nhắc đường dẫn cũ ở bảng chuyển hướng, thấy ${hits.length} lần`)
    assert.match(code, /const RETIRED_PATHS = \{ '\/quiz': '\/daily-login' \}/)
    assert.doesNotMatch(code, /<DailyRewards|needQuiz|quiz:/, 'không dựng lại màn/mục quiz trong App')
  }
  assert.deepEqual(offenders, [], `còn mã nhắc tới quiz: ${offenders.join(', ')}`)
})

test('từ điển chỉ giữ sáu mã lỗi cũ của SQL, không còn câu chữ quiz nào khác', () => {
  const dict = read('src/lib/strings.js').split('\n')
  const quizLines = dict.filter(line => /quiz|question|answer/i.test(line))
  const keys = quizLines.map(line => line.match(/^\s*'([A-Za-z0-9_.]+)'\s*:/)?.[1]).filter(Boolean)
  assert.deepEqual([...keys].sort(), [...LEGACY_ERROR_CODES].sort(),
    'các dòng còn chữ quiz/question/answer phải đúng bằng sáu mã lỗi SQL cũ')
  /* Sáu mã này phải còn THẬT: SQL vẫn raise chúng (20261113…20261117 vẫn nằm
     trong migrations cho tới giai đoạn dọn DB) và i18nKeys.test.js bắt buộc có
     bản dịch. Khi dọn DB xong, cả sáu biến mất cùng lúc với các hàm quiz. */
  const sqlDirs = ['supabase/migrations']
  const sqlText = sqlDirs.flatMap(dir => walk(join(repo, dir)))
    .filter(f => extname(f) === '.sql').map(f => readFileSync(f, 'utf8')).join('\n')
  for (const code of LEGACY_ERROR_CODES) {
    assert.ok(sqlText.includes(`'${code}'`), `${code} không còn được SQL raise — tới lúc gỡ bản dịch`)
  }
})

test('bề mặt tĩnh không còn đường dẫn quiz: html, sitemap, manifest', () => {
  for (const rel of ['index.html', 'public/sitemap.xml', 'public/manifest.webmanifest']) {
    assert.doesNotMatch(read(rel), /quiz/i, `${rel} còn nhắc quiz`)
  }
  /* `_redirects` là chỗ DUY NHẤT được nhắc đường dẫn cũ, và nhắc để chuyển
     hướng: đúng một rule, 301, đứng trước SPA fallback (dòng cuối). */
  const rules = read('public/_redirects').split('\n')
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  assert.deepEqual(rules, ['/quiz    /daily-login   301', '/*    /index.html   200'])
})

test('controller/component/lib quiz đã bị xoá và không ai import lại', () => {
  for (const gone of [
    'src/components/DailyRewards.jsx', 'src/components/DailyRewards.test.js',
    'src/components/DailyRewards.css',
    'src/lib/dailyRewards.js', 'src/lib/dailyRewards.test.js', 'src/lib/dailyRewardsDemo.js',
  ]) {
    assert.equal(existsSync(join(repo, gone)), false, `${gone} phải đã bị xoá`)
  }
  const code = walk(at('..')).filter(f => ['.js', '.jsx'].includes(extname(f)))
    .filter(f => !/\.test\.js$/.test(f))
    .map(f => `${f.replace(repo, '')}\n${readFileSync(f, 'utf8')}`)
  for (const name of ['DailyRewards', 'dailyRewards', 'dailyRewardsDemo']) {
    assert.ok(!code.some(entry => entry.includes(name)), `còn import ${name}`)
  }
})

test('bài test DB của quiz đã vào quarantine và không nằm trong đường chạy mặc định', () => {
  const quarantined = 'supabase/tests/quarantine/dailyQuiz.test.js.quarantined'
  assert.equal(existsSync(join(repo, quarantined)), true, 'bài test quiz phải được giữ nguyên văn trong quarantine')
  assert.ok(read(quarantined).length > 1000, 'quarantine phải giữ nguyên nội dung, không phải file rỗng')
  const pkg = JSON.parse(read('package.json'))
  assert.ok(!JSON.stringify(pkg.scripts).includes('dailyQuiz.test.js'),
    'không script nào được trỏ lại bài test quiz đã quarantine')
  assert.equal(pkg.scripts['test:quiz-off:db'], 'node --test supabase/tests/quizRuntimeDisabled.test.js')
  /* `npm test` quét mọi tệp `*.test.js` dưới `supabase/tests`; đuôi
     `.quarantined` không khớp mẫu đó, nên bài quiz không tự chạy lại. */
  const glob = JSON.parse(read('package.json')).scripts.test
  assert.ok(!glob.includes('quarantine'), 'đường chạy mặc định không được trỏ vào quarantine')
  assert.ok(!/\.quarantined$/.test('supabase/tests/dailyQuiz.test.js'))
})
