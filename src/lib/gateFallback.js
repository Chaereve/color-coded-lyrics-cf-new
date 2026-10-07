/* Edge fallback policy.
   Spin requests carry a stable request ID, and the database replays a committed
   spin without awarding it twice, so `gateShouldFallback` remains suitable for
   that path. Votes do not yet have an operation ID: only `voteGateShouldFallback`
   may route a vote directly, and only when the response proves the RPC was not
   reached. Network failures and generic 5xx responses are ambiguous and must
   never trigger a second, non-idempotent vote call. */

const SETUP = new Set(['err.voteGate', 'err.spinGate', 'err.spinSetup'])
const VOTE_PRE_RPC_SETUP = new Set(['err.voteGate'])

export function gateErrorKey(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.error === 'string' && payload.error.startsWith('err.')) return payload.error
  if (typeof payload.message === 'string' && payload.message.startsWith('err.')) return payload.message
  return ''
}

/* Shared by the idempotent Daily Spin path. */
export function gateShouldFallback({ status = 0, contentType = '', payload = null, network = false } = {}) {
  if (network) return true
  const type = String(contentType || '').toLowerCase()
  if (type.includes('text/html')) return true
  if (payload == null && !type.includes('application/json') && !type.includes('+json')) return true
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    const key = gateErrorKey(payload)
    return !key || SETUP.has(key)
  }
  return false
}

/* A vote may fall back only on positive evidence that no vote RPC was run:
   - a 200 HTML document is the Pages/Vite SPA fallback, not the JSON Worker;
   - 503 err.voteGate is the Worker setup guard, which runs before the RPC.
   All network failures and other 5xx responses have an unknown outcome. */
export function voteGateShouldFallback({ status = 0, contentType = '', payload = null, network = false } = {}) {
  if (network) return false
  const type = String(contentType || '').toLowerCase()
  if (status === 200 && type.includes('text/html')) return true
  return status === 503 && VOTE_PRE_RPC_SETUP.has(gateErrorKey(payload))
}
