/* Regression: signed-in viewers use `load`, not `loadPublic`. Keep the recent
   vote log in that initial path so the weekly Most voted card is present on
   first render instead of appearing only after a realtime refresh. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.jsx', import.meta.url)), 'utf8')
const between = (start, end) => {
  const from = app.indexOf(start)
  const to = app.indexOf(end, from + start.length)
  assert.notEqual(from, -1, `missing App loader: ${start}`)
  assert.notEqual(to, -1, `missing App loader boundary: ${end}`)
  return app.slice(from, to)
}

test('signed-in initial board load fetches and publishes received vote events', () => {
  const load = between('const load = useCallback', 'const loadBoard = useCallback')
  assert.match(load, /fetchRecentVotes\(\)/,
    'signed-in initial load must fetch the public recent-vote RPC too')
  assert.match(load, /vv\.status === 'fulfilled' && Array\.isArray\(vv\.value\)\) setVotesLog\(vv\.value\)/,
    'publish successful vote rows so weeklyHighlights can render Most voted')
})
