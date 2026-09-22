import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gateShouldFallback } from './gateFallback.js'

test('trang bảo trì HTML phải rơi về RPC — đúng lỗi vote trên production', () => {
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
})

test('cổng thiếu secret (503 err.voteGate) thì rơi về RPC', () => {
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
})

test('mất mạng trước khi có phản hồi thì rơi về RPC', () => {
  assert.equal(gateShouldFallback({ network: true, status: 0 }), true)
})

test('castVote và spin thật sự rơi về RPC khi cổng chết, không nuốt từ chối', () => {
  const src = readFileSync(new URL('./db.js', import.meta.url), 'utf8')
  assert.match(src, /gateShouldFallback/)
  assert.match(src, /if \(!e\?\.gateDown\) throw e/)
  assert.match(src, /castVoteDirect/)
  /* Timeout không được đánh dấu gateDown — request có thể đã ghi phiếu. */
  assert.match(src, /AbortError[\s\S]{0,80}err\.voteGate/)
  assert.doesNotMatch(src, /AbortError[\s\S]{0,40}gateDown/)
})

test('từ chối thật không được đi vòng cổng', () => {
  for (const [status, payload] of [
    [403, { error: 'err.spinCaptcha' }],
    [429, { error: 'err.voteEdgeFp' }],
    [400, { error: 'err.voteQty' }],
    [400, { message: 'err.notEnoughVotes', details: '0' }],
    [400, { message: 'err.voteLocked' }],
    [400, { message: 'err.voteGate', code: 'P0001' }],
    [403, { error: 'err.spinEdgeFp' }],
  ]) {
    assert.equal(gateShouldFallback({
      status, contentType: 'application/json', payload,
    }), false, JSON.stringify(payload))
  }
})
