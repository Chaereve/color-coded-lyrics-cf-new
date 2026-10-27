/* Server-side Google Drive access for private 30-second preview clips.
   Only the exact `${artist} - ${title} - 30s.mp4` file inside the configured
   folder can be discovered or streamed. OAuth credentials never reach clients. */

const DEFAULT_FOLDER_ID = '1Pc8aDq_Ieq6j8hAZLzXUkGO1Fm4l1Zp5'
const BASE_SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
}
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  ...BASE_SECURITY_HEADERS,
}
const STREAM_ERROR_HEADERS = { ...BASE_SECURITY_HEADERS }

let tokenCache = null
const LOOKUP_CACHE_TTL_MS = 60_000
const LOOKUP_MISS_TTL_MS = 10_000
const LOOKUP_CACHE_MAX = 500
const RATE_WINDOW_MS = 60_000
const DRIVE_API_TIMEOUT_MS = 8_000
const DRIVE_STREAM_TIMEOUT_MS = 25_000
export const DRIVE_RATE_LIMITS = Object.freeze({ find: 30, stream: 180 })
let lookupCache = new Map()
let localRateWindows = new Map()
let lastD1PruneWindow = -1

const json = (payload, status = 200, extraHeaders = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...JSON_HEADERS, ...extraHeaders },
})

const emptyStreamResponse = (status, extraHeaders = {}) => new Response(null, {
  status,
  headers: { ...STREAM_ERROR_HEADERS, ...extraHeaders },
})

async function fetchWithTimeout(input, init = {}, timeoutMs = DRIVE_API_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

/* Local fallback protects a single Worker isolate. Production should bind
   RATE_SHIELD and apply worker/migrations/0002_drive_video_rate_limit.sql so
   the same limit is shared across isolates. */
export function clearDriveVideoState() {
  tokenCache = null
  lookupCache = new Map()
  localRateWindows = new Map()
  lastD1PruneWindow = -1
}

async function sha256hex(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function checkDriveRateLimit(request, env, endpoint, now = Date.now()) {
  const ip = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  const ipHash = await sha256hex(ip)
  const windowMinute = Math.floor(now / RATE_WINDOW_MS)
  const maximum = DRIVE_RATE_LIMITS[endpoint]
  const retryAfter = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now % RATE_WINDOW_MS)) / 1000))

  if (env?.RATE_SHIELD && typeof env.RATE_SHIELD.prepare === 'function') {
    try {
      if (lastD1PruneWindow !== windowMinute && windowMinute % 10 === 0) {
        await env.RATE_SHIELD.prepare(
          'DELETE FROM drive_video_rate_limits WHERE window_minute < ?'
        ).bind(windowMinute - 2).run()
        lastD1PruneWindow = windowMinute
      }
      const row = await env.RATE_SHIELD.prepare(`
        INSERT INTO drive_video_rate_limits (window_minute, ip_hash, endpoint, requests)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(window_minute, ip_hash, endpoint)
        DO UPDATE SET requests = drive_video_rate_limits.requests + 1
        RETURNING requests
      `).bind(windowMinute, ipHash, endpoint).first()
      return { ok: Number(row?.requests) <= maximum, retryAfter }
    } catch {
      /* If a production D1 binding exists but its table is missing/unavailable,
         fail closed rather than silently reverting to per-isolate limits. */
      return { ok: false, unavailable: true, retryAfter }
    }
  }

  const key = `${windowMinute}:${endpoint}:${ipHash}`
  const used = (localRateWindows.get(key) || 0) + 1
  localRateWindows.set(key, used)
  if (localRateWindows.size > 5000) {
    for (const entry of localRateWindows.keys()) {
      if (!entry.startsWith(`${windowMinute}:`)) localRateWindows.delete(entry)
      if (localRateWindows.size <= 3500) break
    }
  }
  return { ok: used <= maximum, retryAfter }
}

async function rateLimitedResponse(request, env, endpoint, bodyless = false) {
  const limit = await checkDriveRateLimit(request, env, endpoint)
  if (limit.ok) return null
  if (limit.unavailable) {
    return bodyless ? emptyStreamResponse(503) : json({ error: 'drive_unavailable' }, 503)
  }
  const extra = { 'retry-after': String(limit.retryAfter) }
  return bodyless ? emptyStreamResponse(429, extra) : json({ error: 'rate_limited' }, 429, extra)
}

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

