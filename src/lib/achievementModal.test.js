import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const jsx = readFileSync(new URL('../components/AchievementIndex.jsx', import.meta.url), 'utf8')

test('achievement popup keeps its header visible and scrolls only the card grid', () => {
  assert.match(jsx, /className="overlay achievement-overlay"/)
  assert.match(css, /\.achievement-overlay\s*\{[^}]*align-items:\s*center/)
  assert.match(css, /\.ach-modal\s*\{[^}]*min-height:\s*0/)
  assert.match(css, /\.ach-modal \.modal-head\s*\{[^}]*flex:\s*0 0 auto/)
  assert.match(css, /\.ach-modal-body\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/)
})
