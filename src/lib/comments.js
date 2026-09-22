// Keep this normalization in sync with public.comment_mention_handle in SQL.
export const mentionHandle = name => String(name || 'Member').trim().replace(/\s+/gu, '_')
export const mentionParts = text => String(text || '').split(/(@[\p{L}\p{N}_.-]+)/gu)

export function commentSubtreeIds(items, id) {
  const children = new Map()
  for (const c of items) {
    if (!children.has(c.parent_id)) children.set(c.parent_id, [])
    children.get(c.parent_id).push(c.id)
  }
  const ids = new Set(), pending = [id]
  while (pending.length) {
    const next = pending.pop()
    if (ids.has(next)) continue
    ids.add(next)
    pending.push(...(children.get(next) || []))
  }
  return ids
}

export function removeCommentSubtree(items, id) {
  const ids = commentSubtreeIds(items, id)
  return items.filter(c => !ids.has(c.id))
}

// Flatten only the PRESENTATION. Never rewrite parent_id. Missing ancestors
// (e.g. a concurrent deletion / partial page) and legacy cycles cannot hide rows.
export function commentThreads(items) {
  const ids = new Set(items.map(c => c.id)), children = new Map(), seen = new Set()
  for (const c of items) {
    if (!children.has(c.parent_id)) children.set(c.parent_id, [])
    children.get(c.parent_id).push(c)
  }
  const threads = []
  for (const root of [...items.filter(c => !ids.has(c.parent_id)), ...items]) {
    if (seen.has(root.id)) continue
    const replies = [], stack = [root]
    while (stack.length) {
      const c = stack.pop()
      if (seen.has(c.id)) continue
      seen.add(c.id)
      if (c !== root) replies.push(c)
      stack.push(...(children.get(c.id) || []).slice().reverse())
    }
    threads.push({ root, replies })
  }
  return threads
}
