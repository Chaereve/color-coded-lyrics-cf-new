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
  'content-security-policy': "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' https:; form-action 'self'; upgrade-insecure-requests",
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
  const requested = `<p class="card-note">Linked to ${video.requestCount} completed ${video.requestCount === 1 ? 'request' : 'requests'}</p>`
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

export function renderArchivePage({ videos, media = [], query = '', month: rawMonth = '', page = 1, capped = false, mediaUnavailable = false, previewNotice = '' }) {
  const q = String(query || '').trim().slice(0, 100)
  const month = cleanMonth(rawMonth)
  const hasFilter = !!q || !!month
  const normalized = q.toLocaleLowerCase('en')
  const filtered = (videos || []).filter(video =>
    !normalized || `${video.artist} ${video.title} ${video.kind}`.toLocaleLowerCase('en').includes(normalized))
  const galleryMonths = [...new Set((media || []).map(video => addedMonth(video.createdAt)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))
  // The month filter belongs only to this separately curated channel list;
  // q belongs only to completed community requests above.
  const gallery = (media || []).filter(video => !month || addedMonth(video.createdAt) === month)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(cleanPage(page), pages)
  const start = (currentPage - 1) * PAGE_SIZE
  const visible = filtered.slice(start, start + PAGE_SIZE)
  const canonical = new URL('/archive', SITE)
  if (!hasFilter && currentPage > 1) canonical.searchParams.set('page', String(currentPage))
  const canonicalHref = canonical.href
  const robots = hasFilter ? 'noindex,follow' : 'index,follow'
  const title = 'Completed Videos | Chaereve'
  const description = 'Browse color-coded lyric videos made from completed community requests. Search by artist, song, or video type.'
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
  const cappedNotice = capped
    ? '<p class="notice">The archive currently checks the latest 5,000 completed requests; older entries may not appear yet.</p>'
    : ''
  const content = visible.length
    ? `<div class="grid">${visible.map(card).join('')}</div>${pager}${cappedNotice}`
    : q
      ? `<section class="empty"><h3>No matching videos</h3><p>No completed videos match “${esc(q)}”. Try a different artist, song, or video type.</p><a href="${esc(pageUrl(1, '', month))}">Clear search</a></section>`
      : '<section class="empty"><h3>No completed videos yet</h3><p>Videos will appear here after a community request is completed and linked to YouTube.</p></section>'
  const monthValues = [...new Set([...galleryMonths, ...(month ? [month] : [])])]
    .sort((a, b) => b.localeCompare(a))
  const monthOptions = monthValues.map(value =>
    `<option value="${esc(value)}"${month === value ? ' selected' : ''}>${esc(monthLabel(value))}</option>`).join('')
  const resultCount = `<strong>${filtered.length}</strong> <span>${filtered.length === 1 ? 'video' : 'videos'}${q
    ? ` matching “${esc(q)}”`
    : ' in the archive'}</span>`
  const archiveSearch = `<form class="search" action="/archive" method="get" role="search" aria-label="Search completed videos">
    <label class="sr-only" for="q">Search by artist, song, or video type</label>
    <input id="q" name="q" type="search" maxlength="100" placeholder="Artist, song, or video type" value="${esc(q)}" autocomplete="off">
    ${month ? `<input type="hidden" name="month" value="${esc(month)}">` : ''}
    <button type="submit">Search archive</button>
    ${q ? `<a class="clear-search" href="${esc(pageUrl(1, '', month))}">Clear</a>` : ''}
  </form>`
  const galleryFilterForm = mediaUnavailable ? '' : `<form class="gallery-filter" action="/archive" method="get" aria-label="Filter channel videos by month">
    ${q ? `<input type="hidden" name="q" value="${esc(q)}">` : ''}
    ${currentPage > 1 ? `<input type="hidden" name="page" value="${currentPage}">` : ''}
    <label class="sr-only" for="month">Month the video was added to the site list</label>
    <select id="month" name="month"><option value="">All months</option>${monthOptions}</select>
    <button type="submit">Apply</button>
    ${month ? `<a href="${esc(pageUrl(currentPage, q, ''))}">Clear month</a>` : ''}
  </form>`
  const galleryContent = mediaUnavailable
    ? '<p class="gallery-state" role="status">The channel video list is temporarily unavailable. The completed-request archive above is unaffected.</p>'
    : gallery.length
      ? `<div class="gallery-grid">${gallery.map(mediaCard).join('')}</div>`
      : month
        ? `<p class="gallery-state">No channel videos were added to the site list in ${esc(monthLabel(month))}.</p>`
        : '<p class="gallery-state">No additional channel videos are listed yet.</p>'
  const gallerySection = `<section class="gallery" id="channel-gallery" aria-labelledby="gallery-title">
    <div class="section-head">
      <div><p class="eyebrow">A separate channel collection</p><h2 id="gallery-title">More from the channel</h2>
        <p class="gallery-note">These are curated channel videos, separate from the completed community requests above. The month filter uses the date an item was added to this site.</p></div>
      ${mediaUnavailable ? '' : `<p class="count">${gallery.length} ${gallery.length === 1 ? 'video' : 'videos'}</p>`}
    </div>
    ${galleryFilterForm}
    ${galleryContent}${media.length >= MEDIA_LIMIT ? '<p class="notice">Showing up to 50 curated channel videos.</p>' : ''}
  </section>`
  const previewNoticeHtml = previewNotice
    ? `<p class="preview-note" role="status">${esc(previewNotice)}</p>`
    : ''

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
    @font-face { font-family: "Be Vietnam Pro"; src: url("/fonts/bvp-400.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Be Vietnam Pro"; src: url("/fonts/bvp-500.woff2") format("woff2"); font-weight: 500; font-display: swap; }
    @font-face { font-family: "Be Vietnam Pro"; src: url("/fonts/bvp-600.woff2") format("woff2"); font-weight: 600; font-display: swap; }
    @font-face { font-family: "Be Vietnam Pro"; src: url("/fonts/bvp-700.woff2") format("woff2"); font-weight: 700; font-display: swap; }
    @font-face { font-family: "Archivo Display"; src: url("/fonts/archivo-display.woff2") format("woff2"); font-weight: 700; font-display: swap; }
    @font-face { font-family: "JetBrains Mono"; src: url("/fonts/jetbrains-mono.woff2") format("woff2-variations"); font-weight: 100 800; font-display: swap; }
    :root {
      color-scheme: dark;
      --bg: #0a0c10;
      --bg-2: #0e1116;
      --panel: rgba(16,20,26,.94);
      --panel-2: rgba(22,26,33,.92);
      --line: #212934;
      --line-2: #2f3a47;
      --text: #e9edf3;
      --muted: #9aa4b2;
      --quiet: #808b9a;
      --accent: #a9a4ff;
      --accent-strong: #c2beff;
      --radius: 10px;
      --display: "Archivo Display", "Be Vietnam Pro", sans-serif;
      --font: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      min-height: 100vh;
      margin: 0;
      background: radial-gradient(760px 390px at 52% -230px, rgba(77,64,240,.16), transparent 75%), var(--bg);
      color: var(--text);
      font: 14px/1.6 var(--font);
    }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    a { color: inherit; }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .wrap { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
    .top { position: sticky; top: 0; z-index: 5; border-bottom: 1px solid rgba(33,41,52,.86); background: rgba(10,12,16,.88); backdrop-filter: blur(16px); }
    .top-in { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    .brand { color: var(--text); font-size: 12px; font-weight: 700; letter-spacing: .13em; text-decoration: none; }
    .nav { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; }
    .nav a { padding: 8px 11px; border: 1px solid transparent; border-radius: 8px; text-decoration: none; transition: color .18s, background .18s, border-color .18s; }
    .nav a:hover { color: var(--text); background: rgba(255,255,255,.04); }
    .nav a[aria-current="page"] { color: var(--accent-strong); border-color: rgba(169,164,255,.18); background: rgba(77,64,240,.12); }
    main { padding-bottom: 52px; }
    .hero { padding: clamp(46px, 7vw, 76px) 0 30px; }
    .preview-note { padding: 10px 13px; margin: 0 0 20px; border: 1px solid rgba(245,165,36,.3); border-radius: 8px; background: rgba(245,165,36,.08); color: #f3d6a8; font-size: 12px; }
    .eyebrow { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; margin: 0 0 8px; }
    h1, h2, h3 { font-family: var(--display); }
    h1 { max-width: 780px; margin: 0; font-size: clamp(36px, 6vw, 58px); font-weight: 700; line-height: 1.04; letter-spacing: -.035em; text-wrap: balance; }
    .intro { max-width: 620px; margin: 14px 0 23px; color: var(--muted); font-size: 14px; }
    .search { display: flex; align-items: center; gap: 8px; max-width: 760px; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: 0 10px 30px -14px rgba(0,0,0,.7); }
    .search input { flex: 1 1 auto; min-width: 0; min-height: 42px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); color: var(--text); font: inherit; }
    .search input::placeholder { color: var(--quiet); }
    .search input:focus, .gallery-filter select:focus { border-color: rgba(169,164,255,.65); outline-offset: 1px; }
    .search button, .gallery-filter button { min-height: 42px; padding: 0 15px; border: 0; border-radius: 8px; background: #4d40f0; color: #fff; font: 600 12px var(--font); cursor: pointer; transition: background .18s, transform .18s; }
    .search button:hover, .gallery-filter button:hover { background: #6257ff; transform: translateY(-1px); }
    .clear-search { padding: 8px 10px; color: var(--muted); font-size: 12px; text-decoration: none; white-space: nowrap; }
    .clear-search:hover { color: var(--text); }
    .archive-results { padding-top: 8px; }
    .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
    .section-head h2 { margin: 0; font-size: clamp(24px, 3.8vw, 32px); font-weight: 700; line-height: 1.15; letter-spacing: -.02em; }
    .section-head .eyebrow { margin-bottom: 5px; }
    .section-note { max-width: 600px; margin: 6px 0 0; color: var(--quiet); font-size: 12px; }
    .count { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; padding: 7px 10px; border: 1px solid var(--line); border-radius: 999px; background: rgba(22,26,33,.72); color: var(--muted); font-size: 11px; white-space: nowrap; }
    .count strong { color: var(--text); font: 600 12px "JetBrains Mono", ui-monospace, monospace; }
    .grid, .gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding-bottom: 20px; }
    .video-card, .gallery-card { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(145deg, var(--panel-2), rgba(16,20,26,.96)); box-shadow: 0 10px 26px rgba(0,0,0,.14); transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease; }
    .video-card:hover, .gallery-card:hover { transform: translateY(-3px); border-color: rgba(169,164,255,.42); box-shadow: 0 16px 36px rgba(0,0,0,.25); }
    .thumb, .gallery-thumb { display: block; position: relative; aspect-ratio: 16/9; overflow: hidden; background: #080a0e; }
    .thumb::after, .gallery-thumb::after { content: ""; position: absolute; inset: 40% 0 0; background: linear-gradient(transparent, rgba(5,6,10,.32)); pointer-events: none; }
    .thumb img, .gallery-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .4s cubic-bezier(.2,.7,.2,1); }
    .video-card:hover .thumb img, .gallery-card:hover .gallery-thumb img { transform: scale(1.035); }
    .play { position: absolute; z-index: 1; left: 50%; top: 50%; display: grid; width: 42px; height: 32px; place-items: center; transform: translate(-50%,-50%); border: 1px solid rgba(255,255,255,.25); border-radius: 8px; background: rgba(10,12,16,.78); color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.3); transition: background .18s, color .18s, transform .18s; }
    .video-card:hover .play, .gallery-card:hover .play { transform: translate(-50%,-50%) scale(1.06); background: var(--accent); color: #111321; }
    .card-body { padding: 13px 14px 15px; }
    .kind { display: inline-flex; margin: 0 0 7px; padding: 3px 7px; border: 1px solid rgba(169,164,255,.18); border-radius: 6px; background: rgba(77,64,240,.1); color: var(--accent-strong); font-size: 9px; font-weight: 700; letter-spacing: .08em; line-height: 1.35; text-transform: uppercase; }
    .card-body h2, .card-body h3 { margin: 0; font: 600 15px/1.4 var(--display); text-wrap: balance; }
    .card-body h2 a, .card-body h3 a { text-decoration: none; }
    .card-body h2 a:hover, .card-body h3 a:hover { color: var(--accent-strong); }
    .card-note { margin: 8px 0 0; color: var(--quiet); font-size: 11px; }
    .pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; margin: 0 0 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(16,20,26,.78); color: var(--muted); font-size: 12px; }
    .pager a, .empty a, .gallery-filter a { color: var(--accent-strong); font-weight: 600; text-decoration: none; }
    .pager a:hover, .empty a:hover, .gallery-filter a:hover { text-decoration: underline; }
    .notice { margin: 10px 0 24px; color: var(--quiet); font-size: 11px; }
    .empty { padding: 26px; margin: 0 0 30px; border: 1px dashed var(--line-2); border-radius: var(--radius); background: rgba(16,20,26,.55); }
    .empty h3 { margin: 0 0 5px; font-size: 18px; }
    .empty p { max-width: 560px; margin: 0 0 10px; color: var(--muted); font-size: 12px; }
    .gallery { margin: 30px 0 0; padding: 28px 0 4px; border-top: 1px solid var(--line); }
    .gallery .section-head { margin-bottom: 15px; }
    .gallery-note, .gallery-state { max-width: 740px; margin: 7px 0 0; color: var(--quiet); font-size: 11px; line-height: 1.6; }
    .gallery-filter { display: flex; align-items: center; gap: 8px; margin: 0 0 15px; }
    .gallery-filter select { min-width: 170px; min-height: 38px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); color: var(--text); font: 12px var(--font); }
    .gallery-filter button { min-height: 38px; padding: 0 12px; font-size: 11px; }
    .gallery-filter a { margin-left: 3px; font-size: 11px; }
    .gallery-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding-bottom: 8px; }
    .gallery-grid .card-body { padding: 11px 12px 13px; }
    .gallery-grid .card-body h3 { font-size: 13px; }
    footer { padding: 19px 0 28px; border-top: 1px solid var(--line); color: var(--quiet); font-size: 11px; }
    footer .wrap { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    footer a { color: var(--muted); text-decoration: none; }
    footer a:hover { color: var(--text); }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .gallery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 620px) {
      .wrap { width: min(100% - 28px, 1120px); }
      .hero { padding-top: 42px; }
      .section-head { align-items: flex-start; flex-direction: column; gap: 9px; }
      .section-head .count { align-self: flex-start; }
      .gallery .section-head { margin-bottom: 12px; }
      .gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { gap: 10px; }
    }
    @media (max-width: 460px) {
      .top-in { min-height: 58px; }
      .nav { gap: 1px; font-size: 11px; }
      .nav a { padding: 7px 8px; }
      .search { flex-wrap: wrap; }
      .search input { flex: 1 1 100%; }
      .search button { flex: 1 1 auto; }
      .clear-search { text-align: center; }
      .grid, .gallery-grid { grid-template-columns: minmax(0, 1fr); }
      .card-body { padding: 12px 13px 14px; }
      .gallery-filter { flex-wrap: wrap; }
      .gallery-filter select { flex: 1 1 100%; }
      .gallery-filter button { flex: 1 1 auto; }
      .pager { padding: 11px; font-size: 11px; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    }
  </style>
</head>
<body>
  <header class="top"><div class="wrap top-in"><a class="brand" href="/">CHAEREVE</a><nav class="nav" aria-label="Main navigation"><a href="/">Board</a><a href="/archive" aria-current="page">Archive</a><a href="/faq.html">FAQ</a></nav></div></header>
  <main class="wrap">
    <section class="hero">
      ${previewNoticeHtml}<p class="eyebrow">Chaereve · public archive</p><h1>Completed videos</h1>
      <p class="intro">Color-coded lyric videos made from completed community requests. Search by artist, song, or video type, then watch on YouTube.</p>
      ${archiveSearch}
    </section>
    <section class="archive-results" aria-labelledby="archive-title">
      <div class="section-head"><div><p class="eyebrow">Community requests</p><h2 id="archive-title">Completed video archive</h2>
        <p class="section-note">Each YouTube video appears once. Repeated completed requests for the same video are grouped together.</p></div>
        <p class="count">${resultCount}</p>
      </div>
      ${content}
    </section>
    ${gallerySection}
  </main>
  <footer><div class="wrap"><span>Chaereve · Color-coded lyrics</span><span><a href="/">Request board</a> · <a href="/faq.html">FAQ</a> · <a href="/privacy.html">Privacy</a></span></div></footer>
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
