import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { attachVisibleDenialReasons, markNotificationsRead, mergeBoardRows } from './db.js'
import { gateShouldFallback } from './gateFallback.js'
import { readDemoWallet, creditDemoRewards } from './demoWallet.js'
import { claimDailyLoginCalendar } from './dailyLoginCalendar.js'
import { openMysteryBox } from './mysteryBox.js'
import { spinDay } from './dailySpin.js'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')

async function withMemoryStorage(fn) {
  const prev = globalThis.localStorage
  const map = new Map()
  globalThis.localStorage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => { map.set(key, String(val)) },
    removeItem: key => { map.delete(key) },
    clear: () => { map.clear() },
  }
  try {
    return await fn(map)
  } finally {
    globalThis.localStorage = prev
  }
}

test('attachVisibleDenialReasons skips RPC when no rows are denied or when visitor is anonymous', async () => {
  let rpcCalls = 0
  const guestClient = {
    auth: { async getSession() { return { data: { session: null } } } },
    async rpc() { rpcCalls++; return { data: [], error: null } },
  }

  // Case 1: denied row present, but anonymous guest -> zero RPC calls & strip stray deny_reason
  const guestRows = await attachVisibleDenialReasons([
    { id: 'r1', status: 'denied', deny_reason: 'leaked-cache' },
    { id: 'r2', status: 'queued' },
  ], guestClient)
  assert.equal(rpcCalls, 0, 'anonymous visitors must not invoke get_visible_denial_reasons')
  assert.equal(guestRows[0].deny_reason, null)

  // Case 2: signed-in user, but zero denied rows -> zero RPC calls
  const authedClient = {
    auth: { async getSession() { return { data: { session: { access_token: 'jwt' } } } } },
    async rpc(name) {
      assert.equal(name, 'get_visible_denial_reasons')
      rpcCalls++
      return { data: [{ id: 'r1', deny_reason: 'Visible to owner' }], error: null }
    },
  }
  const activeOnly = await attachVisibleDenialReasons([
    { id: 'r2', status: 'queued' },
    { id: 'r3', status: 'completed' },
  ], authedClient)
  assert.equal(rpcCalls, 0, 'skip RPC when board contains no denied rows')
  assert.equal(activeOnly.length, 2)

  // Case 3: signed-in user + denied row -> RPC runs and hydrates matching row only
  const withDenied = await attachVisibleDenialReasons([
    { id: 'r1', status: 'denied' },
    { id: 'r4', status: 'denied' },
  ], authedClient)
  assert.equal(rpcCalls, 1)
  assert.equal(withDenied[0].deny_reason, 'Visible to owner')
  assert.equal(withDenied[1].deny_reason, null)
})

test('mergeBoardRows preserves older active requests alongside 800+ closed rows and deduplicates transitions', () => {
  const closed = Array.from({ length: 800 }, (_, i) => ({
    id: `closed-${i}`,
    status: 'completed',
    created_at: new Date(Date.parse('2026-10-20T00:00:00Z') - i * 60_000).toISOString(),
    updated_at: '2026-10-20T00:00:00Z',
  }))
  const oldActive = {
    id: 'active-old',
    status: 'queued',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  }
  // Mid-flight transition: appeared in openRows first, then completed in closedRows with newer updated_at
  const midFlightOpen = {
    id: 'mid-1',
    status: 'in_progress',
    created_at: '2026-10-21T00:00:00Z',
    updated_at: '2026-10-21T01:00:00Z',
  }
  const midFlightClosed = {
    id: 'mid-1',
    status: 'completed',
    created_at: '2026-10-21T00:00:00Z',
    updated_at: '2026-10-21T02:00:00Z',
  }

  const merged = mergeBoardRows([oldActive, midFlightOpen], [midFlightClosed, ...closed])
  assert.equal(merged.length, 802)
  assert.equal(merged.find(r => r.id === 'active-old')?.status, 'queued', 'old active request is never evicted by 800 closed rows')
  assert.equal(merged.find(r => r.id === 'mid-1')?.status, 'completed', 'newer updated_at wins on mid-flight transition')
  assert.equal(merged[0].id, 'mid-1', 'sorted newest created_at first')

  const dbSrc = read('./db.js')
  assert.match(dbSrc, /\.in\('status', \['pending', 'queued', 'in_progress'\]\)/)
  assert.match(dbSrc, /\.in\('status', \['completed', 'denied'\]\)/)
})