function invalidateAccessToken(cacheKey = null) {
  if (!cacheKey || tokenCache?.cacheKey === cacheKey) tokenCache = null
}

async function accessToken(env, { forceRefresh = false } = {}) {
  const cfg = config(env)
  if (!cfg) return null
  const cacheKey = `${cfg.clientId}:${cfg.refreshToken}`
  if (!forceRefresh && tokenCache?.cacheKey === cacheKey && tokenCache.expiresAt > Date.now() + 60_000) {
    return { token: tokenCache.value, fromCache: true, cacheKey }
  }

  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
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
  return { token: tokenCache.value, fromCache: false, cacheKey }
}

function escapeDriveQuery(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

async function fetchDriveAuthorized(env, url, init = {}, timeoutMs = DRIVE_API_TIMEOUT_MS) {
  let auth = await accessToken(env)
  if (!auth?.token) return { authError: true, response: null }

  let response = await fetchWithTimeout(url, {
    ...init,
    headers: { ...(init.headers || {}), authorization: `Bearer ${auth.token}` },
  }, timeoutMs)

  if ((response.status === 401 || response.status === 403) && auth.fromCache) {
    invalidateAccessToken(auth.cacheKey)
    auth = await accessToken(env, { forceRefresh: true })
    if (!auth?.token) return { authError: true, response: null }
    response = await fetchWithTimeout(url, {
      ...init,
      headers: { ...(init.headers || {}), authorization: `Bearer ${auth.token}` },
    }, timeoutMs)
  }
  if (response.status === 401 || response.status === 403) {
    invalidateAccessToken(auth.cacheKey)
  }
  return { authError: false, response }
}

async function findClip(env, artist, title) {
  const cfg = config(env)
  const name = clipFilename(artist, title)
  if (!cfg || !name) return { status: cfg ? 400 : 503 }

  const cacheKey = `${cfg.folderId}:${name}`
  const cached = lookupCache.get(cacheKey)
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      lookupCache.delete(cacheKey)
      lookupCache.set(cacheKey, cached)
      return cached.status === 200 ? { status: 200, cfg, file: cached.file } : { status: 404 }
    }
    lookupCache.delete(cacheKey)
  }

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
  const { authError, response } = await fetchDriveAuthorized(
    env,
    `https://www.googleapis.com/drive/v3/files?${params}`,
  )
  if (authError || !response) return { status: 503 }
  if (!response.ok) return { status: 502 }
  const body = await response.json().catch(() => null)
  const file = body?.files?.find(item => item?.name === name
    && item?.mimeType === 'video/mp4'
    && Array.isArray(item.parents)
    && item.parents.includes(cfg.folderId)
    && typeof item.id === 'string')
  const entry = {
    status: file ? 200 : 404,
    file: file || null,
    expiresAt: Date.now() + (file ? LOOKUP_CACHE_TTL_MS : LOOKUP_MISS_TTL_MS),
  }
  lookupCache.set(cacheKey, entry)
  while (lookupCache.size > LOOKUP_CACHE_MAX) lookupCache.delete(lookupCache.keys().next().value)
  return file ? { status: 200, cfg, file } : { status: 404 }
}

function paramsFrom(request) {
  const url = new URL(request.url)
  return { artist: url.searchParams.get('artist'), title: url.searchParams.get('title') }
}

export async function driveVideoFindRoute(request, env) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  const limited = await rateLimitedResponse(request, env, 'find')
  if (limited) return limited
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
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return emptyStreamResponse(405, { allow: 'GET, HEAD' })
  }
  const limited = await rateLimitedResponse(request, env, 'stream', request.method === 'HEAD')
  if (limited) return limited
  try {
    const { artist, title } = paramsFrom(request)
    const result = await findClip(env, artist, title)
    if (result.status !== 200) return emptyStreamResponse(result.status)

    const headers = {}
    const range = request.headers.get('range')
    if (range) headers.range = range
    const { authError, response } = await fetchDriveAuthorized(
      env,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(result.file.id)}?alt=media`,
      { method: request.method, headers },
      DRIVE_STREAM_TIMEOUT_MS,
    )
    if (authError || !response) return emptyStreamResponse(503)
    if (!response.ok && response.status !== 206) return emptyStreamResponse(502)

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
    return emptyStreamResponse(502)
  }
}
