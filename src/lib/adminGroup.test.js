/* Kiem thu adminUpdateMany — cai dang sau 3 o tick Layout / Lyrics / Edit trong
   khung Sua cua Admin. Ly do: mot bai hay co vai request trung nhau (moi nguoi
   gui mot cai), neu chi dong duoc tick doi tien do thi nhung dong kia nam 0% mai.
   Chay: npm test (khong mo trinh duyet, khong noi Supabase — demo mode). */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
const KEY = 'ccl3_rows'
let server, store

/* demo mode doc/ghi localStorage nhu trinh duyet, nen phai co cai mo phong
   TRUOC khi nap module; ghi duoi dang JSON giong het `wr()` trong src/lib/db.js */
function fakeStorage(seed) {
  store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  })
}
const readRows = () => JSON.parse(store.get(KEY))

async function load() {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-admingroup-test',
    /* .env cua nguoi lap trinh khong duoc bien test nay thanh client that */
    envPrefix: 'CCL_ADMINGROUP_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const db = await server.ssrLoadModule('/src/lib/db.js')
  const board = await server.ssrLoadModule('/src/lib/board.js')
  assert.ok(db.hasSupabase === false, 'test phai chay o che do demo')
  return { ...db, ...board }
}

after(async () => { await server?.close() })

const SEED = [
  { id: 'a', artist: 'Aespa', title: 'Whiplash', status: 'queued', votes: 3, progress: 0 },
  { id: 'b', artist: '  aespa ', title: 'WHIPLASH', status: 'in_progress', votes: 2, progress: 0 },
  { id: 'c', artist: 'aespa', title: 'whiplash', status: 'completed', votes: 1, progress: 100, done_layout: true, done_lyrics: true, done_edit: true },
  { id: 'd', artist: 'Itzy', title: 'Whiplash', status: 'queued', votes: 5, progress: 0 },
]

test('tic 1 trong 3 moc: ca cum cung bai cung chay theo', async () => {
  fakeStorage({ [KEY]: SEED })
  const { adminUpdateMany, groupIds } = await load()
  const rows = readRows()
  const touched = await adminUpdateMany(groupIds(rows, rows[0]), { done_layout: true, status: 'in_progress' })
  assert.equal(touched, 2, 'chi a (dang tick) va b (cung bai, dang cho)')

  const after = Object.fromEntries(readRows().map(r => [r.id, r]))
  assert.equal(after.a.progress, 40)
  assert.equal(after.b.progress, 40)
  assert.equal(after.b.status, 'in_progress')
  assert.equal(after.c.progress, 100, 'ban da xong bi bo qua, khong bi keo ve 40%')
  assert.equal(after.d.progress, 0, 'bai khac cung ten phai yen')
})

test('bo tick cung chay deu: bo moc o mot dong thi ca cum mat moc do', async () => {
  fakeStorage({ [KEY]: SEED.map(r => ({ ...r, done_layout: true, progress: r.status === 'completed' ? 100 : 40 })) })
  const { adminUpdateMany, groupIds } = await load()
  const rows = readRows()
  await adminUpdateMany(groupIds(rows, rows[1]), { done_layout: false, status: 'in_progress' })
  const after = Object.fromEntries(readRows().map(r => [r.id, r]))
  assert.equal(after.a.done_layout, false)
  assert.equal(after.b.done_layout, false)
  assert.equal(after.c.done_layout, true, 'dong da xong giu nguyen 3 moc')
  assert.equal(after.a.progress, 0)
})

test('gan link + hoan thanh: dong da xong cung lay duoc link, ban bi tu choi thi khong', async () => {
  fakeStorage({ [KEY]: [
    { id: 'a', artist: 'Aespa', title: 'Whiplash', status: 'queued', progress: 0 },
    { id: 'b', artist: 'aespa', title: 'whiplash', status: 'in_progress', progress: 40 },
    { id: 'c', artist: 'AESPA', title: ' WHIPLASH ', status: 'completed', progress: 100, video_url: 'https://old' },
    { id: 'd', artist: 'aespa', title: 'whiplash', status: 'denied', progress: 0 },
    { id: 'e', artist: 'Itzy', title: 'Whiplash', status: 'queued', progress: 0 },
  ] })
  const { adminUpdateMany, groupIds } = await load()
  const rows = readRows()
  const ids = groupIds(rows, rows[0], ['queued', 'in_progress', 'completed'])
  assert.deepEqual(ids, ['a', 'b', 'c'], 'loai dong denied va bai khac')
  const patch = { video_url: 'https://youtu.be/new', status: 'completed' }
  assert.equal(await adminUpdateMany(ids, patch), 3)
  const after = Object.fromEntries(readRows().map(r => [r.id, r]))
  for (const id of ['a', 'b', 'c']) {
    assert.equal(after[id].video_url, 'https://youtu.be/new', `${id} phai co link`)
    assert.equal(after[id].status, 'completed')
    assert.equal(after[id].progress, 100)
  }
  assert.equal(after.d.status, 'denied', 'ban bi tu choi giu nguyen')
  assert.equal(after.e.progress, 0)
})

test('danh sach rong khong ghi deo gi', async () => {
  fakeStorage({ [KEY]: SEED })
  const { adminUpdateMany } = await load()
  assert.equal(await adminUpdateMany([], { progress: 99 }), 0)
  assert.deepEqual(readRows(), SEED)
})

test('adminUpdate giu nguyen han vi cu cho mot dong (progress tu 3 moc)', async () => {
  fakeStorage({ [KEY]: SEED })
  const { adminUpdate } = await load()
  await adminUpdate('d', { done_lyrics: true, done_edit: true })
  const d = readRows().find(r => r.id === 'd')
  assert.equal(d.progress, 60)
  assert.equal(readRows().find(r => r.id === 'a').progress, 0, 'khong lien quan sang cum khac')
})
