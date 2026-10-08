/* Shared request eligibility/key rules for rewards and rankings.
   These mirror the server's accepted states and public.song_key(artist, title).
   Pending and denied rows are deliberately not reward/ranking eligible. */
const ELIGIBLE_STATUSES = new Set(['queued', 'in_progress', 'completed'])

const normalizedField = value => (value == null ? '' : String(value)).trim().toLowerCase()

/** Same normalized artist/title key as public.song_key() and board grouping. */
export function requestWorkKey (request) {
  return `${normalizedField(request?.artist)}\n${normalizedField(request?.title)}`
}

export function isRewardEligibleRequest (request) {
  return Boolean(request && ELIGIBLE_STATUSES.has(request.status))
}
