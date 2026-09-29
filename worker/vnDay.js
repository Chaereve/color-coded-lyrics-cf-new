const DAY_MS = 86_400_000
const VN_OFFSET = 7 * 3_600_000

/* Calendar date in Vietnam, shared by the KV and D1 shield backends. */
export const vnDay = nowMs => new Date(nowMs + VN_OFFSET).toISOString().slice(0, 10)

/* Seconds until midnight VN; KV requires expirationTtl >= 60 seconds. */
export function ttlUntilVnMidnight(nowMs) {
  const shifted = nowMs + VN_OFFSET
  const midnight = Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS
  return Math.min(86_400, Math.max(60, Math.floor((midnight - shifted) / 1000)))
}
