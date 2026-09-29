/* D1 backend for the Edge rate shield.
   KV remains as a compatibility fallback until the Pages `RATE_SHIELD` D1
   binding is configured. D1 stores only hashes and VN-day counters. */
import { vnDay } from './vnDay.js'

const PRUNE_META_KEY = 'pruned_vn_day'

async function pruneExpiredDays(db, day) {
  const marker = await db.prepare(
    'SELECT value FROM edge_shield_meta WHERE key = ?'
  ).bind(PRUNE_META_KEY).first()
  if (marker?.value === day) return

  /* Lazy daily cleanup: no cron, and old rows are removed only once per VN day.
     The batch is atomic, so a failed prune does not advance the marker. */
  await db.batch([
    db.prepare('DELETE FROM edge_rate_counters WHERE day < ?').bind(day),
    db.prepare('DELETE FROM edge_spin_ip_fingerprints WHERE day < ?').bind(day),
    db.prepare(`INSERT INTO edge_shield_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(PRUNE_META_KEY, day),
  ])
}

const counter = (db, day, scope, subjectHash) => db.prepare(
  'SELECT used, blocked FROM edge_rate_counters WHERE day = ? AND scope = ? AND subject_hash = ?'
).bind(day, scope, subjectHash).first()

export async function d1SpinCheck(db, { ipHash, fpHash, nowMs = Date.now(), limit, maxFpPerIp }) {
  const day = vnDay(nowMs)
  await pruneExpiredDays(db, day)
  const [fp, ip, net] = await Promise.all([
    counter(db, day, 'spin_fp', fpHash),
    counter(db, day, 'spin_ip', ipHash),
    db.prepare(`SELECT COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN fp_hash = ? THEN 1 ELSE 0 END), 0) AS seen
      FROM edge_spin_ip_fingerprints WHERE day = ? AND ip_hash = ?`)
      .bind(fpHash, day, ipHash).first(),
  ])
  if (ip?.blocked) return { ok: false, reason: 'err.spinEdgeIp' }
  if ((fp?.used ?? 0) >= limit) return { ok: false, reason: 'err.spinEdgeFp' }
  if (!net.seen && net.n >= maxFpPerIp) {
    await db.prepare(`INSERT INTO edge_rate_counters (day, scope, subject_hash, used, blocked)
      VALUES (?, 'spin_ip', ?, 0, 1)
      ON CONFLICT(day, scope, subject_hash) DO UPDATE SET blocked = 1`)
      .bind(day, ipHash).run()
    return { ok: false, reason: 'err.spinEdgeIp' }
  }
  return { ok: true, _state: { day } }
}

export async function d1SpinCommit(db, { ipHash, fpHash, nowMs = Date.now() }) {
  const day = vnDay(nowMs)
  await pruneExpiredDays(db, day)
  await db.batch([
    db.prepare(`INSERT INTO edge_rate_counters (day, scope, subject_hash, used, blocked)
      VALUES (?, 'spin_fp', ?, 1, 0)
      ON CONFLICT(day, scope, subject_hash) DO UPDATE SET used = edge_rate_counters.used + 1`)
      .bind(day, fpHash),
    db.prepare(`INSERT OR IGNORE INTO edge_spin_ip_fingerprints (day, ip_hash, fp_hash)
      VALUES (?, ?, ?)`)
      .bind(day, ipHash, fpHash),
  ])
}

export async function d1VoteCheck(db, { fpHash, nowMs = Date.now(), limit }) {
  if (!fpHash) return { ok: true }
  const day = vnDay(nowMs)
  await pruneExpiredDays(db, day)
  const state = await counter(db, day, 'vote_fp', fpHash)
  if ((state?.used ?? 0) >= limit) return { ok: false, reason: 'err.voteEdgeFp' }
  return { ok: true, _state: { day } }
}

export async function d1VoteCommit(db, { fpHash, nowMs = Date.now() }) {
  if (!fpHash) return
  const day = vnDay(nowMs)
  await pruneExpiredDays(db, day)
  await db.prepare(`INSERT INTO edge_rate_counters (day, scope, subject_hash, used, blocked)
    VALUES (?, 'vote_fp', ?, 1, 0)
    ON CONFLICT(day, scope, subject_hash) DO UPDATE SET used = edge_rate_counters.used + 1`)
    .bind(day, fpHash).run()
}
