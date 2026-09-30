import { parseYoutube } from '../src/lib/youtubeUrl.js'

const SITE = 'https://chaereve.pages.dev'
const PAGE_SIZE = 24
const MEDIA_LIMIT = 50
const BATCH_SIZE = 500
const MAX_ROWS = 5000
const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy': "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; img-src 'self' https:; form-action 'self'; upgrade-insecure-requests",
}
const ERROR_HEADERS = { ...HEADERS, 'cache-control': 'no-store' }

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]))
const safeJson = value => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const cleanPage = value => {
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n > 0 ? Math.min(n, 99999) : 1
}
const cleanMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''))
  ? String(value) : ''
const addedMonth = value => {
  const timestamp = Date.parse(value || '')
  if (!Number.isFinite(timestamp)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(timestamp))
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  return year && month ? `${year}-${month}` : ''
}
const monthLabel = month => {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', timeZone: 'UTC',
  })
}
const safeImage = value => {
  const raw = String(value || '').trim()
  if (!raw || raw.length > 2000) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return ''
    return url.href
  } catch { return '' }
}

export function archiveVideos(rows) {
  const sorted = (rows || []).slice().sort((a, b) => {
    const date = row => Date.parse(row?.updated_at || row?.created_at || '') || 0
    return date(b) - date(a)
  })
  const byVideo = new Map()
  for (const row of sorted) {
    if (row?.status !== 'completed') continue
    const id = parseYoutube(row.video_url)?.id
    if (!id) continue
    const found = byVideo.get(id)
    if (found) {
      found.requestCount += 1
      continue
    }
    byVideo.set(id, {
      id,
      artist: String(row.artist || '').trim(),
      title: String(row.title || '').trim(),
      kind: String(row.kind || '').trim(),
      requestCount: 1,
    })
  }
  return [...byVideo.values()]
}

export function archiveMedia(rows) {
  const sorted = (rows || []).slice().sort((a, b) => {
    const position = (Number(a?.position) || 0) - (Number(b?.position) || 0)
    if (position) return position
    return (Date.parse(b?.created_at || '') || 0) - (Date.parse(a?.created_at || '') || 0)
  })
  const seen = new Set()
  const items = []
  for (const row of sorted) {
    if (row?.is_hidden === true || !['featured', 'video'].includes(row?.kind)) continue
    const id = parseYoutube(row?.url)?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const createdTimestamp = Date.parse(row?.created_at || '')
    const createdAt = Number.isFinite(createdTimestamp) ? new Date(createdTimestamp).toISOString() : ''
    items.push({
      id,
      title: String(row?.title || '').trim().slice(0, 120) || 'Channel video',
      kind: row.kind,
      thumb: safeImage(row?.thumb),
      createdAt,
      position: Number(row?.position) || 0,
    })
    if (items.length >= MEDIA_LIMIT) break
  }
  return items
}

function card(video) {
  const name = [video.artist, video.title].filter(Boolean).join(' — ') || 'Completed lyrics video'
  const youtube = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`
  const thumb = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`
  const requested = video.requestCount > 1
    ? `<p class="card-note">Community favorite · ${video.requestCount} requests</p>`
    : '<p class="card-note">Completed color-coded lyrics</p>'
  return `<article class="video-card">
    <a class="thumb" href="${youtube}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${esc(name)} on YouTube">
      <img src="${thumb}" alt="Thumbnail for ${esc(name)}" width="480" height="360" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      <span class="play" aria-hidden="true">▶</span>
    </a>
    <div class="card-body">
      <p class="kind">${esc(video.kind || 'Lyrics video')}</p>
      <h2><a href="${youtube}" target="_blank" rel="noopener noreferrer">${esc(name)}</a></h2>
      ${requested}
    </div>
  </article>`
}

function mediaCard(video) {
  const youtube = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`
  const image = video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`
  const kind = video.kind === 'featured' ? 'Featured video' : 'Channel video'
  return `<article class="gallery-card">
    <a class="gallery-thumb" href="${youtube}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${esc(video.title)} on YouTube">
      <img src="${esc(image)}" alt="Cover for ${esc(video.title)}" width="480" height="270" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      <span class="play" aria-hidden="true">▶</span>
    </a>
    <div class="card-body"><p class="kind">${kind}</p><h3><a href="${youtube}" target="_blank" rel="noopener noreferrer">${esc(video.title)}</a></h3></div>
  </article>`
}

