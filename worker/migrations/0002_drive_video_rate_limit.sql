-- Per-IP, per-minute request counters for the public Drive preview endpoints.
-- Store only a hash of the Cloudflare-provided client IP.
CREATE TABLE IF NOT EXISTS drive_video_rate_limits (
  window_minute INTEGER NOT NULL,
  ip_hash       TEXT    NOT NULL,
  endpoint      TEXT    NOT NULL CHECK (endpoint IN ('find', 'stream')),
  requests      INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  PRIMARY KEY (window_minute, ip_hash, endpoint)
) WITHOUT ROWID;
