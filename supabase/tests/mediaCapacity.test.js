import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(fileURLToPath(new URL('../migrations/20261219_homepage_video_limit.sql', import.meta.url)), 'utf8')

test('database allows 20 Latest videos beside one Featured item, but not a 21st video', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create table public.media (
      id uuid primary key default gen_random_uuid(),
      kind text not null
    );`)
    await db.exec(migration)
    await db.exec(`insert into public.media(kind) values ('featured');`)
    for (let i = 0; i < 19; i++) await db.exec(`insert into public.media(kind) values ('video');`)

    await db.exec(`insert into public.media(kind) values ('video');`)
    const { rows } = await db.query(`select kind, count(*)::int as n from public.media group by kind`)
    assert.deepEqual(Object.fromEntries(rows.map(row => [row.kind, row.n])), { featured: 1, video: 20 })

    await assert.rejects(db.exec(`insert into public.media(kind) values ('video');`), /err\.mediaLimit/)
    await assert.rejects(db.exec(`insert into public.media(kind) values ('featured');`), /err\.mediaFeaturedLimit/)
    await assert.rejects(db.exec(`update public.media set kind = 'video' where kind = 'featured';`), /err\.mediaLimit/)
    await assert.rejects(db.exec(`update public.media set kind = 'featured' where id = (
      select id from public.media where kind = 'video' limit 1
    );`), /err\.mediaFeaturedLimit/)
  } finally {
    await db.close()
  }
})
