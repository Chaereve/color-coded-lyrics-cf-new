import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { splitSchema, PARTS, MAX_PART_BYTES } from '../../scripts/split-schema.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const schema = read('../schema.sql')
const chunks = splitSchema(schema)

test('SQL Editor setup files concatenate byte-for-byte to the canonical schema', () => {
  assert.deepEqual(readdirSync(new URL('../setup/', import.meta.url))
    .filter(name => /^\d\d-.*\.sql$/.test(name)).sort(), PARTS.map(({ name }) => name).sort())
  for (const { name, sql } of chunks) {
    assert.equal(read(`../setup/${name}`), sql, `${name} needs regeneration (npm run schema:split)`)
    assert.ok(Buffer.byteLength(sql, 'utf8') <= MAX_PART_BYTES, `${name} is too large for the small-file workflow`)
  }
  assert.equal(chunks.map(({ sql }) => sql).join(''), schema)
})

test('splitter refuses missing / duplicate cut markers or an oversized final part', () => {
  assert.throws(() => splitSchema(schema.replace('-- BEGIN COMMENTS / SPIN FIXES:', '-- missing marker')), /Ranh giới/)
  assert.throws(() => splitSchema(schema + '\n-- BEGIN DAILY SPIN:\n'), /Ranh giới/)
  assert.throws(() => splitSchema(schema + '\n' + ' '.repeat(MAX_PART_BYTES)), /vượt/)
})

// Only with a LOCAL / TEST PostgreSQL superuser with CREATEDB; never production.
// Every chunk gets a NEW connection (as it does in Supabase SQL Editor tabs).
// SCHEMA_CHUNKS_TEST_DATABASE_URL=postgres://... node --test supabase/tests/schemaChunks.test.js
const url = process.env.SCHEMA_CHUNKS_TEST_DATABASE_URL
test('SQL Editor chunks install on separate connections into a disposable fresh DB',
  { skip: !url, timeout: 90_000 }, async () => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    const name = `ccl_setup_test_${randomUUID().replaceAll('-', '')}`
    let created = false
    try {
      await admin.query(`create database ${name} template template0 encoding 'UTF8'`)
      created = true
      const target = new URL(url)
      target.pathname = `/${name}`
      const connect = () => new pg.Client({ connectionString: target.toString() })
      const initial = connect()
      await initial.connect()
      try {
        await initial.query(`
          do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
          do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
          do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
          create schema auth;
          create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
          create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
          $$;
          grant usage on schema public, auth to anon, authenticated;
          alter default privileges in schema public grant all on tables to anon, authenticated;
          alter default privileges in schema public grant all on sequences to anon, authenticated;
          create publication supabase_realtime;
        `)
      } finally { await initial.end() }
      for (const { name, sql } of chunks) {
        const db = connect()
        await db.connect()
        try { await db.query(sql) }
        catch (error) { error.message = `${name}: ${error.message}`; throw error }
        finally { await db.end() }
      }
      const check = connect()
      await check.connect()
      try {
        const { rows: [result] } = await check.query(`
          select to_regclass('public.requests') is not null as requests_ok,
                 to_regclass('public.daily_spins') is not null as spins_ok,
                 to_regclass('public.request_comments') is not null as comments_ok,
                 to_regclass('public.activity_days') is not null as activity_ok,
                 to_regclass('public.achievement_rewards') is not null as achievements_ok,
                 to_regprocedure('public.touch_my_activity()') is not null as visit_rpc_ok,
                 exists (select 1 from pg_policies where schemaname = 'public'
                           and tablename = 'votes' and policyname = 'read own votes') as votes_rls_ok
        `)
        assert.ok(Object.values(result).every(Boolean), JSON.stringify(result))
      } finally { await check.end() }
    } finally {
      try {
        if (created) await admin.query(`drop database ${name} with (force)`)
      } finally { await admin.end() }
    }
  })
