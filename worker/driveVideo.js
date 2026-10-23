/* Server-side Google Drive access for private 30-second preview clips.
   Only the exact `${artist} - ${title} - 30s.mp4` file inside the configured
   folder can be discovered or streamed. OAuth credentials never reach clients. */

const DEFAULT_FOLDER_ID = '1Pc8aDq_Ieq6j8hAZLzXUkGO1Fm4l1Zp5'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
}

let tokenCache = null

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: JSON_HEADERS,
})

export function clipFilename(artist, title) {
  if (typeof artist !== 'string' || typeof title !== 'string') return null
  const a = artist.trim()
  const t = title.trim()
  const hasControl = [...a + t].some(character => {
    const code = character.codePointAt(0)
    return code <= 0x1f || code === 0x7f
  })
  if (!a || !t || a.length > 100 || t.length > 140 || hasControl) return null
  return `${a} - ${t} - 30s.mp4`
}

function config(env) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: refreshToken } = env || {}
  if (!clientId || !clientSecret || !refreshToken) return null
  return {
    clientId,
    clientSecret,
    refreshToken,
    folderId: env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID,
  }
}

async function accessToken(env) {
  const cfg = config(env)
  if (!cfg) return null
  const cacheKey = `${cfg.clientId}:${cfg.refreshToken}`
  if (tokenCache?.cacheKey === cacheKey && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  if (!body?.access_token) return null
  tokenCache = {
    cacheKey,
    value: body.access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in) || 3600) * 1000,
  }
  return tokenCache.value
}

function escapeDriveQuery(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

async function findClip(env, artist, title) {
  const cfg = config(env)
  const name = clipFilename(artist, title)
  if (!cfg || !name) return { status: cfg ? 400 : 503 }

  const token = await accessToken(env)
  if (!token) return { status: 503 }
  const query = `'${escapeDriveQuery(cfg.folderId)}' in parents and name = '${escapeDriveQuery(name)}' and trashed = false`
  const params = new URLSearchParams({
    q: query,
    pageSize: '10',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,size,parents,modifiedTime)',
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) return { status: 502 }
  const body = await response.json().catch(() => null)
  const file = body?.files?.find(item => item?.name === name
    && item?.mimeType === 'video/mp4'
    && Array.isArray(item.parents)
    && item.parents.includes(cfg.folderId)
    && typeof item.id === 'string')
  return file ? { status: 200, cfg, file } : { status: 404 }
}

function paramsFrom(request) {
  const url = new URL(request.url)
  return { artist: url.searchParams.get('artist'), title: url.searchParams.get('title') }
}

export async function driveVideoFindRoute(request, env) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  try {
    const { artist, title } = paramsFrom(request)
    const result = await findClip(env, artist, title)
    if (result.status !== 200) return json({ error: result.status === 404 ? 'clip_not_found' : 'drive_unavailable' }, result.status)
    const params = new URLSearchParams({ artist: artist.trim(), title: title.trim() })
    return json({ url: `/api/drive-video/stream?${params}` })
  } catch {
    return json({ error: 'drive_unavailable' }, 502)
  }
}

export async function driveVideoStreamRoute(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: JSON_HEADERS })
  try {
    const { artist, title } = paramsFrom(request)
    const result = await findClip(env, artist, title)
    if (result.status !== 200) return new Response(null, { status: result.status, headers: JSON_HEADERS })

    const token = await accessToken(env)
    if (!token) return new Response(null, { status: 503, headers: JSON_HEADERS })
    const headers = { authorization: `Bearer ${token}` }
    const range = request.headers.get('range')
    if (range) headers.range = range
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(result.file.id)}?alt=media`, {
      method: request.method,
      headers,
    })
    if (!response.ok && response.status !== 206) return new Response(null, { status: 502, headers: JSON_HEADERS })

    const forwarded = new Headers({
      'content-type': 'video/mp4',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    })
    for (const name of ['content-length', 'content-range', 'last-modified', 'etag']) {
      const value = response.headers.get(name)
      if (value) forwarded.set(name, value)
    }
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: forwarded,
    })
  } catch {
    return new Response(null, { status: 502, headers: JSON_HEADERS })
  }
}
