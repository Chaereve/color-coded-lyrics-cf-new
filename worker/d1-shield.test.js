import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SHIELD_LIMIT, SHIELD_MAX_FP_PER_IP, VOTE_MAX_CALLS_PER_FP,
  shieldCheck, shieldCommit, voteShieldCheck, voteShieldCommit, vnDay,
} from './shield.js'

/* Minimal D1 adapter fake: executes the statements used by the shield without
   requiring Cloudflare bindings or Node's experimental SQLite API. */
class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.values = [] }
  bind(...values) { this.values = values; return this }
  async first() { return this.db.first(this.sql, this.values) }
  async run() { return this.db.run(this.sql, this.values) }
}
class FakeD1 {
  constructor() { this.counters = new Map(); this.ipFingerprints = new Set(); this.meta = new Map() }
  prepare(sql) { return new FakeStatement(this, sql) }
  key(day, scope, subject) { return `${day}|${scope}|${subject}` }
  async first(sql, values) {
    if (sql.includes('FROM edge_shield_meta')) return this.meta.has(values[0]) ? { value: this.meta.get(values[0]) } : null
    if (sql.includes('COUNT(*) AS n')) {
      const [fpHash, day, ipHash] = values
      const fps = [...this.ipFingerprints]
        .filter(key => key.startsWith(`${day}|${ipHash}|`))
        .map(key => key.split('|')[2])
      return { n: fps.length, seen: fps.includes(fpHash) ? 1 : 0 }
    }
    if (sql.includes('FROM edge_rate_counters')) {
      const row = this.counters.get(this.key(...values))
      return row ? { used: row.used, blocked: row.blocked } : null
    }
    throw new Error(`Unexpected D1 first(): ${sql}`)
  }
  async run(sql, values) {
    if (sql.startsWith('DELETE FROM edge_rate_counters')) {
      for (const [key] of this.counters) if (key.split('|')[0] < values[0]) this.counters.delete(key)
      return { success: true }
    }
    if (sql.startsWith('DELETE FROM edge_spin_ip_fingerprints')) {
      for (const key of this.ipFingerprints) if (key.split('|')[0] < values[0]) this.ipFingerprints.delete(key)
      return { success: true }
    }
    if (sql.includes('INSERT INTO edge_shield_meta')) {
      this.meta.set(values[0], values[1])
      return { success: true }
    }
    if (sql.includes("VALUES (?, 'spin_ip'")) {
      const key = this.key(values[0], 'spin_ip', values[1])
      const row = this.counters.get(key) || { used: 0, blocked: 0 }
      row.blocked = 1
      this.counters.set(key, row)
      return { success: true }
    }
    if (sql.includes("VALUES (?, 'spin_fp'") || sql.includes("VALUES (?, 'vote_fp'")) {
      const scope = sql.includes("'spin_fp'") ? 'spin_fp' : 'vote_fp'
      const key = this.key(values[0], scope, values[1])
      const row = this.counters.get(key) || { used: 0, blocked: 0 }
      row.used++
      this.counters.set(key, row)
      return { success: true }
    }
    if (sql.includes('INSERT OR IGNORE INTO edge_spin_ip_fingerprints')) {
      this.ipFingerprints.add(`${values[0]}|${values[1]}|${values[2]}`)
      return { success: true }
    }
    throw new Error(`Unexpected D1 run(): ${sql}`)
  }
  async batch(statements) {
    const snapshot = {
      counters: new Map([...this.counters].map(([k, v]) => [k, { ...v }])),
      ipFingerprints: new Set(this.ipFingerprints),
      meta: new Map(this.meta),
    }
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    } catch (error) {
      this.counters = snapshot.counters
      this.ipFingerprints = snapshot.ipFingerprints
      this.meta = snapshot.meta
      throw error
    }
  }
  countRows() { return this.counters.size + this.ipFingerprints.size }
}

const NOW = Date.parse('2026-09-08T10:00:00Z')
const ipHash = 'a'.repeat(64)
const fp = n => String(n).padStart(64, '0')
const checkSpin = (db, n, over = {}) => shieldCheck(db, {
  ip: 'must-not-be-stored', ipHash, fpHash: fp(n), nowMs: NOW, ...over,
})

test('D1 migration defines constrained, day-keyed tables without raw identity columns', () => {
  const sql = readFileSync(new URL('./migrations/0001_rate_shield.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS edge_rate_counters/)
  assert.match(sql, /PRIMARY KEY \(day, scope, subject_hash\)/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS edge_spin_ip_fingerprints/)
  assert.doesNotMatch(sql, /\braw_ip\b|\bip_address\b/i)
})

test('D1 spin counter enforces per-fingerprint cap and keeps IP/fingerprint scopes separate', async () => {
  const db = new FakeD1()
  for (let i = 0; i < SHIELD_LIMIT; i++) {
    assert.equal((await checkSpin(db, 1)).ok, true)
    await shieldCommit(db, { ip: 'raw-ip', ipHash, fpHash: fp(1), nowMs: NOW })
  }
  assert.deepEqual(await checkSpin(db, 1), { ok: false, reason: 'err.spinEdgeFp' })
  assert.equal((await checkSpin(db, 2)).ok, true, 'a different fingerprint on a shared IP is allowed')
  assert.ok(![...db.counters.keys()].some(key => key.includes('raw-ip')), 'raw IP is never written to D1')
})

test('D1 allows a 6th fingerprint on shared IP, including legacy blocked IP rows', async () => {
  const db = new FakeD1()
  for (let i = 1; i <= SHIELD_MAX_FP_PER_IP; i++) {
    assert.equal((await checkSpin(db, i)).ok, true)
    await shieldCommit(db, { ipHash, fpHash: fp(i), nowMs: NOW })
  }
  assert.equal((await checkSpin(db, 99)).ok, true)
  assert.equal((await checkSpin(db, 1)).ok, true)
  assert.equal((await checkSpin(db, 99, { nowMs: NOW + 86_400_000 })).ok, true)
  assert.equal(db.countRows(), 0)
})

test('D1 vote counter is independent, enforces its cap and does not store missing fingerprints', async () => {
  const db = new FakeD1()
  for (let i = 0; i < VOTE_MAX_CALLS_PER_FP; i++) {
    assert.equal((await voteShieldCheck(db, { fpHash: fp(7), nowMs: NOW })).ok, true)
    await voteShieldCommit(db, { fpHash: fp(7), nowMs: NOW })
  }
  assert.deepEqual(await voteShieldCheck(db, { fpHash: fp(7), nowMs: NOW }), {
    ok: false, reason: 'err.voteEdgeFp',
  })
  assert.equal((await checkSpin(db, 7)).ok, true, 'vote counts do not consume spin quota')
  const before = db.countRows()
  await voteShieldCommit(db, { fpHash: null, nowMs: NOW })
  assert.equal(db.countRows(), before, 'missing fingerprints create no counter row')
})

test('D1 cleanup and quota windows use Vietnam calendar days', () => {
  assert.equal(vnDay(Date.parse('2026-09-08T16:59:59.999Z')), '2026-09-08')
  assert.equal(vnDay(Date.parse('2026-09-08T17:00:00Z')), '2026-09-09')
})