function pageUrl(page, query, month) {
  const url = new URL('/archive', SITE)
  if (page > 1) url.searchParams.set('page', String(page))
  if (query) url.searchParams.set('q', query)
  if (month) url.searchParams.set('month', month)
  return `${url.pathname}${url.search}`
}

export function renderArchivePage({ videos, media = [], query = '', month: rawMonth = '', page = 1, capped = false, mediaUnavailable = false }) {
  const q = String(query || '').trim().slice(0, 100)
  const month = cleanMonth(rawMonth)
  const hasFilter = !!q || !!String(rawMonth || '').trim()
  const normalized = q.toLocaleLowerCase('en')
  const filtered = (videos || []).filter(video =>
    !normalized || `${video.artist} ${video.title} ${video.kind}`.toLocaleLowerCase('en').includes(normalized))
  const galleryMonths = [...new Set((media || []).map(video => addedMonth(video.createdAt)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))
  const gallery = (media || []).filter(video => {
    const matchesText = !normalized || video.title.toLocaleLowerCase('en').includes(normalized)
    const matchesMonth = !month || addedMonth(video.createdAt) === month
    return matchesText && matchesMonth
  })
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(cleanPage(page), pages)
  const start = (currentPage - 1) * PAGE_SIZE
  const visible = filtered.slice(start, start + PAGE_SIZE)
  const canonical = new URL('/archive', SITE)
  if (!hasFilter && currentPage > 1) canonical.searchParams.set('page', String(currentPage))
  const canonicalHref = canonical.href
  const robots = hasFilter ? 'noindex,follow' : 'index,follow'
  const title = 'Completed Color-Coded Lyrics Videos | Chaereve'
  const description = 'Browse completed color-coded lyrics videos from Chaereve. Search the archive by artist, song, or video type.'
  const itemList = visible.map((video, index) => {
    // Use only the request's artist/title and the validated video ID; do not infer
    // YouTube publication dates, descriptions, or a channel from request data.
    const name = [video.artist, video.title].filter(Boolean).join(' — ') || 'Completed lyrics video'
    const youtube = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`
    return {
      '@type': 'ListItem',
      position: start + index + 1,
      item: {
        '@type': 'VideoObject',
        name,
        thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}`,
        url: youtube,
      },
    }
  })
  const galleryList = gallery.map((video, index) => {
    const youtube = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`
    const thumbnail = video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`
    return {
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'VideoObject',
        name: video.title,
        thumbnailUrl: thumbnail,
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}`,
        url: youtube,
      },
    }
  })
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonicalHref,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: filtered.length,
      itemListElement: itemList,
    },
    ...(gallery.length ? { hasPart: {
      '@type': 'ItemList',
      name: 'Channel video gallery',
      numberOfItems: gallery.length,
      itemListElement: galleryList,
    } } : {}),
  }
  const pager = pages > 1 ? `<nav class="pager" aria-label="Archive pages">
    ${currentPage > 1 ? `<a href="${esc(pageUrl(currentPage - 1, q, month))}" rel="prev">← Previous</a>` : '<span></span>'}
    <span>Page ${currentPage} of ${pages}</span>
    ${currentPage < pages ? `<a href="${esc(pageUrl(currentPage + 1, q, month))}" rel="next">Next →</a>` : '<span></span>'}
  </nav>` : ''
  const notice = capped
    ? '<p class="notice">Showing the latest 5,000 completed requests. Older entries may not appear yet.</p>'
    : ''
  const content = visible.length
    ? `<div class="grid">${visible.map(card).join('')}</div>${pager}${notice}`
    : `<section class="empty"><h2>No videos found</h2><p>Try another artist or song title.</p><a href="/archive">Clear search</a></section>`
  const monthOptions = galleryMonths.map(value =>
    `<option value="${value}"${month === value ? ' selected' : ''}>${esc(monthLabel(value))}</option>`).join('')
  const galleryContent = mediaUnavailable
    ? '<p class="gallery-state" role="status">The channel gallery is temporarily unavailable. The completed-request archive is still shown above.</p>'
    : gallery.length
      ? `<div class="gallery-grid">${gallery.map(mediaCard).join('')}</div>`
      : '<p class="gallery-state">No channel videos match these filters.</p>'
  const gallerySection = `<section class="gallery" id="channel-gallery" aria-labelledby="gallery-title">
    <div class="section-head"><div><p class="eyebrow">From the channel list</p><h2 id="gallery-title">Cover gallery</h2>
      <p class="gallery-note">Month means when an entry was added to the site video list, not when the video was completed or published on YouTube.</p></div>
      ${mediaUnavailable ? '' : `<p class="count">${gallery.length} ${gallery.length === 1 ? 'video' : 'videos'}</p>`}</div>
    ${galleryContent}${media.length >= MEDIA_LIMIT ? '<p class="notice">Showing up to 50 curated videos.</p>' : ''}
  </section>`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${esc(canonicalHref)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonicalHref)}">
  <meta property="og:image" content="${SITE}/logo-192.png">
  <link rel="icon" href="/favicon.ico">
  <script type="application/ld+json">${safeJson(structured)}</script>
  <style>
    :root{color-scheme:dark;--bg:#0b0d12;--panel:#131720;--line:#272c38;--text:#f3f4f8;--muted:#a3a9b8;--accent:#9298ff;--radius:16px}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    a{color:inherit}a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .wrap{width:min(1120px,calc(100% - 32px));margin:0 auto}.top{border-bottom:1px solid var(--line);background:#0e1118}
    .top-in{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{font-weight:800;letter-spacing:.02em;text-decoration:none}.nav{display:flex;gap:18px;color:var(--muted);font-size:14px}
    .hero{padding:56px 0 30px}.eyebrow{color:var(--accent);font-size:12px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px}
    h1{font-size:clamp(32px,6vw,54px);line-height:1.05;letter-spacing:-.04em;margin:0;max-width:760px;text-wrap:balance}
    .intro{color:var(--muted);max-width:660px;margin:16px 0 24px}.search{display:flex;gap:8px;max-width:860px;align-items:center}.search input,.search select{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--text);padding:12px 14px;font:inherit;min-height:46px}
    .search select{flex:0 1 210px}.search button{border:0;border-radius:12px;background:var(--accent);color:#111321;font-weight:750;padding:0 18px;min-height:46px;cursor:pointer}
    .count{color:var(--muted);font-size:14px;margin:0 0 14px}.grid,.gallery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:16px;padding-bottom:36px}
    .video-card,.gallery-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;min-width:0}.thumb,.gallery-thumb{display:block;position:relative;aspect-ratio:16/9;background:#080a0e;overflow:hidden}
    .thumb img,.gallery-thumb img{width:100%;height:100%;object-fit:cover;display:block}.play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:48px;height:34px;border-radius:10px;background:#111c;color:#fff;display:grid;place-items:center}
    .card-body{padding:14px 16px 16px}.kind{color:var(--accent);font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;margin:0 0 5px}.card-body h2,.card-body h3{font-size:18px;line-height:1.3;margin:0;text-wrap:balance}.card-body h2 a,.card-body h3 a{text-decoration:none}.card-body h2 a:hover,.card-body h3 a:hover{text-decoration:underline}.card-note{color:var(--muted);font-size:13px;margin:9px 0 0}
    .gallery{border-top:1px solid var(--line);padding:30px 0 12px;margin:10px 0 34px}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:16px}.section-head h2{font-size:clamp(24px,4vw,32px);line-height:1.1;margin:0}.section-head .eyebrow{margin-bottom:5px}.gallery-note,.gallery-state{max-width:760px;color:var(--muted);font-size:13px;margin:8px 0 0}.gallery-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));padding-bottom:8px}
    .pager{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding:18px 0 34px;color:var(--muted);font-size:14px}.pager a,.empty a{color:var(--accent)}.notice{color:var(--muted);font-size:13px}
    .empty{border:1px dashed var(--line);border-radius:var(--radius);padding:28px;margin-bottom:40px}.empty h2{margin:0 0 6px}.empty p{margin:0 0 10px;color:var(--muted)}
    footer{border-top:1px solid var(--line);padding:24px 0 36px;color:var(--muted);font-size:13px}footer .wrap{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
    @media(max-width:620px){.search{flex-wrap:wrap}.search input{flex:1 1 100%}.search select{flex:1 1 62%}.search button{flex:1 0 auto}.section-head{align-items:flex-start;flex-direction:column;gap:8px}.section-head .count{margin:0}.grid,.gallery-grid{gap:12px}}
    @media(max-width:540px){.hero{padding-top:40px}.top-in{min-height:60px}.nav{gap:12px;font-size:13px}.search button{padding:0 12px}}
  </style>
</head>
<body>
  <header class="top"><div class="wrap top-in"><a class="brand" href="/">CHAEREVE</a><nav class="nav" aria-label="Main navigation"><a href="/">Board</a><a href="/faq.html">FAQ</a></nav></div></header>
  <main class="wrap">
    <section class="hero"><p class="eyebrow">The archive</p><h1>Completed color-coded lyrics</h1>
      <p class="intro">Every video here is a finished piece of work. Search by artist, song, or video type, then watch on YouTube.</p>
      <form class="search" action="/archive" method="get" role="search"><label class="sr-only" for="q">Search artist, song, or type</label>
        <input id="q" name="q" type="search" maxlength="100" placeholder="Search artist or song…" value="${esc(q)}" autocomplete="off">
        <label class="sr-only" for="month">Month added to the site video list</label>
        <select id="month" name="month"><option value="">All added months</option>${monthOptions}</select>
        <button type="submit">Search</button></form>
    </section>
    <p class="count">${filtered.length} ${filtered.length === 1 ? 'video' : 'videos'}${q ? ` matching “${esc(q)}”` : ' in the completed-request archive'}</p>
    ${content}
    ${gallerySection}
  </main>
  <footer><div class="wrap"><span>Chaereve · Color-coded lyrics</span><span><a href="/faq.html">FAQ</a> · <a href="/privacy.html">Privacy</a></span></div></footer>
</body></html>`
  return html
}

async function fetchSelectedMedia(env) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) return { rows: [], unavailable: true }
  const base = env.SUPABASE_URL.replace(/\/$/, '')
  const url = new URL(`${base}/rest/v1/media`)
  url.search = new URLSearchParams({
    select: 'kind,title,url,thumb,created_at,position',
    kind: 'in.(featured,video)',
    is_hidden: 'eq.false',
    order: 'position.asc,created_at.desc',
    limit: String(MEDIA_LIMIT),
  }).toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        accept: 'application/json',
      },
    })
    if (!response.ok) return { rows: [], unavailable: true }
    const rows = await response.json()
    return Array.isArray(rows) ? { rows, unavailable: false } : { rows: [], unavailable: true }
  } catch {
    return { rows: [], unavailable: true }
  } finally { clearTimeout(timer) }
}

