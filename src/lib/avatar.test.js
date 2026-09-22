import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkFile } from './avatar.js'
const root = fileURLToPath(new URL('../../', import.meta.url))

test('avatar chỉ nhận ảnh tĩnh và giao diện không còn GIF', () => {
  const src = readFileSync(`${root}src/lib/avatar.js`, 'utf8')
  const panel = readFileSync(`${root}src/components/ProfilePanel.jsx`, 'utf8')
  assert.doesNotMatch(src, /image\/gif|processAnimatedAvatar|isAnimatedWebp/)
  assert.doesNotMatch(panel, /gif|processAnimatedAvatar|isAnimatedWebp/i)
  assert.match(panel, /accept="image\/jpeg,image\/png,image\/webp"/)
  assert.throws(() => checkFile({ type: 'image/gif', size: 10 }), /err.avatarType/)
})
