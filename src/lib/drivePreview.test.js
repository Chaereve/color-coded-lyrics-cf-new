import test from 'node:test'
import assert from 'node:assert/strict'
import { findDrivePreview } from './drivePreview.js'

for (const [status, body, expected] of [
  [200, { url: '/api/drive-video/stream?artist=KickFlip&title=Band-Aid' }, 'ready'],
  [404, { error: 'clip_not_found' }, 'missing'],
  [404, null, 'error'], // missing deployment route is NOT a missing clip
  [503, { error: 'drive_not_configured' }, 'error'],
  [503, { error: 'drive_auth_failed' }, 'error'],
  [503, { error: 'drive_rate_limit_unavailable' }, 'error'],
  [502, { error: 'drive_access_denied' }, 'error'],
  [429, { error: 'rate_limited' }, 'error'],
  [200, { url: 'https://drive.google.com/private-id' }, 'error'],
  [200, null, 'error'], // SPA HTML fallback
]) {
  test(`lookup classifies ${status} ${JSON.stringify(body)}`, async t => {
    t.mock.method(globalThis, 'fetch', async url => {
      assert.equal(new URL(url, 'https://example.test').searchParams.get('artist'), 'KickFlip')
      return body ? Response.json(body, { status }) : new Response('<html>SPA</html>', { status })
    })
    const result = await findDrivePreview('KickFlip', 'Band-Aid')
    assert.equal(result.status, expected)
    if (expected === 'error') assert.match(result.message, /^preview\.drive/)
  })
}

test('network failure and a stalled lookup report an error rather than missing/loading forever', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  assert.equal((await findDrivePreview('ADÉLA', 'Nicole Kidman')).status, 'error')
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  assert.equal((await findDrivePreview('ADÉLA', 'Nicole Kidman', { timeoutMs: 5 })).status, 'error')
})

test('closing the modal aborts the outstanding request', async t => {
  const controller = new AbortController()
  let requestSignal
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => new Promise((_, reject) => {
    requestSignal = signal
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const pending = findDrivePreview('f5ve', 'I Choose You', { signal: controller.signal })
  controller.abort()
  await pending
  assert.equal(requestSignal.aborted, true)
})
