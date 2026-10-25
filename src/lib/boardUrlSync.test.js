import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.jsx', import.meta.url)), 'utf8')

test('opening the board does not serialize restored local filters until the user changes them', () => {
  assert.match(app, /const initialBoardUrlSync = useRef\(section === 'board'\)/)
  assert.match(app, /const initialBoardUrlState = useRef\(board\)/)
  assert.match(app, /const untouchedInitial = first && filter === saved\.f && sort === saved\.s\s+&& kindFilter === saved\.k && q === saved\.q/)
  assert.match(app, /if \(!untouchedInitial && next !== window\.location\.pathname \+ window\.location\.search\)\s*\{\s*putUrl\(\{ s: 'board' \}, next\)/)
})