test('Mystery Box Edge fallback covers err.mysterySetup, err.mysteryGate, and network gateDown', () => {
  assert.equal(gateShouldFallback({
    status: 503,
    contentType: 'application/json',
    payload: { error: 'err.mysterySetup' },
  }), true)
  assert.equal(gateShouldFallback({
    status: 503,
    contentType: 'application/json',
    payload: { error: 'err.mysteryGate' },
  }), true)
  assert.equal(gateShouldFallback({
    status: 500,
    contentType: 'application/json',
    payload: { error: 'err.mysteryGate' },
  }), true)

  const mysterySrc = read('./mysteryBox.js')
  assert.match(mysterySrc, /if \(!e\?\.gateDown\) throw e[\s\S]{0,120}mysteryRpc\('open_mystery_box'/,
    'openMysteryBox must catch gateDown and fall back to mysteryRpc')
})

test('Demo Mode Daily Login and Mystery Box credit ccl3_prof once and do not double-credit on replay', async () => {
  await withMemoryStorage(async () => {
    const today = spinDay()
    assert.equal(readDemoWallet().bonus_credits, 0)

    const firstClaim = await claimDailyLoginCalendar('demo-user', today)
    assert.equal(firstClaim.replayed, false)
    const afterClaim = readDemoWallet().bonus_credits
    assert.ok(afterClaim >= 2, 'daily login check-in credits bonus votes into demo wallet')

    const replayClaim = await claimDailyLoginCalendar('demo-user', today)
    assert.equal(replayClaim.replayed, true)
    assert.equal(readDemoWallet().bonus_credits, afterClaim, 'replayed check-in must not double-credit')

    // Find a userId that rolls a positive reward today so we verify mystery wallet credit too
    let winnerId = 'demo-user'
    for (let i = 0; i < 200; i++) {
      const candidate = `demo-winner-${i}`
      await claimDailyLoginCalendar(candidate, today)
      const before = readDemoWallet()
      const opened = await openMysteryBox(candidate, today)
      if (opened.mystery.reward_kind !== 'nothing') {
        winnerId = candidate
        const after = readDemoWallet()
        if (opened.mystery.reward_kind === 'votes') {
          assert.equal(after.bonus_credits, before.bonus_credits + opened.mystery.reward_votes)
        } else if (opened.mystery.reward_kind === 'free_paid_request') {
          assert.ok(after.bonus_requests > before.bonus_requests)
        }
        const beforeReplay = readDemoWallet()
        const replayed = await openMysteryBox(winnerId, today)
        assert.equal(replayed.replayed, true)
        assert.deepEqual(readDemoWallet(), beforeReplay, 'replayed mystery open must not double-credit')
        break
      }
    }

    creditDemoRewards({ votes: 0, requests: 0 })
  })
})

test('App refreshes wallet after Daily Login / Mystery Box and purges private account state on sign-out', () => {
  const appSrc = read('../App.jsx')
  assert.match(appSrc, /<DailyLogin[^>]*onReward=\{refreshWalletBalance\}/)
  assert.ok(appSrc.includes("<MysteryBoxPage key={`mystery-${user.id}`} userId={user.id} onDailyLogin={() => navTo('login')} onReward={refreshWalletBalance} />"))
  assert.match(appSrc, /DAILY_LOGIN_CALENDAR_SYNC_KEY/)
  assert.match(appSrc, /MYSTERY_SYNC_KEY/)

  const signOutIdx = appSrc.indexOf('const doSignOut =')
  const signOutBlock = appSrc.slice(signOutIdx, signOutIdx + 900)
  assert.match(signOutBlock, /setMyVotes\(new Map\(\)\)/)
  assert.match(signOutBlock, /setOrders\(\[\]\)/)
  assert.match(signOutBlock, /setAchievementRequests\(\{ userId: null, rows: \[\] \}\)/)
  assert.match(signOutBlock, /deny_reason: null/)
})

test('backup-db.yml never uploads plaintext *.dump or *.sql files to GitHub Actions artifacts', () => {
  const wf = read('../../.github/workflows/backup-db.yml')
  assert.match(wf, /!backup\/\*\.dump/)
  assert.match(wf, /!backup\/\*\.sql/)
})

test('markNotificationsRead persists read_at by db id, by sig fallback, and for mark-all-read', async () => {
  const ops = []
  const makeClient = () => ({
    from(table) {
      const state = { table, payload: null, eqs: [], ins: [], isNull: [] }
      const chain = {
        update(payload) { state.payload = payload; return chain },
        eq(col, val) { state.eqs.push([col, val]); return chain },
        in(col, vals) { state.ins.push([col, vals]); return chain },
        async is(col, val) {
          state.isNull.push([col, val])
          ops.push(state)
          return { error: null }
        },
      }
      return chain
    },
  })

  const client = makeClient()
  await markNotificationsRead('u-1', {}, client)
  assert.equal(ops.length, 1)
  assert.deepEqual(ops[0].eqs, [['user_id', 'u-1']])
  assert.deepEqual(ops[0].ins, [])
  assert.ok(typeof ops[0].payload.read_at === 'string')

  await markNotificationsRead('u-1', { ids: ['db-42', 'local|approved:queued'], sigs: ['review|r1|queued'] }, client)
  assert.equal(ops.length, 2)
  assert.deepEqual(ops[1].ins, [['id', [42]]])

  await markNotificationsRead('u-1', { ids: ['local|approved:queued'], sigs: ['review|r1|queued'] }, client)
  assert.equal(ops.length, 3)
  assert.deepEqual(ops[2].ins, [['sig', ['review|r1|queued']]])
})

