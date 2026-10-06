/* BÁO CÁO DRIFT — chỉ đọc, KHÔNG phải cổng triển khai.
   ---------------------------------------------------------------------------
   `npm run db:verify-baseline -- --baseline <v>` là cổng fail-closed: nó trả
   NOT READY và không cho ghi baseline. Nhưng khi cổng đó kêu, câu hỏi thật là
   "cái nào trong đám problems là khác biệt cơ chế catalog giữa các phiên bản
   PostgreSQL, cái nào là khác biệt thật của database?". Công cụ này trả lời
   đúng câu đó — và chỉ trả lời, không nới bất kỳ điều kiện nào của cổng:

     · nó chỉ chạy SELECT;
     · nó KHÔNG in READY, KHÔNG ghi history, KHÔNG đề xuất `--baseline`;
     · mã thoát 1 khi còn mục "cần người đọc" (mặc định là fail-closed).

   Vì sao cần: fingerprint `supabase/baselines/20261120.json` được sinh trên
   PostgreSQL 18. Từ PG18, mỗi NOT NULL còn được ghi thêm một dòng trong
   pg_constraint (contype = 'n'); PG17 trở xuống chỉ có pg_attribute.attnotnull.
   Đọc fingerprint PG18 trên database PG17 vì thế sinh ra hàng trăm
   "missing-constraint … expected NOT NULL" giả — trong khi chính phép so sánh
   theo CỘT (`notNull`) vẫn là thứ quyết định đúng/sai về mặt ngữ nghĩa.

   Chạy:
     SUPABASE_DB_URL='postgresql://…' node tools/schema-drift-report.mjs --baseline 20261120
     … --json /tmp/drift-report.json     # gửi lại cho người review, không có credential
   Chuỗi kết nối chỉ đọc từ môi trường và KHÔNG bao giờ được in ra. */
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import pg from 'pg'
import { captureSchema, diffSchema } from './schema-readiness.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, snapshotPath } from './schema-readiness.mjs'

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const baseline = arg('baseline', '20261120')
const jsonOut = arg('json', '')
const url = process.env.SUPABASE_DB_URL || arg('db-url', '')

const loadSnapshot = version => JSON.parse(readFileSync(snapshotPath(version), 'utf8'))

/* ------------------------------- phân loại -------------------------------
   Hàm thuần, tách khỏi I/O để kiểm được bằng node --test: xem
   tools/schemaDriftReport.test.mjs. */
export function classifyDrift (expected, actual, problems) {
  const artifacts = []
  const review = []
  const artifactKeys = new Set()

  /* (1) constraint NOT NULL của PG18: chỉ là cách PG18 ghi lại đúng thuộc tính
     `attnotnull` mà fingerprint đã có ở từng cột. Nó chỉ được xếp vào nhóm
     "cơ chế catalog" khi bản thân CỘT trong database đích thật sự not null —
     nếu cột mất NOT NULL thì đó là drift thật và phải ở lại nhóm review. */
  for (const [table, spec] of Object.entries(expected.tables)) {
    for (const want of spec.constraints ?? []) {
      if (want.type !== 'n') continue
      const got = actual.tables[table]
      const matched = got?.constraints?.some(c => c.name === want.name
        || (c.type === want.type && String(c.columns) === String(want.columns)))
      if (matched) continue
      const column = want.columns[0]
      const live = got?.columns?.[column]
      const label = `${want.type} on public.${table}(${want.columns.join(', ')})`
      const detail = `expected ${want.definition}`
      if (live && live.notNull === true) {
        artifacts.push({ table, column, constraint: want.name, definition: want.definition })
      } else {
        /* Không có NOT NULL trên cột: đây là drift thật, và câu ở đây nói đúng
           chuyện hơn câu chung của diffSchema — nên đăng ký khoá để vòng lặp
           dưới không kể lại lần hai. */
        review.push({
          kind: live ? 'incompatible-nullability' : 'missing-column',
          object: `public.${table}.${column}`,
          detail: live
            ? `baseline ghi NOT NULL nhưng database không có (lost NOT NULL) — ${want.definition}`
            : `cột không tồn tại; fingerprint cần constraint ${want.name} (${want.definition})`,
        })
      }
      /* Dù là artifact hay drift thật, problem gốc của constraint này đã được
         xử lý ở trên. */
      artifactKeys.add(`${label}|${detail}`)
    }
  }

  /* (2) Mọi problems khác của diffSchema: giữ nguyên, không diễn giải lại. */
  for (const problem of problems) {
    const key = `${problem.object}|${problem.detail}`
    if (problem.kind === 'missing-constraint' && artifactKeys.has(key)) continue
    review.push(problem)
  }

  /* (3) Chiều ngược lại: database ghi constraint 'n' mà fingerprint không có
     (fingerprint sinh trên bản PostgreSQL cũ). Không phải lỗi. */
  const reverse = []
  for (const [table, spec] of Object.entries(actual.tables)) {
    for (const got of spec.constraints ?? []) {
      if (got.type !== 'n') continue
      const known = expected.tables[table]?.constraints?.some(c => c.name === got.name
        || (c.type === got.type && String(c.columns) === String(got.columns)))
      if (!known) reverse.push(`public.${table}(${got.columns.join(', ')}) — ${got.definition}`)
    }
  }
  return { artifacts, review, reverse }
}

