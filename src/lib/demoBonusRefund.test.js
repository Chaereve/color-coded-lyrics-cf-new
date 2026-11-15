/* Demo mirror của hoàn bonus request: một lượt / request id, chỉ trước sản xuất,
   không hoàn cho money/free, deny-then-delete không trả hai lần. */
import test from 'node:test'
import assert from 'node:assert/strict'

function mockStorage() {
  const store = new Map()
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: k => { store.removeItem(k) },
    },
  })
  return { store, restore: () => {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev)
    else delete globalThis.localStorage
  } }
}
const read = (store, k, d) => JSON.parse(store.get(k) || JSON.stringify(d))
async function demoDb() {
  const db = await import('./db.js')
  assert.equal(db.hasSupabase, false)
  return db
}
const bonusRow = (id, extra = {}) => ({
  id, user_id: 'demo-user', kind: 'Color Coded Lyrics', artist: 'A', title: id,
  requester: 'Demo', status: 'queued', progress: 0, votes: 0,
  is_paid: true, payment_status: 'paid', payment_source: 'bonus', picked_at: null,
  created_at: new Date().toISOString(), ...extra,
})

test('demo từ chối bonus hoàn 1 lượt, từ chối lại / xóa sau đó không hoàn thêm', async () => {
  const { store, restore } = mockStorage()
  try {
    store.set('ccl3_user', JSON.stringify({ id: 'demo-user', name: 'Demo' }))
    store.set('ccl3_prof', JSON.stringify({ vote_credits: 0, bonus_credits: 0, bonus_requests: 0, is_admin: true }))
    store.set('ccl3_rows', JSON.stringify([bonusRow('b1')]))
    const db = await demoDb()
    await db.adminReview('b1', false, 'duplicate')
    assert.equal(read(store, 'ccl3_prof', {}).bonus_requests, 1)
    await db.adminReview('b1', false, 'again')
    await db.adminReview('b1', true)
    await db.adminReview('b1', false, 'third')
    await db.deleteRequest('b1')
    assert.equal(read(store, 'ccl3_prof', {}).bonus_requests, 1)
    assert.equal(read(store, 'ccl3_bonus_refunds', []).length, 1)
    const box = read(store, 'ccl3_box:demo-user', [])
    assert.equal(box.filter(n => n.type === 'bonus_refunded').length, 1)
  } finally { restore() }
})

test('demo xóa / hết hạn bonus chưa chốt hoàn đúng một lần; đã chốt hoặc đang làm thì không', async () => {
  const { store, restore } = mockStorage()
  try {
    store.set('ccl3_user', JSON.stringify({ id: 'demo-user', name: 'Demo' }))
    store.set('ccl3_prof', JSON.stringify({ bonus_requests: 0, is_admin: true }))
    store.set('ccl3_rows', JSON.stringify([
      bonusRow('del'), bonusRow('exp'),
      bonusRow('picked', { picked_at: new Date().toISOString() }),
      bonusRow('started', { status: 'in_progress' }),
    ]))
    const db = await demoDb()
    await db.deleteRequest('del')
    await db.adminExpireRequest('exp')
    await db.adminDeleteMany(['picked', 'started'])
    assert.equal(read(store, 'ccl3_prof', {}).bonus_requests, 2)
    assert.deepEqual(read(store, 'ccl3_bonus_refunds', []).map(x => x.request_id).sort(), ['del', 'exp'])
  } finally { restore() }
})

test('demo hàng đã denied từ trước không hoàn khi bấm từ chối lại; xóa sau đó hoàn một lần', async () => {
  const { store, restore } = mockStorage()
  try {
    store.set('ccl3_user', JSON.stringify({ id: 'demo-user', name: 'Demo' }))
    store.set('ccl3_prof', JSON.stringify({ bonus_requests: 0, is_admin: true }))
    store.set('ccl3_rows', JSON.stringify([bonusRow('legacy-denied', { status: 'denied' })]))
    const db = await demoDb()
    await db.adminReview('legacy-denied', false, 'again')
    assert.equal(read(store, 'ccl3_prof', {}).bonus_requests, 0)
    assert.deepEqual(read(store, 'ccl3_bonus_refunds', []), [])
    await db.deleteRequest('legacy-denied')
    assert.equal(read(store, 'ccl3_prof', {}).bonus_requests, 1)
    assert.deepEqual(read(store, 'ccl3_bonus_refunds', []).map(x => x.reason), ['deleted'])
  } finally { restore() }
})

test('demo money/free không được hoàn bonus_requests', async () => {
  const { store, restore } = mockStorage()
  try {
    store.set('ccl3_user', JSON.stringify({ id: 'demo-user', name: 'Demo' }))
    store.set('ccl3_prof', JSON.stringify({ bonus_requests: 0, is_admin: true }))
    store.set('ccl3_rows', JSON.stringify([
      bonusRow('money', { payment_source: 'money' }),
      bonusRow('free', { is_paid: false, payment_status: 'none', payment_source: null }),
    ]))
    const db = await demoDb()
    await db.adminReview('money', false)
    await db.deleteRequest('free')
    assert.equal(read(store, 'ccl3_prof', {}).bonus_requests, 0)
    assert.deepEqual(read(store, 'ccl3_bonus_refunds', []), [])
  } finally { restore() }
})
