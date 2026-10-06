/* Kiểm hàm phân loại của tools/schema-drift-report.mjs — hàm thuần, không cần
   database. Điều phải chứng minh, theo đúng kỷ luật "đừng nới cổng":

     · database PostgreSQL CŨ (không có dòng pg_constraint contype='n') vẫn ra
       nhóm "cơ chế catalog" — không phải problem — CHỈ KHI chính cột đó thật sự
       not null;
     · cột mất NOT NULL, hoặc mất hẳn, thì PHẢI rơi vào nhóm "cần người đọc";
     · index/policy lệch vẫn là nhóm "cần người đọc", không bị nuốt;
     · chiều ngược (database ghi 'n' mà fingerprint không có) chỉ là ghi chú.
   Chạy: node --test tools/schemaDriftReport.test.mjs */
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyDrift, enrichReview } from './schema-drift-report.mjs'

/* Database PG17 "hình dạng thật": có cột, không có constraint contype='n'. */
const pg17Actual = (notNull = true) => ({
  tables: {
    requests: {
      columns: { id: { type: 'uuid', notNull: true }, picked_at: { type: 'timestamptz', notNull } },
      constraints: [], indexes: [], policies: [], triggers: [],
    },
  },
  functions: {},
  config: {},
})

const expected = {
  tables: {
    requests: {
      columns: { id: { type: 'uuid', notNull: true }, picked_at: { type: 'timestamptz', notNull: true } },
      constraints: [
        { name: 'requests_id_not_null', type: 'n', columns: ['id'], references: null, definition: 'NOT NULL id' },
        { name: 'requests_picked_at_not_null', type: 'n', columns: ['picked_at'], references: null, definition: 'NOT NULL picked_at' },
      ],
      indexes: [{ name: 'requests_picked_idx', definition: 'CREATE INDEX requests_picked_idx ON public.requests USING btree (picked_at) WHERE (picked_at IS NOT NULL)' }],
      policies: [], triggers: [],
    },
  },
  functions: {},
  config: {},
}

const missingNotNullProblems = [
  { kind: 'missing-constraint', object: 'n on public.requests(id)', detail: 'expected NOT NULL id' },
  { kind: 'missing-constraint', object: 'n on public.requests(picked_at)', detail: 'expected NOT NULL picked_at' },
]

test('PG cũ: constraint NOT NULL vắng mặt nhưng cột vẫn not null → nhóm cơ chế catalog', () => {
  const { artifacts, review } = classifyDrift(expected, pg17Actual(true), missingNotNullProblems)
  assert.equal(artifacts.length, 2, 'cả hai dòng phải được nhận là cơ chế catalog')
  assert.deepEqual(review, [], 'không được đẩy mục nào sang nhóm cần người đọc')
})

test('cột MẤT NOT NULL → vẫn fail-closed, rơi vào nhóm cần người đọc', () => {
  const { artifacts, review } = classifyDrift(expected, pg17Actual(false), missingNotNullProblems)
  assert.equal(artifacts.length, 1, 'chỉ cột id còn not null')
  assert.equal(review.length, 1, 'cột picked_at mất NOT NULL phải bị nêu')
  assert.equal(review[0].kind, 'incompatible-nullability')
  assert.match(review[0].object, /picked_at/)
})

test('cột mất hẳn khỏi database → nhóm cần người đọc', () => {
  const actual = pg17Actual(true)
  delete actual.tables.requests.columns.picked_at
  const { artifacts, review } = classifyDrift(expected, actual, missingNotNullProblems)
  assert.equal(artifacts.length, 1)
  assert.equal(review.length, 1)
  assert.equal(review[0].kind, 'missing-column')
})

test('index lệch và policy lệch không bị nuốt vào nhóm cơ chế catalog', () => {
  const problems = [
    ...missingNotNullProblems,
    { kind: 'incompatible-index', object: 'requests_picked_idx', detail: 'expected …, found picked_at DESC' },
    { kind: 'incompatible-policy', object: 'public.request_comments policy x', detail: 'expected …, found …' },
  ]
  const { artifacts, review } = classifyDrift(expected, pg17Actual(true), problems)
  assert.equal(artifacts.length, 2)
  assert.equal(review.length, 2)
  assert.deepEqual(review.map(r => r.kind), ['incompatible-index', 'incompatible-policy'])
})

test('chiều ngược: database ghi constraint n mà fingerprint không có → chỉ là ghi chú', () => {
  const actual = pg17Actual(true)
  /* Hai constraint của fingerprint có mặt (nên không thiếu gì)… */
  actual.tables.requests.constraints.push(
    { name: 'requests_id_not_null', type: 'n', columns: ['id'], references: null, definition: 'NOT NULL id' },
    { name: 'requests_picked_at_not_null', type: 'n', columns: ['picked_at'], references: null, definition: 'NOT NULL picked_at' },
    /* …cộng một dòng mà fingerprint không khai: đó mới là "chiều ngược". */
    { name: 'requests_status_not_null', type: 'n', columns: ['status'], references: null, definition: 'NOT NULL status' },
  )
  const { artifacts, review, reverse } = classifyDrift(expected, actual, [])
  assert.deepEqual(artifacts, [])
  assert.deepEqual(review, [])
  assert.equal(reverse.length, 1, 'dòng thừa phải được ghi chú riêng, không phải problem')
  assert.match(reverse[0], /status/)
})

test('enrichReview: chỉ ra đúng giá trị database đang có cho policy và index', () => {
  const actual = pg17Actual(true)
  actual.tables.request_comments = {
    columns: {}, constraints: [], triggers: [],
    indexes: [],
    policies: [{ name: 'request_comments_authenticated_insert', cmd: 'INSERT', roles: '{authenticated}', qual: '', withCheck: '(auth.uid() = user_id)' }],
  }
  actual.tables.requests.indexes.push({ name: 'requests_picked_idx', definition: 'CREATE INDEX requests_picked_idx ON public.requests USING btree (picked_at DESC)' })
  expected.tables.request_comments = { columns: {}, constraints: [], indexes: [], triggers: [], policies: [{ name: 'request_comments_authenticated_insert', cmd: 'INSERT', roles: '{authenticated}', qual: '', withCheck: "(auth.uid() = user_id)" }] }
  const review = [
    { kind: 'incompatible-policy', object: 'public.request_comments policy request_comments_authenticated_insert', detail: 'expected …' },
    { kind: 'incompatible-index', object: 'requests_picked_idx', detail: 'expected …' },
  ]
  const out = enrichReview(expected, actual, review)
  assert.equal(out[0].found.policy.withCheck, '(auth.uid() = user_id)', 'phải chỉ ra biểu thức thật của database')
  assert.match(out[1].found.index.definition, /picked_at DESC/)
})