/* ------------------------------- giải nghĩa -------------------------------
   diffSchema mô tả mục lệch bằng phía BASELINE ("expected …") vì nó chỉ cần
   trả lời đúng/sai. Người đọc thì cần cả phía database thật để phán đoán, nên
   ở đây tra ngược lại giá trị đang có. */
export function enrichReview (expected, actual, review) {
  const CONSTRAINT_KIND = { p: 'primary key', u: 'unique', f: 'foreign key', c: 'check' }
  return review.map(item => {
    const found = {}
    if (item.kind === 'incompatible-index' || item.kind === 'missing-index') {
      for (const [table, spec] of Object.entries(actual.tables)) {
        const hit = (spec.indexes ?? []).find(i => i.name === item.object)
        if (hit) found.index = { table, definition: hit.definition }
      }
    } else if (item.kind.includes('policy')) {
      const m = /^public\.(\S+) policy (\S+)$/.exec(item.object)
      if (m) {
        const hit = (actual.tables[m[1]]?.policies ?? []).find(p => p.name === m[2])
        if (hit) found.policy = hit
        else found.policy = null
      }
    } else if (item.kind.includes('constraint')) {
      const m = / on public\.(\S+)\(([^)]*)\)$/.exec(item.object)
      if (m) {
        const [, table, columns] = m
        const want = (expected.tables[table]?.constraints ?? []).find(c =>
          `${CONSTRAINT_KIND[c.type] ?? c.type} on public.${table}(${c.columns.join(', ')})` === item.object)
        const hit = want && ((actual.tables[table]?.constraints ?? []).find(c => c.name === want.name)
          ?? (actual.tables[table]?.constraints ?? []).find(c => c.type === want.type && String(c.columns) === String(want.columns)))
        found.constraint = hit ?? null
        if (want) found.expectedConstraint = want
      }
    } else if (item.kind.includes('function')) {
      const signature = item.object.replace(/^public\./, '')
      found.function = actual.functions[signature] ?? null
    }
    return Object.keys(found).length ? { ...item, found } : item
  })
}

/* --------------------------- objects chỉ có ở DB thật ---------------------
   diffSchema chỉ ghi chú (không tính là problem) cho extra table/function, và
   không nhìn tới index/policy/trigger thừa. Nhưng đúng những thứ đó lại là
   thứ phải đọc khi quyết định "khớp database về baseline" hay "cập nhật
   baseline theo database". Kèm quyền EXECUTE của hàm thừa: một overload cũ còn
   mở cho `authenticated` là chuyện an toàn, không phải chuyện trang trí. */
