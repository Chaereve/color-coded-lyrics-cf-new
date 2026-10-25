import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const privacy = readFileSync(fileURLToPath(new URL('../../public/privacy.html', import.meta.url)), 'utf8')

test('Privacy page reflects public profile URLs, Daily Box retention and external Ko-fi support', () => {
  assert.match(privacy, /\/u\/&lt;user-id&gt;/)
  assert.match(privacy, /Daily Box\s+openings are retained/)
  assert.match(privacy, /account ID may remain/)
  assert.match(privacy, /Ko-fi/)
  assert.match(privacy, /https:\/\/ko-fi\.com\/chaereve/)
})

test('Privacy page no longer promises comment or reply storage', () => {
  assert.doesNotMatch(privacy, /comments?|replies/i)
})
