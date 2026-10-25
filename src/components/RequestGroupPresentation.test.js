import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, css] = await Promise.all([
  readFile(new URL('../App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../index.css', import.meta.url), 'utf8'),
])
const between = (source, start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.notEqual(from, -1, `missing source section: ${start}`)
  assert.notEqual(to, -1, `missing source boundary: ${end}`)
  return source.slice(from, to)
}
const group = between(app, 'function RequestGroup(', '\nfunction AppInner(')
const row = between(app, 'function RequestRow(', '\nfunction MyActivityPanel(')

test('collapsed request group uses the original count badge and omits the type badge', () => {
  assert.match(group, /className="grow-count"[^>]*>\{t\('group\.requests', \{ n: g\.rows\.length \}\)\}/,
    'group summary keeps the existing “N requests” badge')
  assert.doesNotMatch(group, /kinds\.map|kindCls\(|kindShort\(/,
    'song-type badges should only appear on the individual requests after expanding')
  assert.match(css, /\.grow-count\s*\{[^}]*background:\s*linear-gradient\(90deg, var\(--a\), var\(--a-dim\)\)/,
    'count badge keeps the site’s existing purple gradient style')
})

test('group total-vote rail matches the mockup and the label has clear tracking', () => {
  assert.match(group, /t\('group\.votesTotal'\)/,
    'group total uses a distinct label instead of the generic “votes” text')
  assert.match(css, /\.grow-head\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 44px 92px/,
    'desktop header reserves a compact arrow slot and responsive vote rail')
  assert.match(css, /\.grow-stat\s*\{[^}]*border-left:\s*1px solid var\(--line\)/,
    'the total votes column is visibly separated from the title area')
  assert.match(css, /\.row\.req > \.votebtn\s*\{[^}]*min-width:\s*92px/,
    'the standard request vote rail is 92px on desktop')
  assert.match(css, /\.grow-head\s*\{ grid-template-columns:\s*minmax\(0, 1fr\) 40px 72px/,
    'the group vote rail matches the 72px request vote rail on narrow screens')
  assert.match(css, /\.row\.req > \.votebtn\s*\{ min-width:\s*72px/,
    'the standard request vote rail is 72px on narrow screens')
  assert.match(css, /\.grow-stat b\s*\{[^}]*font-size:\s*20px/,
    'the total number stays secondary to the song title')
  assert.match(css, /\.grow-stat span\s*\{[^}]*font-size:\s*8px;[^}]*letter-spacing:\s*\.09em;[^}]*text-transform:\s*uppercase/,
    'the compact total label is spaced and uppercase like the approved mockup')
})

test('group chevron stays compact and understated in hover and expanded states', () => {
  assert.match(group, /className=\{`grow-arrow\$\{expanded \? ' on' : ''\}`\}[\s\S]*?<svg/,
    'group uses an outlined chevron rather than a text triangle')
  assert.match(css, /\.grow-arrow\s*\{[^}]*width:\s*28px;\s*height:\s*28px/,
    'the toggle stays compact beside the vote rail')
  assert.match(css, /\.grow-head:hover \.grow-arrow\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--a\) 14%, var\(--surface-2\)\)/,
    'hover uses a soft accent, not a solid bright-purple circle')
  assert.doesNotMatch(css, /\.grow-head:hover \.grow-arrow\s*\{[^}]*background:\s*var\(--a\);/)
})

test('group card and summary header share one radius and clip child rows cleanly', () => {
  assert.match(css, /\.grow\s*\{\s*--grow-radius:\s*var\(--r-lg\);[\s\S]*?border-radius:\s*var\(--grow-radius\);\s*overflow:\s*hidden/,
    'the outer group uses the approved rounded-card radius and clips its contents')
  assert.match(css, /\.grow-head\s*\{[^}]*border-radius:\s*calc\(var\(--grow-radius\) - 1px\) calc\(var\(--grow-radius\) - 1px\) 0 0/,
    'the summary background follows the top corners inside the outer border')
})

test('a collapsed group hides its child rows without leaving a blank area', () => {
  assert.match(css, /\.grow-rows\s*\{\s*display:\s*grid;\s*grid-template-rows:\s*0fr;/,
    'the collapsed child container must use a zero-height grid track')
  assert.doesNotMatch(css, /\.grow-rows\s*\{\s*display:\s*block;\s*\}/,
    'a later block display override would keep hidden rows in the layout')
})

test('expanding a group still shows each request’s status and type badge', () => {
  assert.match(group, /<RequestRow[\s\S]*?r=\{r\}/,
    'expanded children are still rendered with the normal request row')
  assert.match(row, /statusLabel\(r, t\)/,
    'individual request status remains visible')
  assert.match(row, /kindShort\(r\.kind\)/,
    'individual request type badge remains visible')
})