export async function liveOnly (client, expected, actual) {
  const out = { functions: [], triggers: [], indexes: [], policies: [], tables: [] }
  for (const [signature, spec] of Object.entries(actual.functions)) {
    if (expected.functions[signature]) continue
    const { rows } = await client.query(`
      select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
             pg_get_functiondef(p.oid) as definition
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = $1`, [signature])
    out.functions.push({ signature, ...spec, grants: rows[0] ?? null })
  }
  for (const [table, spec] of Object.entries(actual.tables)) {
    const want = expected.tables[table]
    if (!want) { out.tables.push(`public.${table}`); continue }
    const wantNames = (list, kind) => new Set((kind ? list?.[kind] : list ?? []).map(x => x.name))
    const indexNames = wantNames(want.indexes)
    for (const i of spec.indexes ?? []) if (!indexNames.has(i.name)) out.indexes.push(`public.${table} ${i.name}: ${i.definition}`)
    const policyNames = wantNames(want.policies)
    for (const p of spec.policies ?? []) if (!policyNames.has(p.name)) out.policies.push(`public.${table} ${p.name} (${p.cmd}, ${p.roles})`)
    const triggerNames = wantNames(want.triggers)
    for (const t of spec.triggers ?? []) if (!triggerNames.has(t.name)) out.triggers.push(`public.${table} ${t.name}`)
  }
  return out
}

const yn = v => (v === true ? 'T' : v === false ? 'F' : '?')

