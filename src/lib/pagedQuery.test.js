import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllPages } from './pagedQuery.js'

test('fetchAllPages continues past the initial 200-row page and stops at the short page', async () => {
  const all = Array.from({ length: 450 }, (_, id) => ({ id }))
  const requests = []
  const result = await fetchAllPages(async (offset, size) => {
    requests.push({ offset, size })
    return { data: all.slice(offset, offset + size), error: null }
  })
  assert.equal(result.length, 450)
  assert.deepEqual(requests, [
    { offset: 0, size: 200 },
    { offset: 200, size: 200 },
    { offset: 400, size: 200 },
  ])
})

test('fetchAllPages collects every row when PostgREST caps each page at 1000', async () => {
  const all = Array.from({ length: 2475 }, (_, id) => ({ id }))
  const requests = []
  const result = await fetchAllPages(async (offset, size) => {
    requests.push({ offset, size })
    // Simulate the production PostgREST max_rows cap, even if more rows exist.
    return { data: all.slice(offset, Math.min(offset + size, offset + 1000)), error: null }
  }, 1000)

  assert.deepEqual(result, all)
  assert.deepEqual(requests, [
    { offset: 0, size: 1000 },
    { offset: 1000, size: 1000 },
    { offset: 2000, size: 1000 },
  ])
})

test('fetchAllPages propagates a page error rather than returning partial history', async () => {
  await assert.rejects(() => fetchAllPages(async () => ({ data: null, error: new Error('page failed') })),
    /page failed/)
})
