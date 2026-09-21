import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('GIF avatar bypasses canvas so animation is not reduced to the first frame', () => {
  const src = readFileSync(`${root}src/lib/avatar.js`, 'utf8')
  const panel = readFileSync(`${root}src/components/ProfilePanel.jsx`, 'utf8')
  assert.match(src, /processAnimatedAvatar/)
  assert.match(src, /file\.type !== 'image\/gif'/)
  assert.match(panel, /file\.type === 'image\/gif'/)
  assert.match(panel, /processAnimatedAvatar\(file\)/)
  assert.match(panel, /accept="image\/\*,\.gif"/)
})
