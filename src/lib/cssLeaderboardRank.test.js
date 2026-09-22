/* Cột hạng của bảng xếp hạng (từ hạng 4 trở xuống) phải đủ chỗ cho số,
   không bị bẻ chữ số. box-sizing là border-box và .lb kế overflow-wrap:
   anywhere — hai thứ này từng làm "10" thành hai dòng trong cột 42px.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function specOf(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length
  const cls = (sel.match(/\.[\w-]+/g) || []).length
    + (sel.match(/\[[^\]]+\]/g) || []).length
    + (sel.match(/:(?![:])[\w-]+(?:\([^)]*\))?/g) || []).length
  const stripped = sel
    .replace(/#[\w-]+/g, ' ')
    .replace(/\.[\w-]+/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/::?[\w-]+(?:\([^)]*\))?/g, ' ')
  const els = (stripped.match(/[a-z]+/gi) || []).length
  return [ids, cls, els]
}
function specCmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}
function splitSels(sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean)
}
/* khớp đúng ô hạng, không ăn `.c-rk-extra` hay selector không liên quan */
function matchesRank(sel) {
  return /(?:^|[\s>+~])(?:th|td)\.c-rk\b/.test(sel) || /\.lb-table\s+(?:th|td)\.c-rk\b/.test(sel)
}

const spans = []
for (const m of css.matchAll(/@media[^{]*\{/g)) {
  let d = 1, i = m.index + m[0].length
  while (i < css.length && d) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++ }
  spans.push({ q: m[0].replace(/@media\s*/, '').replace(/\{\s*$/, '').trim(), from: m.index, to: i })
}
const rules = []
let order = 0
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ')
  if (!sel || sel.startsWith('@')) continue
  const media = (spans.find((s) => m.index >= s.from && m.index < s.to) || {}).q || null
  for (const one of splitSels(sel)) {
    if (!matchesRank(one)) continue
    rules.push({ sel: one, body: m[2], media, spec: specOf(one), order: order++ })
  }
}
assert.ok(rules.length >= 2, 'không đọc được luật .c-rk')

function mediaOn(q, vw) {
  if (!q) return true
  if (/pointer|hover|prefers-|print|orientation/i.test(q)) return false
  const parts = q.split(/\s+and\s+/i)
  return parts.every((p) => {
    const max = p.match(/max-width:\s*(\d+)px/)
    const min = p.match(/min-width:\s*(\d+)px/)
    if (max && vw > Number(max[1])) return false
    if (min && vw < Number(min[1])) return false
    if (!max && !min) return false
    return true
  })
}
function decls(body) {
  const out = []
  for (const chunk of body.split(';')) {
    const i = chunk.indexOf(':')
    if (i < 0) continue
    const prop = chunk.slice(0, i).trim().toLowerCase()
    const val = chunk.slice(i + 1).trim().replace(/\s+/g, ' ')
    if (prop && val && !prop.startsWith('/*')) out.push([prop, val])
  }
  return out
}
function pxOf(v) {
  const m = String(v).match(/^(-?\d+(?:\.\d+)?)px$/)
  return m ? Number(m[1]) : null
}
/* shorthand padding → padding-left / padding-right, để một luật
   `padding: 7px 6px` phía sau không bị test bỏ quên */
function expandPad(prop, val) {
  const bits = val.split(/\s+/)
  if (prop === 'padding-inline') {
    const l = bits[0], r = bits[1] || bits[0]
    return [['padding-left', l], ['padding-right', r]]
  }
  if (prop === 'padding-left' || prop === 'padding-right') return [[prop, val]]
  if (prop !== 'padding') return []
  const [a, b = a, , d = b] = bits
  return [['padding-left', d], ['padding-right', b]]
}

function winning(vw, prop) {
  let best = null
  for (const r of rules) {
    if (!mediaOn(r.media, vw)) continue
    for (const [p, v] of decls(r.body)) {
      const hits = p === prop ? [[prop, v]] : expandPad(p, v).filter(([ep]) => ep === prop)
      for (const [, val] of hits) {
        if (!best || specCmp(r.spec, best.spec) > 0 || (specCmp(r.spec, best.spec) === 0 && r.order >= best.order)) {
          best = { val, spec: r.spec, order: r.order, sel: r.sel, media: r.media }
        }
      }
    }
  }
  return best
}

const VIEWPORTS = [
  [1280, 'desktop'],
  [500, '≤620px'],
  [360, '≤380px'],
]
/* bốn chữ số mono 12px (~7.2px) + một nhịp thở, không sát mép ô */
const MIN_CONTENT = 32

for (const [vw, label] of VIEWPORTS) {
  test(`cột hạng còn một dòng và đủ chỗ cho số 4 chữ số (${label})`, () => {
    const width = winning(vw, 'width')
    const left = winning(vw, 'padding-left')
    const right = winning(vw, 'padding-right')
    const ws = winning(vw, 'white-space')
    const ow = winning(vw, 'overflow-wrap')
    const wb = winning(vw, 'word-break')
    assert.ok(width, `${label}: thiếu width trên .c-rk`)
    assert.equal(pxOf(width.val), 52, `${label}: width cột hạng phải là 52px, đang ${width.val} (${width.sel})`)
    assert.ok(left && right, `${label}: .c-rk phải tự giữ padding-inline, không để padding của th/td ăn chỗ số`)
    const content = pxOf(width.val) - pxOf(left.val) - pxOf(right.val)
    assert.ok(content >= MIN_CONTENT,
      `${label}: chỗ cho số chỉ còn ${content}px (width ${width.val} − padding ${left.val}/${right.val}) — số từ 10 sẽ bẻ dòng`)
    assert.equal(ws?.val, 'nowrap', `${label}: số hạng phải nowrap, đang ${ws?.val || 'kế thừa'}`)
    assert.equal(ow?.val, 'normal',
      `${label}: overflow-wrap trên ô hạng phải là normal để không thừa kế anywhere từ .lb, đang ${ow?.val || 'kế thừa'}`)
    assert.ok(!wb || wb.val === 'normal', `${label}: word-break không được bẻ chữ số (${wb?.val})`)
  })
}

test('tên trong bảng vẫn cắt bằng ellipsis, không đẩy cột hạng', () => {
  assert.match(css, /\.lb-nm\s*\{[^}]*white-space:\s*nowrap/)
  assert.match(css, /\.lb-nm\s*\{[^}]*text-overflow:\s*ellipsis/)
  assert.match(css, /\.lb-table\s*\{[^}]*table-layout:\s*fixed/)
})
