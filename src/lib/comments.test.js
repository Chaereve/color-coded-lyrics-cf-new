import test from 'node:test'
import assert from 'node:assert/strict'
import { mentionHandle, mentionParts, commentThreads, removeCommentSubtree } from './comments.js'

test('handles preserve full names and highlight space-normalized and Unicode mentions', () => {
  assert.equal(mentionHandle(' park  ssaem '), 'park_ssaem')
  assert.equal(mentionHandle('Nguyễn Văn'), 'Nguyễn_Văn')
  assert.deepEqual(mentionParts('Hello @park_ssaem and @Nguyễn_Văn!'), ['Hello ', '@park_ssaem', ' and ', '@Nguyễn_Văn', '!'])
})

test('arbitrary depth stays in one thread without changing any parent', () => {
  const items = Array.from({ length: 3000 }, (_, i) => ({ id: `${i}`, parent_id: i ? `${i - 1}` : null }))
  const before = JSON.stringify(items)
  const threads = commentThreads([...items].reverse())
  assert.equal(threads.length, 1)
  assert.equal(threads[0].replies.length, 2999)
  assert.equal(JSON.stringify(items), before)
  assert.deepEqual(removeCommentSubtree(items, '1'), [items[0]])
})

test('missing ancestors and corrupt legacy cycles do not hide comments or loop forever', () => {
  const items = [{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'missing' }]
  const threads = commentThreads(items)
  const rendered = threads.flatMap(t => [t.root, ...t.replies]).map(c => c.id)
  assert.deepEqual(rendered.sort(), ['a', 'b', 'c'])
  assert.deepEqual(removeCommentSubtree(items, 'a').map(c => c.id), ['c'])
})
