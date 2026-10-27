const PROF_KEY = 'ccl3_prof'
const LEGACY_PROF_KEYS = ['ccl2_prof', 'ccl_prof']

function readJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

export function readDemoWallet() {
  let prof = readJson(PROF_KEY)
  if (prof === null) {
    for (const legacy of LEGACY_PROF_KEYS) {
      const old = readJson(legacy)
      if (old !== null) {
        prof = old
        try { localStorage.setItem(PROF_KEY, JSON.stringify(old)) } catch { /* demo storage */ }
        break
      }
    }
  }
  const base = prof && typeof prof === 'object'
    ? { ...prof }
    : { vote_credits: 0, bonus_credits: 0, bonus_requests: 0, is_admin: true }
  if (!Number.isInteger(base.vote_credits)) base.vote_credits = 0
  if (!Number.isInteger(base.bonus_credits)) base.bonus_credits = 0
  if (!Number.isInteger(base.bonus_requests)) base.bonus_requests = 0
  return base
}

export function creditDemoRewards({ votes = 0, requests = 0 } = {}) {
  const addVotes = Number.isInteger(votes) && votes > 0 ? votes : 0
  const addRequests = Number.isInteger(requests) && requests > 0 ? requests : 0
  if (!addVotes && !addRequests) return
  try {
    const prof = readDemoWallet()
    prof.bonus_credits += addVotes
    prof.bonus_requests += addRequests
    localStorage.setItem(PROF_KEY, JSON.stringify(prof))
  } catch { /* localStorage may be absent in non-browser tests */ }
}
