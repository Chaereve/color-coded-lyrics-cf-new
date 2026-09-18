import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SPIN_DEVICE_KEY, SPIN_DEVICE_COOKIE, readSpinDevice, saveSpinDevice, getSpinDevice,
  getPendingSpin, readPendingSpin, clearPendingSpin,
} from './spinDevice.js'

const token = 'a'.repeat(64)
function browser(t, { blockStorage = false, blockCookie = false } = {}) {
  const data = new Map(), cookies = new Map()
  const storage = {
    getItem: key => { if (blockStorage) throw new Error('blocked'); return data.get(key) ?? null },
    setItem: (key, value) => { if (blockStorage) throw new Error('blocked'); data.set(key, String(value)) },
    removeItem: key => data.delete(key), clear: () => data.clear(),
  }
  const doc = {
    get cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    set cookie(value) {
      if (blockCookie) return
      const [key, val] = value.split(';')[0].split('=')
      cookies.set(key, val)
    },
  }
  for (const [key, value] of Object.entries({ localStorage: storage, document: doc, location: { protocol: 'https:' } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key] })
  }
  return { data, cookies, storage }
}

test('device registration is shared by concurrent calls and never keyed by account', async t => {
  const { storage } = browser(t)
  let calls = 0
  const register = async () => { calls++; return token }
  assert.deepEqual(await Promise.all([getSpinDevice(register), getSpinDevice(register)]), [token, token])
  storage.setItem('ccl3_user', JSON.stringify({ id: 'account-a' }))
  storage.removeItem('ccl3_user') // sign out
  storage.setItem('ccl3_user', JSON.stringify({ id: 'account-b' }))
  assert.equal(await getSpinDevice(register), token)
  assert.equal(calls, 1)
})

test('cookie restores cleared local storage; local storage restores a cleared cookie', async t => {
  const { storage, cookies, data } = browser(t)
  saveSpinDevice(token)
  assert.equal(cookies.get(SPIN_DEVICE_COOKIE), token)
  storage.clear()
  assert.equal(await getSpinDevice(() => { throw new Error('must not register again') }), token)
  assert.equal(data.get(SPIN_DEVICE_KEY), token)
  cookies.clear()
  assert.equal(readSpinDevice(), token)
  await getSpinDevice(() => { throw new Error('must not register again') })
  assert.equal(cookies.get(SPIN_DEVICE_COOKIE), token)
})

test('no in-memory-only identity when persistent storage is unavailable', async t => {
  browser(t, { blockStorage: true, blockCookie: true })
  await assert.rejects(getSpinDevice(async () => token), /err.spinStorage/)
  assert.throws(() => getPendingSpin('account'), /err.spinStorage/)
})

test('either persistent store can preserve the browser token', t => {
  browser(t, { blockStorage: true })
  assert.equal(saveSpinDevice(token), token)
  assert.equal(readSpinDevice(), token)
})

test('invalid stored identity is not silently replaced to evade a quota', async t => {
  const { storage } = browser(t)
  storage.setItem(SPIN_DEVICE_KEY, 'invalid')
  let registered = false
  await assert.rejects(getSpinDevice(async () => { registered = true; return token }), /err.spinDevice/)
  assert.equal(registered, false)
})

test('pending IDs survive refresh/sign-out and stay isolated between accounts', t => {
  browser(t)
  const first = getPendingSpin('a')
  assert.equal(getPendingSpin('a'), first)
  assert.equal(readPendingSpin('a'), first)
  const second = getPendingSpin('b')
  assert.notEqual(second, first)
  clearPendingSpin('a', 'stale-response')
  assert.equal(readPendingSpin('a'), first)
  clearPendingSpin('a', first)
  assert.equal(readPendingSpin('a'), null)
  assert.equal(readPendingSpin('b'), second)
  assert.notEqual(getPendingSpin('a'), first)
})
