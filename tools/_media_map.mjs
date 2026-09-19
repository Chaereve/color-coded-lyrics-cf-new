import postcss from 'postcss'
import { readFileSync } from 'node:fs'
const css = readFileSync('src/index.css', 'utf8')
const root = postcss.parse(css)
const re = new RegExp(process.argv[2])
root.walkRules(rule => {
  if (!re.test(rule.selector)) return
  const mq = []
  let p = rule.parent
  while (p && p.type !== 'root') { if (p.type === 'atrule') mq.push(`@${p.name} ${p.params}`); p = p.parent }
  console.log(`${rule.source.start.line}\t${mq.reverse().join(' | ') || '(gốc)'}\t${rule.selector.replace(/\s+/g,' ')}`)
})
