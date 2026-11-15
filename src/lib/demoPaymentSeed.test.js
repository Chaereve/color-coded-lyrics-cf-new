/* Seed demo phải xem được cả PAID lẫn BONUS sau khi badge nguồn tài trợ chốt.
   ---------------------------------------------------------
   Lỗi cũ: Pop Off có payment_status='paid' nhưng thiếu payment_source nên rơi
   về PAYMENT UNVERIFIED ngay trong sandbox. Test này khóa hai việc:
     1. seed mới có nguồn tường minh (money / bonus);
     2. localStorage đã lưu seed cũ chỉ được nâng đúng hai hàng mẫu nhận diện
        được, không đoán nguồn cho request người dùng tự tạo.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { requestPaymentState } from './requestPayment.js'

function mockStorage() {
  const store = new Map()
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: k => { store.delete(k) },
    },
  })
  return {
    store,
    restore: () => {
      if (prev) Object.defineProperty(globalThis, 'localStorage', prev)
      else delete globalThis.localStorage
    },
  }
}

async function demoDb() {
  const db = await import('./db.js')
  assert.equal(db.hasSupabase, false, 'test này chỉ chạy ở demo mode, không gọi Supabase')
  return db
}

test('seed demo mới có PAID tiền và BONUS thưởng, không còn unverified giả', async () => {
  const { restore } = mockStorage()
  try {
    const db = await demoDb()
    const rows = await db.fetchRequests()
    const pop = rows.find(r => r.id === 'seed-2')
    const moon = rows.find(r => r.id === 'seed-1')
    assert.equal(pop.payment_source, 'money')
    assert.equal(requestPaymentState(pop), 'paid')
    assert.equal(moon.payment_source, 'bonus')
    assert.equal(requestPaymentState(moon), 'bonus')
    assert.equal(rows.some(r => requestPaymentState(r) === 'unverified'), false)
  } finally { restore() }
})

test('seed cũ trong localStorage được nâng đúng hàng mẫu, request người dùng giữ nguyên', async () => {
  const { store, restore } = mockStorage()
  try {
    const oldRows = [
      { id: 'seed-1', artist: 'TWICE', title: 'Moonlight Sunrise', is_paid: false, payment_status: 'none', votes: 12 },
      { id: 'seed-2', artist: 'LE SSERAFIM', title: 'Pop Off', is_paid: true, payment_status: 'paid', votes: 14 },
      { id: 'mine-1', artist: 'XG', title: 'Left Right', is_paid: true, payment_status: 'paid', votes: 1 },
    ]
    store.set('ccl3_rows', JSON.stringify(oldRows))
    const db = await demoDb()
    const rows = await db.fetchRequests()
    assert.equal(requestPaymentState(rows.find(r => r.id === 'seed-1')), 'bonus')
    assert.equal(requestPaymentState(rows.find(r => r.id === 'seed-2')), 'paid')
    const mine = rows.find(r => r.id === 'mine-1')
    assert.equal(mine.payment_source, undefined)
    assert.equal(requestPaymentState(mine), 'unverified', 'không đoán nguồn cho request người dùng tự tạo')
    assert.deepEqual(JSON.parse(store.get('ccl3_rows')), rows, 'bản nâng được lưu lại một lần')
    assert.deepEqual(await db.fetchRequests(), rows, 'gọi lại không đổi tiếp')
  } finally { restore() }
})

test('nguồn đã tường minh không bị ghi đè và seed đã xóa không sống lại', async () => {
  const { store, restore } = mockStorage()
  try {
    store.set('ccl3_rows', JSON.stringify([
      { id: 'seed-2', artist: 'LE SSERAFIM', title: 'Pop Off', is_paid: true, payment_status: 'paid', payment_source: 'bonus' },
    ]))
    const db = await demoDb()
    assert.equal((await db.fetchRequests())[0].payment_source, 'bonus')
    store.set('ccl3_rows', '[]')
    assert.deepEqual(await db.fetchRequests(), [], 'không nhét lại seed người dùng đã xóa')
  } finally { restore() }
})