async function fetchCompleted(env) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) throw new Error('archive unavailable')
  const base = env.SUPABASE_URL.replace(/\/$/, '')
  const rows = []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    for (let offset = 0; offset < MAX_ROWS; offset += BATCH_SIZE) {
      const url = new URL(`${base}/rest/v1/requests`)
      url.search = new URLSearchParams({
        select: 'artist,title,kind,status,video_url,created_at,updated_at',
        status: 'eq.completed',
        video_url: 'not.is.null',
        order: 'updated_at.desc.nullslast,created_at.desc',
        limit: String(BATCH_SIZE),
        offset: String(offset),
      }).toString()
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          accept: 'application/json',
        },
      })
      if (!response.ok) throw new Error('archive query failed')
      const batch = await response.json()
      if (!Array.isArray(batch)) throw new Error('invalid archive response')
      rows.push(...batch)
      if (batch.length < BATCH_SIZE) return { rows, capped: false }
    }
    return { rows, capped: true }
  } finally { clearTimeout(timer) }
}

export async function onRequest({ request, env }) {
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: HEADERS })
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { ...ERROR_HEADERS, allow: 'GET, HEAD' } })
  }
  try {
    const [archiveResult, mediaResult] = await Promise.all([
      fetchCompleted(env), fetchSelectedMedia(env),
    ])
    const videos = archiveVideos(archiveResult.rows)
    const media = archiveMedia(mediaResult.rows)
    const url = new URL(request.url)
    const html = renderArchivePage({
      videos,
      media,
      query: url.searchParams.get('q') || '',
      month: url.searchParams.get('month') || '',
      page: url.searchParams.get('page'),
      capped: archiveResult.capped,
      mediaUnavailable: mediaResult.unavailable,
    })
    return new Response(html, { status: 200, headers: HEADERS })
  } catch {
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Archive unavailable | Chaereve</title><body style="background:#0b0d12;color:#f3f4f8;font:16px system-ui;padding:40px"><main><h1>Archive temporarily unavailable</h1><p>Please try again shortly.</p><a href="/">Back to the board</a></main></body></html>`
    return new Response(request.method === 'HEAD' ? null : html, { status: 503, headers: ERROR_HEADERS })
  }
}
