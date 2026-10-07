import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gateShouldFallback, voteGateShouldFallback } from './gateFallback.js'

test('idempotent Spin may still fall back for a missing route or a known setup failure', () => {
  assert.equal(gateShouldFallback({
    status: 503,
    contentType: 'text/html; charset=UTF-8',
    payload: null,
  }), true)
  assert.equal(gateShouldFallback({
    status: 200,
    contentType: 'text/html',
    payload: null,
  }), true)
  assert.equal(gateShouldFallback({
    status: 503,
    contentType: 'application/json',
    payload: { error: 'err.voteGate' },
  }), true)
  assert.equal(gateShouldFallback({
    status: 503,
    contentType: 'application/json; charset=utf-8',
    payload: { error: 'err.spinSetup' },
  }), true)
  assert.equal(gateShouldFallback({
    status: 500,
    contentType: 'application/json',
    payload: { error: 'err.voteGate' },
  }), true)
  assert.equal(gateShouldFallback({ network: true, status: 0 }), true)
})

test('a vote falls back only when the response proves the RPC was not reached', () => {
  assert.equal(voteGateShouldFallback({
    status: 200,
    contentType: 'text/html; charset=UTF-8',
    payload: null,
  }), true, 'Pages/Vite SPA HTML fallback is not a vote response')
  assert.equal(voteGateShouldFallback({
    status: 503,
    contentType: 'application/json',
    payload: { error: 'err.voteGate' },
  }), true, 'the Worker setup guard runs before the RPC')
  assert.equal(voteGateShouldFallback({
    status: 503,
    contentType: 'application/json',
    payload: { message: 'err.voteGate' },
  }), true, 'support the PostgREST-style message shape for the known setup code')
})

test('ambiguous vote transport failures never retry through the direct RPC', () => {
  for (const result of [
    { network: true, status: 0 },
    { status: 0 },
    { status: 500, contentType: 'application/json', payload: { error: 'err.voteGate' } },
    { status: 502, contentType: 'application/json', payload: null },
    { status: 503, contentType: 'application/json', payload: { error: 'err.shieldUnavailable' } },
    { status: 503, contentType: 'application/json', payload: null },
    { status: 503, contentType: 'text/html', payload: null },
    { status: 504, contentType: 'text/html', payload: null },
    { status: 200, contentType: 'application/json', payload: null },
  ]) {
    assert.equal(voteGateShouldFallback(result), false, JSON.stringify(result))
  }
})

test('definitive vote denials and shield errors do not fall back around the gate', () => {
  for (const [status, payload] of [
    [403, { error: 'err.spinCaptcha' }],
    [429, { error: 'err.voteEdgeFp' }],
    [400, { error: 'err.voteQty' }],
    [400, { message: 'err.notEnoughVotes', details: '0' }],
    [400, { message: 'err.voteLocked' }],
    [400, { message: 'err.voteGate', code: 'P0001' }],
    [403, { error: 'err.spinEdgeFp' }],
    [503, { error: 'err.shieldUnavailable' }],
  ]) {
    assert.equal(voteGateShouldFallback({
      status, contentType: 'application/json', payload,
    }), false, JSON.stringify(payload))
  }
})

test('the vote client reports unknown outcomes and does not mark network failures as fallback-safe', () => {
  const src = readFileSync(new URL('./db.js', import.meta.url), 'utf8')
  const start = src.indexOf('async function castVoteViaGate')
  const end = src.indexOf('async function castVoteDirect', start)
  assert.ok(start >= 0 && end > start, 'could not find the vote gateway client')
  const voteGate = src.slice(start, end)
  assert.match(voteGate, /voteGateShouldFallback/)
  assert.match(voteGate, /throw appError\('err\.voteOutcomeUnknown'\)/)
  assert.match(voteGate, /Number\.isInteger\(r\?\.my_votes\)/,
    'a malformed success response must not be treated as a confirmed vote')
  const fetchCatch = voteGate.match(/  \} catch \{\n([\s\S]*?)\n  \} finally \{/)
  assert.ok(fetchCatch, 'could not locate fetch failure handling')
  assert.match(fetchCatch[1], /err\.voteOutcomeUnknown/)
  assert.doesNotMatch(fetchCatch[1], /gateDown/)

  const spinStart = src.indexOf('async function performSpinViaGate')
  const spinEnd = src.indexOf('export async function performDailySpin', spinStart)
  assert.ok(spinStart >= 0 && spinEnd > spinStart, 'could not find the Spin gateway client')
  assert.match(src.slice(spinStart, spinEnd), /gateShouldFallback/,
    'Spin keeps its idempotent retry/fallback policy')

  const castStart = src.indexOf('export async function castVote(')
  const castEnd = src.indexOf('export async function deleteRequest', castStart)
  const cast = src.slice(castStart, castEnd)
  assert.match(cast, /if \(!e\?\.gateDown\) throw e/)
  assert.match(cast, /castVoteDirect/)
})
