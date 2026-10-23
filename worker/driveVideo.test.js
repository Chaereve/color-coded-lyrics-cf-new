import test from 'node:test'
import assert from 'node:assert/strict'
import { clipFilename, driveVideoFindRoute, driveVideoStreamRoute } from './driveVideo.js'

const folderId = '1Pc8aDq_Ieq6j8hAZLzXUkGO1Fm4l1Zp5'
const credentials = suffix => ({
  GOOGLE_CLIENT_ID: `client-${suffix}`,
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REFRESH_TOKEN: `refresh-${suffix}`,
})

function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => { globalThis.fetch = original }
}

const request = (route, method = 'GET') => new Request(
  `https://chaereve.example/api/drive-video/${route}?artist=IVE&title=Looks%20Can%20Kill`,
  { method },
)

test('clip filename follows the required output convention and rejects malformed metadata', () => {
  assert.equal(clipFilename('IVE', 'Looks Can Kill'), 'IVE - Looks Can Kill - 30s.mp4')
  assert.equal(clipFilename('', 'Looks Can Kill'), null)
  assert.equal(clipFilename('IVE', 'bad\ntitle'), null)
})

test('Drive finder requires server-side OAuth configuration and does not call Google otherwise', async () => {
  const restore = stubFetch(() => { throw new Error('unexpected fetch') })
  try {
    const response = await driveVideoFindRoute(request('find'), {})
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'drive_unavailable' })
  } finally { restore() }
})

test('Drive finder returns a same-origin stream URL for the exact clip in the target folder', async () => {
  let seenQuery = ''
  let seenOrderBy = ''
  const restore = stubFetch(async (input, init = {}) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(init.method, 'POST')
      return Response.json({ access_token: 'test-access-token', expires_in: 3600 })
    }
    assert.match(url, /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/)
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-access-token')
    seenQuery = new URL(url).searchParams.get('q')
    seenOrderBy = new URL(url).searchParams.get('orderBy')
    return Response.json({ files: [{
      id: 'private-drive-id',
      name: 'IVE - Looks Can Kill - 30s.mp4',
      mimeType: 'video/mp4',
      parents: [folderId],
    }] })
  })
  try {
    const response = await driveVideoFindRoute(request('find'), { ...credentials('find'), GOOGLE_DRIVE_FOLDER_ID: folderId })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      url: '/api/drive-video/stream?artist=IVE&title=Looks+Can+Kill',
    })
    assert.match(seenQuery, /'1Pc8aDq_Ieq6j8hAZLzXUkGO1Fm4l1Zp5' in parents/)
    assert.match(seenQuery, /'IVE - Looks Can Kill - 30s\.mp4'/)
    assert.equal(seenOrderBy, 'modifiedTime desc')
  } finally { restore() }
})

test('Drive stream verifies folder membership and forwards byte ranges without exposing Drive IDs', async () => {
  let mediaUrl = ''
  let mediaRange = ''
  const restore = stubFetch(async (input, init = {}) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'stream-access-token', expires_in: 3600 })
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      return Response.json({ files: [{
        id: 'private-drive-id',
        name: 'IVE - Looks Can Kill - 30s.mp4',
        mimeType: 'video/mp4',
        parents: [folderId],
      }] })
    }
    mediaUrl = url
    mediaRange = new Headers(init.headers).get('range')
    return new Response('video bytes', {
      status: 206,
      headers: { 'content-range': 'bytes 0-10/100', 'content-length': '11' },
    })
  })
  try {
    const response = await driveVideoStreamRoute(new Request(
      'https://chaereve.example/api/drive-video/stream?artist=IVE&title=Looks%20Can%20Kill',
      { headers: { range: 'bytes=0-10' } },
    ), { ...credentials('stream'), GOOGLE_DRIVE_FOLDER_ID: folderId })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-type'), 'video/mp4')
    assert.equal(response.headers.get('content-range'), 'bytes 0-10/100')
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(await response.text(), 'video bytes')
    assert.equal(mediaRange, 'bytes=0-10')
    assert.match(mediaUrl, /\/files\/private-drive-id\?alt=media$/)
  } finally { restore() }
})

test('Drive stream refuses a same-named file from outside the configured folder', async () => {
  const restore = stubFetch(async input => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'outside-access-token', expires_in: 3600 })
    }
    return Response.json({ files: [{
      id: 'outside-file',
      name: 'IVE - Looks Can Kill - 30s.mp4',
      mimeType: 'video/mp4',
      parents: ['another-folder'],
    }] })
  })
  try {
    const response = await driveVideoStreamRoute(request('stream'), { ...credentials('outside'), GOOGLE_DRIVE_FOLDER_ID: folderId })
    assert.equal(response.status, 404)
  } finally { restore() }
})
