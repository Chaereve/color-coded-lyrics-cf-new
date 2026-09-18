/* A browser token, independent of Supabase sessions / user IDs. Not a hardware
   fingerprint: another browser or clearing ALL site data creates a new identity.
   Never clear this on sign-out. Only the server issues production tokens. */
export const SPIN_DEVICE_KEY = 'ccl.spin.device.v1'
export const SPIN_DEVICE_COOKIE = 'ccl_spin_device_v1'
export const SPIN_SYNC_KEY = 'ccl.spin.changed.v1'
const TOKEN = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const pendingKey = userId => `ccl.spin.pending.v1.${userId}`

function readCookie() {
  try {
    return document.cookie.split(';').map(s => s.trim())
      .find(s => s.startsWith(`${SPIN_DEVICE_COOKIE}=`))?.slice(SPIN_DEVICE_COOKIE.length + 1) || null
  } catch { return null }
}

export function readSpinDevice() {
  // A first-party cookie backs up localStorage, so clearing just one does not
  // reset the ID. Do not silently replace a corrupt or server-rejected token.
  let stored = null
  try { stored = localStorage.getItem(SPIN_DEVICE_KEY) } catch { /* cookie fallback */ }
  const token = readCookie() || stored
  if (token && !TOKEN.test(token)) throw new Error('err.spinDevice')
  return token
}

export function saveSpinDevice(token) {
  if (!TOKEN.test(token)) throw new Error('err.spinDevice')
  let saved = false
  try {
    localStorage.setItem(SPIN_DEVICE_KEY, token)
    saved = localStorage.getItem(SPIN_DEVICE_KEY) === token
  } catch { /* cookie fallback */ }
  try {
    document.cookie = `${SPIN_DEVICE_COOKIE}=${token}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
    saved ||= readCookie() === token
  } catch { /* storage may be blocked */ }
  if (!saved) throw new Error('err.spinStorage')
  return token
}

export function withSpinLock(name, fn) {
  // This avoids first-visit registration races in supporting browsers. Actual
  // reward/limit safety is provided by Postgres locks, NOT this optional lock.
  return globalThis.navigator?.locks?.request
    ? navigator.locks.request(name, fn)
    : Promise.resolve().then(fn)
}

let registering = null
export function getSpinDevice(issueToken) {
  if (!registering) {
    registering = withSpinLock('ccl.spin.device', async () => {
      const token = readSpinDevice() || await issueToken()
      return saveSpinDevice(token)
    }).finally(() => { registering = null })
  }
  return registering
}

export function readPendingSpin(userId) {
  try {
    const id = localStorage.getItem(pendingKey(userId))
    return id && UUID.test(id) ? id : null
  } catch { return null }
}

export function getPendingSpin(userId) {
  const id = readPendingSpin(userId) || crypto.randomUUID()
  // Persist BEFORE sending. A failed write must never start an untraceable spin.
  try {
    localStorage.setItem(pendingKey(userId), id)
    if (localStorage.getItem(pendingKey(userId)) !== id) throw new Error()
  } catch { throw new Error('err.spinStorage') }
  return id
}

export function clearPendingSpin(userId, requestId) {
  try {
    // Another tab may have started a different request; never clear its retry ID.
    if (readPendingSpin(userId) === requestId) localStorage.removeItem(pendingKey(userId))
  } catch { /* a retained retry ID is safe: the server replays without crediting */ }
}

export function announceSpinChange() {
  try { localStorage.setItem(SPIN_SYNC_KEY, crypto.randomUUID()) } catch { /* optional tab refresh */ }
}

/* Token trình duyệt hỏng (extension/đồng bộ ghi đè, storage lỗi) làm
   readSpinDevice() ném err.spinDevice mãi mãi và người dùng không có cách nào
   tự thoát. Nút "Reset this browser" gọi hàm này: xoá token cũ để lần sau xin
   token mới. An toàn vì hạn mức thật nằm ở ledger phía server — xoá token
   KHÔNG hồi lại lượt quay đã dùng hôm nay (bản ghi vẫn còn theo tài khoản). */
export function resetSpinDevice() {
  try { localStorage.removeItem(SPIN_DEVICE_KEY) } catch { /* ignore */ }
  try {
    document.cookie = `${SPIN_DEVICE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  } catch { /* ignore */ }
  registering = null
}