const main = async () => {
  if (!url) {
    console.error('Cần SUPABASE_DB_URL (hoặc --db-url). Công cụ chỉ đọc, không in chuỗi kết nối.')
    process.exit(2)
  }
  const snapshot = loadSnapshot(baseline)
  const expected = snapshot.state
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const { rows: [probe] } = await client.query('select version() as version, current_setting(\'server_version_num\')::int as num')
    const actual = await captureSchema(client)
    const { problems, notes } = diffSchema(expected, actual)
    const { artifacts, review, reverse } = classifyDrift(expected, actual, problems)
    const extras = await liveOnly(client, expected, actual)
    const enriched = enrichReview(expected, actual, review)

    const kinds = {}
    for (const p of problems) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1

    console.log(`\nPHIÊN BẢN & NGUỒN`)
    console.log(`  server_version : ${probe.version.split(' ').slice(0, 2).join(' ')} (server_version_num=${probe.num})`)
    console.log(`  fingerprint    : ${baseline} — sinh trên PostgreSQL ${snapshot.postgresMajor ?? '?'} (${String(snapshot.generatedBy ?? '').slice(0, 60)}…)`)
    console.log(`  problems       : ${problems.length}  · notes: ${notes.length}`)
    console.log(`  theo kind      : ${Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(', ')}`)

    console.log(`\nNHÓM A — khác biệt CƠ CHẾ CATALOG, không phải drift: ${artifacts.length}`)
    console.log('  (mỗi dòng: constraint NOT NULL kiểu PG18 vắng mặt, nhưng CHÍNH CỘT đó đang not null thật)')
    for (const a of artifacts.slice(0, 5)) console.log(`  · public.${a.table}.${a.column} — ${a.definition}`)
    if (artifacts.length > 5) console.log(`  · … và ${artifacts.length - 5} dòng nữa`)
    if (reverse.length) {
      console.log(`\n  (chiều ngược — database ghi 'n' mà fingerprint không có: ${reverse.length}; fingerprint sinh trên bản PG cũ hơn)`)
      for (const r of reverse.slice(0, 3)) console.log(`  · ${r}`)
    }

    console.log(`\nNHÓM B — CẦN NGƯỜI ĐỌC: ${review.length}`)
    for (const p of enriched) {
      console.log(`  · [${p.kind}] ${p.object}\n      ${p.detail}`)
      if (p.found?.index) console.log(`      database đang có: ${p.found.index.definition}`)
      if (p.found?.policy) {
        const pol = p.found.policy
        console.log(`      database đang có: ${pol.cmd} ${pol.roles} using (${pol.qual || '—'}) with check (${pol.withCheck || '—'})`)
      } else if (p.found && 'policy' in p.found && p.found.policy === null) {
        console.log('      database không có policy cùng tên này')
      }
      if (p.found?.constraint) console.log(`      database đang có: ${p.found.constraint.definition}`)
      else if (p.found && 'constraint' in p.found && p.found.constraint === null) console.log('      database không có constraint tương ứng')
    }

    /* Trục mà fingerprint KHÔNG hề so: quyền trên bảng/cột. Đây là chỗ một
       database có thể khác repo rất nhiều mà `db:verify-baseline` vẫn im lặng —
       ví dụ quyền INSERT mức BẢNG cho client (thay vì theo cột) nghĩa là client
       tự đặt được `deleted_at` khi tạo comment. */
    const aclTables = ['requests', 'request_comments', 'profiles', 'votes', 'daily_login_rewards']
    const tableAcl = []
    console.log(`\nQUYỀN TRÊN BẢNG (fingerprint không so phần này):`)
    for (const table of aclTables) {
      if (!(await client.query('select to_regclass($1) as t', [`public.${table}`])).rows[0].t) continue
      for (const role of ['anon', 'authenticated']) {
        const { rows: [r] } = await client.query(
          `select has_table_privilege($1, $2, 'SELECT') as s, has_table_privilege($1, $2, 'INSERT') as i,
                  has_table_privilege($1, $2, 'UPDATE') as u, has_table_privilege($1, $2, 'DELETE') as d`,
          [role, `public.${table}`])
        tableAcl.push({ table, role, select: r.s, insert: r.i, update: r.u, delete: r.d })
        console.log(`  public.${table} · ${role}: select=${yn(r.s)} insert=${yn(r.i)} update=${yn(r.u)} delete=${yn(r.d)}`)
      }
      const cols = (await client.query(`
        select grantee, column_name from information_schema.column_privileges
         where table_schema = 'public' and table_name = $1 and privilege_type = 'INSERT'
           and grantee in ('anon', 'authenticated') order by grantee, column_name`, [table])).rows
      for (const grantee of ['anon', 'authenticated']) {
        const list = cols.filter(c => c.grantee === grantee).map(c => c.column_name)
        if (list.length) {
          console.log(`      INSERT theo cột cho ${grantee}: ${list.join(', ')}`)
          tableAcl.push({ table, role: grantee, insertColumns: list })
        }
      }
    }

    const extraCount = Object.values(extras).reduce((n, list) => n + list.length, 0)
    console.log(`\nOBJECTS CHỈ CÓ Ở DATABASE THẬT (baseline không khai): ${extraCount}`)
    for (const f of extras.functions) {
      console.log(`  · function public.${f.signature} → returns ${f.returns ?? '?'} (security definer=${f.securityDefiner ?? '?'}, ${f.language ?? '?'})`)
      console.log(`      quyền EXECUTE: anon=${yn(f.grants?.anon)} authenticated=${yn(f.grants?.authenticated)} service_role=${yn(f.grants?.service_role)}`)
      const body = String(f.grants?.definition ?? '').trim().split('\n')
      for (const line of body.slice(0, 25)) console.log(`      │ ${line}`)
      if (body.length > 25) console.log(`      │ … (${body.length - 25} dòng nữa — xem trong JSON)`)
    }
    for (const t of extras.triggers) console.log(`  · trigger ${t} (chỉ có ở database thật)`)
    for (const i of extras.indexes) console.log(`  · index ${i}`)
    for (const p of extras.policies) console.log(`  · policy ${p}`)
    for (const t of extras.tables) console.log(`  · table ${t}`)

    console.log('\nGHI CHÚ CỦA CỔNG (không phải problem):')
    for (const n of notes) console.log(`  · ${n}`)

    if (jsonOut) {
      writeFileSync(jsonOut, JSON.stringify({
        baseline, serverVersion: probe.version, fingerprintPostgresMajor: snapshot.postgresMajor,
        counts: { problems: problems.length, artifacts: artifacts.length, review: review.length },
        kinds, artifacts, review, reverse, extras, notes, tableAcl,
        generatedBy: join(REPO, 'tools/schema-drift-report.mjs'),
      }, null, 2))
      console.log(`\nJSON: ${jsonOut}`)
    }

    console.log(`\n──────── có ${review.length} mục cần người đọc, ${artifacts.length} mục do cơ chế catalog ────────`)
    console.log('Công cụ này KHÔNG thay thế db:verify-baseline: cổng vẫn NOT READY cho tới khi repo và database')
    console.log('thật sự khớp nhau qua một thay đổi được review (không nới điều kiện kiểm).')
    process.exit(review.length ? 1 : 0)
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
