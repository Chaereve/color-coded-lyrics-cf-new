import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest, renderArchivePage, archiveVideos, archiveMedia } from '../../functions/archive.js'

const injectedCall = String.fromCharCode(97, 108, 101, 114, 116) + String.fromCharCode(40, 49, 41)
const injectedImage = `<img src=x onerror=${injectedCall}>`
const injectedTitle = `</script><script>${injectedCall}</script>`
const rows = [
  {
    artist: injectedImage,
    title: injectedTitle,
    kind: 'Full Album', status: 'completed',
    video_url: 'https://youtu.be/dQw4w9WgXcQ',
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-05T00:00:00Z',
  },
  {
    artist: 'Artist', title: 'Duplicate request', kind: 'Song', status: 'completed',
    video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-04T00:00:00Z',
  },
  {
    artist: 'Queued Artist', title: 'Not done', kind: 'Song', status: 'queued',
    video_url: 'https://youtu.be/abcdefghi', created_at: '2026-09-02T00:00:00Z',
  },
]

const mediaRows = [
  {
    kind: 'featured', title: 'Spring Feature', url: 'https://youtu.be/aBcDeF12345',
    thumb: 'https://covers.example.test/spring.webp', created_at: '2026-03-01T01:00:00Z',
    position: 0, is_hidden: false,
  },
  {
    kind: 'video', title: 'Winter Upload', url: 'https://youtu.be/zYxWvU98765',
    thumb: 'http://covers.example.test/winter.webp', created_at: '2026-02-28T16:59:00Z',
    position: 1, is_hidden: false,
  },
  {
    kind: 'video', title: 'Hidden title', url: 'https://youtu.be/Hidden12345',
    created_at: '2026-03-02T00:00:00Z', position: 2, is_hidden: true,
  },
  {
    kind: 'playlist', title: 'Playlist', url: 'https://youtube.com/playlist?list=PL12345',
    created_at: '2026-03-02T00:00:00Z', position: 3, is_hidden: false,
  },
]

const originalFetch = () => globalThis.fetch

test('archive server-renders completed videos, deduplicates YouTube IDs and escapes untrusted text', async () => {
  const before = originalFetch()
  const called = []
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    called.push({ url: parsed, init })
    const data = parsed.pathname.endsWith('/media') ? mediaRows : rows
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const response = await onRequest({
      request: new Request('https://chaereve.pages.dev/archive'),
      env: { SUPABASE_URL: 'https://db.example.test/', SUPABASE_ANON_KEY: 'not-in-html' },
    })
    const html = await response.text()
    assert.equal(response.status, 200)
    const requestQuery = called.find(item => item.url.pathname.endsWith('/requests'))
    const mediaQuery = called.find(item => item.url.pathname.endsWith('/media'))
    assert.ok(requestQuery && mediaQuery, 'requests and the separate public media gallery are queried')
    assert.equal(requestQuery.url.searchParams.get('status'), 'eq.completed', 'server, not the browser, fixes status')
    assert.equal(requestQuery.url.searchParams.get('video_url'), 'not.is.null')
    assert.doesNotMatch(requestQuery.url.searchParams.get('select'), /user_id|requester/)
    assert.equal(requestQuery.init.headers.apikey, 'not-in-html')
    assert.equal(mediaQuery.url.searchParams.get('is_hidden'), 'eq.false')
    assert.equal(mediaQuery.url.searchParams.get('kind'), 'in.(featured,video)')
    assert.equal(mediaQuery.url.searchParams.get('limit'), '50')
    assert.doesNotMatch(mediaQuery.url.searchParams.get('select'), /user_id|requester/)
    assert.ok(!html.includes('not-in-html'), 'the public anon key is not reflected into the page')
    assert.match(response.headers.get('content-security-policy') || '', /img-src 'self' https:/)
    assert.doesNotMatch(html, /<script(?! type="application\/ld\+json")/i,
      'the archive has structured data but no client-side JavaScript')
    const escapedImage = injectedImage.replace('<', '&lt;').replace('>', '&gt;')
    assert.ok(html.includes(escapedImage))
    assert.ok(!html.includes(injectedImage))
    assert.equal((html.match(/class="video-card"/g) || []).length, 1, 'same YouTube ID renders only once')
    assert.match(html, /Community favorite · 2 requests/)
    assert.match(html, /Cover gallery/)
    assert.ok(html.includes('https://covers.example.test/spring.webp'), 'use the curated cover image')
    assert.ok(!html.includes('http://covers.example.test/winter.webp'), 'reject insecure cover URLs')
    assert.ok(!html.includes('Hidden title') && !html.includes('Playlist'), 'hidden records and playlists are excluded')
    assert.match(html, /not when the video was completed or published on YouTube/)
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
    assert.equal(ld['@type'], 'CollectionPage')
    assert.equal(ld.mainEntity.itemListElement.length, 1)
    assert.equal(ld.mainEntity.itemListElement[0].item['@type'], 'VideoObject')
    assert.equal(ld.mainEntity.itemListElement[0].item.embedUrl,
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    assert.equal(ld.hasPart.numberOfItems, 2)
    const galleryVideo = ld.hasPart.itemListElement[0].item
    assert.equal(galleryVideo.thumbnailUrl, 'https://covers.example.test/spring.webp')
    assert.equal('uploadDate' in galleryVideo, false)
    assert.equal('publisher' in galleryVideo, false)
    assert.equal('description' in galleryVideo, false)
    assert.equal('uploadDate' in ld.mainEntity.itemListElement[0].item, false,
      'do not invent a YouTube publication date from request timestamps')
    assert.equal('publisher' in ld.mainEntity.itemListElement[0].item, false,
      'do not assume the YouTube channel from the request record')
    assert.equal('description' in ld.mainEntity.itemListElement[0].item, false,
      'do not invent a YouTube description from request fields')
  } finally { globalThis.fetch = before }
})

