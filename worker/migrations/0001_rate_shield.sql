-- Cloudflare D1 Edge rate shield (Pages binding: RATE_SHIELD).
-- Only SHA-256 hashes and counters are stored; no raw IP or fingerprint.
-- Day keys use Asia/Ho_Chi_Minh and are pruned lazily by the Worker (no cron).
CREATE TABLE IF NOT EXISTS edge_rate_counters (
  day          TEXT    NOT NULL,
  scope        TEXT    NOT NULL CHECK (scope IN ('spin_fp', 'spin_ip', 'vote_fp')),
  subject_hash TEXT    NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  blocked      INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  PRIMARY KEY (day, scope, subject_hash)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS edge_spin_ip_fingerprints (
  day     TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  fp_hash TEXT NOT NULL,
  PRIMARY KEY (day, ip_hash, fp_hash)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS edge_shield_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
