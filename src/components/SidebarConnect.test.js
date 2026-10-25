import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (path) => fileURLToPath(new URL(path, import.meta.url))
const sidebar = readFileSync(at('./Sidebar.jsx'), 'utf8')
const payment = readFileSync(at('../lib/payment.js'), 'utf8')

test('Connect sidebar includes the Ko-fi page with its branded SVG icon', () => {
  assert.match(payment, /kofiUrl: 'https:\/\/ko-fi\.com\/chaereve'/)
  assert.match(sidebar, /href=\{SUPPORT\.kofiUrl\} target="_blank" rel="noreferrer"/)
  assert.match(sidebar, /<BrandIco d=\{BRAND\.kofi\} \/>/)
  assert.match(sidebar, /kofi: <path d="M11\.351[\s\S]*?fill="currentColor" \/>/)
  assert.match(sidebar, /<span className="side-tx">Ko-fi<\/span>/)
})