test('curated gallery uses visible media records, safe thumbnails, VN add-months and a hard 50-item cap', () => {
  const gallery = archiveMedia(mediaRows)
  assert.equal(gallery.length, 2)
  assert.equal(gallery[0].title, 'Spring Feature')
  assert.equal(gallery[0].thumb, 'https://covers.example.test/spring.webp')
  assert.equal(gallery[1].thumb, '', 'HTTP cover falls back to the YouTube thumbnail')

  const march = renderArchivePage({ videos: [], media: gallery, month: '2026-03' })
  assert.match(march, /Spring Feature/)
  assert.doesNotMatch(march, /Winter Upload/)
  assert.match(march, /<option value="2026-03" selected>March 2026<\/option>/)
  assert.match(march, /name="robots" content="noindex,follow"/)
  assert.match(march, /name="month"/)

  const many = Array.from({ length: 60 }, (_, i) => ({
    kind: 'video', title: `Video ${i}`, url: `https://youtu.be/${String(i).padStart(11, '0')}`,
    position: i, created_at: '2026-03-01T00:00:00Z', is_hidden: false,
  }))
  assert.equal(archiveMedia(many).length, 50)
})

test('archive search filters artist/title/type and pagination uses stable canonical links', () => {
  const videos = Array.from({ length: 30 }, (_, i) => ({
    id: `video_${String(i).padStart(4, '0')}`,
    artist: i === 28 ? 'Chung Ha' : 'Artist',
    title: i === 28 ? 'Dream of You' : `Song ${i}`,
    kind: 'Song', requestCount: 1,
  }))
  const filtered = renderArchivePage({ videos, query: 'chung ha' })
  assert.match(filtered, /1 video matching “chung ha”/)
  assert.match(filtered, /Dream of You/)
  assert.match(filtered, /name="robots" content="noindex,follow"/)

  const page = renderArchivePage({ videos, page: 2, query: 'song' })
  assert.match(page, /Page 2 of 2/)
  assert.match(page, /href="\/archive\?q=song" rel="prev"/)
  const firstPage = renderArchivePage({ videos, page: 1, query: 'song' })
  assert.match(firstPage, /href="\/archive\?page=2&amp;q=song" rel="next"/)
  const canonicalPage2 = renderArchivePage({ videos, page: 2 })
  assert.match(canonicalPage2, /rel="canonical" href="https:\/\/chaereve\.pages\.dev\/archive\?page=2"/)
  assert.match(canonicalPage2, /name="robots" content="index,follow"/)
})

test('only completed rows with valid YouTube IDs enter archive structured data', () => {
  const videos = archiveVideos(rows)
  assert.equal(videos.length, 1)
  assert.equal(videos[0].id, 'dQw4w9WgXcQ')
  assert.equal(videos[0].requestCount, 2)
})

test('media gallery upstream failure degrades without hiding completed requests', async () => {
  const before = originalFetch()
  globalThis.fetch = async url => new URL(url).pathname.endsWith('/media')
    ? new Response('unavailable', { status: 503 })
    : new Response(JSON.stringify(rows), { status: 200 })
  try {
    const response = await onRequest({
      request: new Request('https://chaereve.pages.dev/archive'),
      env: { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon' },
    })
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /The channel gallery is temporarily unavailable/)
    assert.match(html, /Completed color-coded lyrics/)
  } finally { globalThis.fetch = before }
})

test('archive database/config failures are private, non-cacheable service errors', async () => {
  const before = originalFetch()
  try {
    const missingConfig = await onRequest({ request: new Request('https://chaereve.pages.dev/archive'), env: {} })
    assert.equal(missingConfig.status, 503)
    assert.equal(missingConfig.headers.get('cache-control'), 'no-store')
    assert.match(await missingConfig.text(), /Archive temporarily unavailable/)

    globalThis.fetch = async () => new Response('database details must not leak', { status: 500 })
    const upstream = await onRequest({
      request: new Request('https://chaereve.pages.dev/archive'),
      env: { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'secret' },
    })
    assert.equal(upstream.status, 503)
    assert.doesNotMatch(await upstream.text(), /database details|secret/)
  } finally { globalThis.fetch = before }
})

test('HEAD avoids querying Supabase; writes are rejected', async () => {
  const before = originalFetch()
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch') }
  try {
    const head = await onRequest({ request: new Request('https://chaereve.pages.dev/archive', { method: 'HEAD' }), env: {} })
    assert.equal(head.status, 200)
    const post = await onRequest({ request: new Request('https://chaereve.pages.dev/archive', { method: 'POST' }), env: {} })
    assert.equal(post.status, 405)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = before }
})
