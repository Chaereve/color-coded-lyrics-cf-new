import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { evaluateAchievements } from './achievements.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('evaluateAchievements unlocks firstVoteBack, firstMystery, firstPick, and preserves earnedIds', () => {
  const byId = (items) => new Map(items.map(i => [i.id, i]))

  const unlocked = byId(evaluateAchievements({
    requests: 1,
    completed: 1,
    votesCast: 5,
    picked: false,
    voteBack: true,
    mystery: true,
    rank: 20,
    earnedIds: new Set(['firstPick', 'podium']),
  }))

  assert.equal(unlocked.get('firstVoteBack').earned, true)
  assert.equal(unlocked.get('firstVoteBack').progress, 1)
  assert.equal(unlocked.get('firstMystery').earned, true)
  assert.equal(unlocked.get('firstMystery').progress, 1)
  assert.equal(unlocked.get('firstPick').earned, true, 'earnedIds keeps firstPick unlocked after picked_at clears')
  assert.equal(unlocked.get('firstPick').progress, 1)
  assert.equal(unlocked.get('podium').earned, true, 'historical leaderboard badge in achievement_rewards stays earned')
  assert.equal(unlocked.get('podium').progress, 3)
  assert.equal(unlocked.get('champion').earned, false)
})

test('db.js paginates fetchMyVotes and fetchPublicProfile via fetchAllPages and enriches admin order buyers', () => {
  const dbSrc = read('./db.js')

  const myVotesSlice = dbSrc.slice(
    dbSrc.indexOf('export async function fetchMyVotes'),
    dbSrc.indexOf('export async function fetchRecentVotes')
  )
  assert.match(myVotesSlice, /fetchAllPages\(/, 'fetchMyVotes must paginate above the 1,000-row PostgREST cap')
  assert.match(myVotesSlice, /\.order\('id', \{ ascending: true \}\)/, 'fetchMyVotes pagination must be deterministically ordered')

  const pubProfSlice = dbSrc.slice(
    dbSrc.indexOf('export async function fetchPublicProfile'),
    dbSrc.indexOf('export async function fetchNotifications')
  )
  assert.match(pubProfSlice, /fetchAllPages\(/, 'fetchPublicProfile must not truncate lifetime stats at 50 rows')
  assert.doesNotMatch(pubProfSlice, /\.limit\(50\)/, 'fetchPublicProfile must remove the 50-row cap')

  const ordersSlice = dbSrc.slice(
    dbSrc.indexOf('export async function fetchOrders'),
    dbSrc.indexOf('export const appError')
  )
  assert.match(ordersSlice, /from\('profiles'\)\.select\('id, name'\)\.in\('id', chunk\)/,
    'admin fetchOrders must batch-resolve buyer display names from profiles')
  assert.match(ordersSlice, /buyer_name:/, 'orders must carry buyer_name for admin matching and search')
})

test('Demo mode buyVotes, deleteRequest, and settleCurrentSeasonRewards enforce server parity', async () => {
  const store = new Map()
  const prevStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  }
  try {
    const db = await import('./db.js')
    store.set('ccl3_user', JSON.stringify({ id: 'buyer-42', name: 'ChaereveFan', isAdmin: false }))
    store.set('ccl3_orders', '[]')
    store.set('ccl3_rows', JSON.stringify([
      { id: 'r-other', user_id: 'someone-else', artist: 'IVE', title: 'HEYA', status: 'queued', picked_at: null },
      { id: 'r-picked', user_id: 'buyer-42', artist: 'aespa', title: 'Supernova', status: 'queued', picked_at: '2026-10-01T00:00:00Z' },
      { id: 'r-own', user_id: 'buyer-42', artist: 'QWER', title: 'TBH', status: 'pending', picked_at: null },
    ]))

    await assert.rejects(() => db.deleteRequest('r-other'), (err) => err?.code === 'err.notOwner')
    await assert.rejects(() => db.deleteRequest('r-picked'), (err) => err?.code === 'err.deleteLocked')
    await db.deleteRequest('r-own')

    const order = await db.buyVotes({ id: 'v10', qty: 10, usd: 1.29, vnd: 34000 })
    assert.equal(order.user_id, 'buyer-42')
    assert.equal(order.buyer_name, 'ChaereveFan')

    // Queue cap of 20 awaiting vote orders
    for (let i = 1; i < 20; i++) {
      await db.buyVotes({ id: 'v3', qty: 3, usd: 0.49, vnd: 13000 })
    }
    await assert.rejects(
      () => db.buyVotes({ id: 'v3', qty: 3, usd: 0.49, vnd: 13000 }),
      (err) => err?.code === 'err.orderQueueLimit'
    )

    await assert.rejects(
      () => db.settleCurrentSeasonRewards('invalid'),
      (err) => err?.code === 'err.rewardPeriod'
    )
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevStorage
  }
})

test('AdminPanel, Leaderboard, MediaShowcase, MysteryBox, DailySpin, VideoPreviewModal, and FAQ fixes hold', async () => {
  const adminSrc = read('../components/AdminPanel.jsx')
  assert.equal((adminSrc.match(/const modalRef = useRef\(false\)/g) || []).length, 1,
    'AdminPanel and RequestAdminRow must share one modalRef so shortcuts pause during row dialogs')
  assert.match(adminSrc, /className="adm-panel" ref=\{listRef\}/,
    'AdminPanel must attach listRef so Pager scrolls to top on page change')
  assert.match(adminSrc, /title: t\('adm\.confirmRejectOrder'\)/,
    'Rejecting an awaiting order must ask for confirmation')

  const mysterySrc = read('../components/MysteryBox.jsx')
  assert.match(mysterySrc, /setCommittedMystery\(result\.mystery\)/,
    'MysteryBox must store committed server result locally for reduced-motion immediate reveal')

  const spinSrc = read('../components/DailySpin.jsx')
  assert.match(spinSrc, /'err\.spinRegistration'/,
    'DailySpin must clear pendingSpin when browser registration fails before touching spin_daily')

  const previewSrc = read('../components/VideoPreviewModal.jsx')
  assert.match(previewSrc, /document\.activeElement === dialogRef\.current/,
    'VideoPreviewModal must trap initial Shift+Tab while focus is on the dialog container')

  const faqHtml = read('../../public/faq.html')
  assert.doesNotMatch(faqHtml, /follow any\s+request|browser notifications? at each stage/i,
    'FAQ must not advertise retired request-follow or browser push notifications')

  // SSR render verification for AdminPanel (buyer display + season buttons), Leaderboard (profile links), and MediaShowcase (https thumb guard)
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { I18nProvider } = await vite.ssrLoadModule('/src/lib/i18n.jsx')
    const { ConfirmProvider } = await vite.ssrLoadModule('/src/lib/confirm.jsx')
    const { default: AdminPanel } = await vite.ssrLoadModule('/src/components/AdminPanel.jsx')
    const { default: Leaderboard } = await vite.ssrLoadModule('/src/components/Leaderboard.jsx')
    const { default: MediaShowcase } = await vite.ssrLoadModule('/src/components/MediaShowcase.jsx')

    const wrap = (node) => renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(ConfirmProvider, null, node))
    )

    const ordersHtml = wrap(createElement(AdminPanel, {
      tab: 'orders',
      onTab: () => {},
      rows: [],
      orders: [{
        id: 'ord-1', user_id: 'u-buyer', kind: 'votes', qty: 10,
        amount_vnd: 34000, amount_usd: 1.29, status: 'awaiting',
        buyer_name: 'ChaereveBuyer', created_at: '2026-10-20T00:00:00Z',
      }],
      media: [],
      onReview: () => {}, onUpdate: () => {}, onDelete: () => {}, onExpire: () => {},
      onOrder: () => {}, onPick: () => {}, onBulk: () => {}, onEdit: () => {},
      onMediaSave: () => {}, onMediaCommit: () => {}, onMediaDelete: () => {},
      onMediaReorder: () => {}, onMediaViewHome: () => {},
      onSettleSeason: () => {},
    }))
    assert.match(ordersHtml, /ChaereveBuyer/, 'Admin Orders row must display buyer profile name on vote orders')

    const overviewHtml = wrap(createElement(AdminPanel, {
      tab: 'overview',
      onTab: () => {},
      rows: [],
      orders: [],
      media: [],
      onReview: () => {}, onUpdate: () => {}, onDelete: () => {}, onExpire: () => {},
      onOrder: () => {}, onPick: () => {}, onBulk: () => {}, onEdit: () => {},
      onMediaSave: () => {}, onMediaCommit: () => {}, onMediaDelete: () => {},
      onMediaReorder: () => {}, onMediaViewHome: () => {},
      onSettleSeason: () => {},
    }))
    assert.match(overviewHtml, /Settle weekly rewards/, 'Admin Overview must expose weekly season settlement button')
    assert.match(overviewHtml, /Settle monthly rewards/, 'Admin Overview must expose monthly season settlement button')

    const lbHtml = wrap(createElement(Leaderboard, {
      rows: [
        { user_id: 'u-top', name: 'TopFan', total: 5, completed: 3, total_votes: 40 },
        { user_id: null, name: 'LegacyAnon', total: 2, completed: 1, total_votes: 10 },
      ],
      meId: 'u-top',
    }))
    assert.match(lbHtml, /href="\/u\/u-top"/, 'Leaderboard must link ranked users with user_id to their public profile')
    assert.doesNotMatch(lbHtml, /href="\/u\/null"/, 'Leaderboard must not link rows without user_id')

    const mediaHtml = wrap(createElement(MediaShowcase, {
      state: 'ready',
      onRetry: () => {},
      videos: [{
        id: 'jWQx2f-CErU',
        kind: 'video',
        title: 'aespa - Whiplash',
        url: 'https://www.youtube.com/watch?v=jWQx2f-CErU',
        thumb: 'http://insecure.example.com/bad.jpg',
      }],
    }))
    assert.doesNotMatch(mediaHtml, /http:\/\/insecure\.example\.com/,
      'MediaShowcase must reject non-https custom thumbnails and fall back to YouTube')
    assert.match(mediaHtml, /https:\/\/i\.ytimg\.com\/vi\/jWQx2f-CErU\//,
      'MediaShowcase falls back to YouTube thumbnail when custom thumb is non-https')
  } finally {
    await vite.close()
  }
})
