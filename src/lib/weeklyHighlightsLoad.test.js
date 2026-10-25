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
  assert.match(load, /fetchRecentVotes\(\{ firstPageOnly: true \}\)/,
    'signed-in initial load must fetch the newest RPC page without waiting for older history')
  assert.match(load, /vv\.status === 'fulfilled' && Array\.isArray\(vv\.value\) && vv\.value\.length > 0\) setVotesLog\(vv\.value\)/,
    'publish non-empty vote rows while preserving the current card on an empty refresh')
})

test('public initial load uses only the recent page; full month history is fetched on ranking', () => {
  const loadPublic = between('const loadPublic = useCallback', 'useEffect(() => { if (!user) loadPublic()')
  assert.match(loadPublic, /fetchRecentVotes\(\{ firstPageOnly: true \}\)/,
    'homepage must not wait on an older PostgREST page')
  assert.match(loadPublic, /vv\.value\.length > 0\) setVotesLog\(vv\.value\)/,
    'an empty public refresh must not erase a currently visible weekly card')
  const rankingLoad = between('if (section !== \'ranking\') return undefined', '/* NÚT "THỬ LẠI"')
  assert.match(rankingLoad, /fetchRecentVotes\(\)/,
    'ranking should still load complete month history on demand')
  assert.match(rankingLoad, /votes\.length > 0\) setVotesLog\(votes\)/,
    'an empty ranking refresh must not erase the current vote log')
})
