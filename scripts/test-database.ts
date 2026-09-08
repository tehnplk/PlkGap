import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, databaseStatus, loadReferenceTables, createFileTables, createAppTables, listImportLog } from '../src/main/database.ts'
import type { FileStructure } from '../src/main/database.ts'
import fileStructure from '../src/main/reference/f43-tables.json' with { type: 'json' }

async function main() {
const directory = await mkdtemp(join(tmpdir(), 'plkgap-db-test-'))
let db
try {
  db = await openDatabase(join(directory, 'db'))
  const status = await databaseStatus(db, directory)
  assert.match(status.postgis, /POSTGIS=/)
  await db.exec(`CREATE TABLE test_places (location geometry(Point, 4326));
    INSERT INTO test_places VALUES (ST_SetSRID(ST_MakePoint(100.2659, 16.8211), 4326));`)
  await db.close()
  db = await openDatabase(join(directory, 'db'))
  const { rows } = await db.query(`SELECT ST_AsText(location) AS point,
    ST_SRID(location) AS srid, ST_IsValid(location) AS valid FROM test_places`)
  assert.deepEqual(rows, [{ point: 'POINT(100.2659 16.8211)', srid: 4326, valid: true }])
  console.log('PASS: PostGIS spatial query and persistence after reopen')

  const load = await db.query<{ table_count: number; row_count: number }>(
    `SELECT table_count, row_count FROM schema_init WHERE component = 'reference'`)
  assert.equal(load.rows.length, 1, 'reference load is recorded once')
  assert.ok(load.rows[0].table_count >= 120, 'every c_* reference table is created')
  assert.ok(load.rows[0].row_count > 4000, 'reference rows are seeded')

  const tables = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'c\\_%'`)
  assert.equal(tables.rows[0].n, load.rows[0].table_count, 'created tables match the recorded count')
  assert.equal((await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name IN ('c_user_provider','c_user_role')`)).rows.length,
    0, 'SUB-HDC account tables are not shipped')

  const schema = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM c_files_schema')
  assert.ok(schema.rows[0].n > 700, 'the 43-file data dictionary is loaded')
  const hospital = await db.query<{ hospname: string }>(
    'SELECT hospname FROM c_hospital WHERE hospcode = $1', ['07476'])
  assert.match(hospital.rows[0].hospname, /วังน้ำคู้/, 'Thai reference text survives the round trip')
  const typed = await db.query<{ no: number; is_active: number }>(
    `SELECT no, is_active FROM c_files_schema WHERE table_name='ACCIDENT' ORDER BY no LIMIT 1`)
  assert.deepEqual(typed.rows[0], { no: 1, is_active: 1 }, 'integer columns stay numeric')

  const again = await loadReferenceTables(db)
  assert.equal(again.applied, false, 'a second load of the same version is a no-op')
  console.log(`PASS: ${load.rows[0].table_count} SUB-HDC c_* reference tables (${load.rows[0].row_count} rows) seeded idempotently`)

  const files = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM c_file`)
  assert.equal(files.rows[0].n, 52, 'c_file lists the 52 standard files')
  const created = await db.query<{ name: string }>(
    `SELECT t.table_name AS name FROM information_schema.tables t
     WHERE t.table_schema='public' AND t.table_name IN (SELECT file_name FROM c_file)`)
  assert.equal(created.rows.length, 52, 'every file in c_file has a table')
  const empty = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM person')
  assert.equal(empty.rows[0].n, 0, 'the 43-file tables ship without rows')

  const personColumns = await db.query<{ column_name: string; data_type: string; character_maximum_length: number; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public' AND table_name='person' ORDER BY ordinal_position`)
  assert.equal(personColumns.rows.length, 35, 'person keeps all of its SUB-HDC columns')
  assert.deepEqual(personColumns.rows[0], { column_name: 'hospcode', data_type: 'character varying', character_maximum_length: 10, is_nullable: 'NO', column_default: `''::character varying` })
  const primaryKey = await db.query<{ column_name: string }>(
    `SELECT a.attname AS column_name FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = 'person'::regclass AND i.indisprimary`)
  assert.deepEqual(primaryKey.rows.map((row) => row.column_name).sort(), ['hospcode', 'pid'], 'composite primary key is mirrored')
  assert.equal((await db.query(`SELECT 1 FROM pg_indexes WHERE indexname='idx_person_cid'`)).rows.length, 1, 'secondary indexes are mirrored')

  await db.query(`INSERT INTO person (hospcode, pid, cid) VALUES ('07476', '00001', '1234567890123')`)
  const inserted = await db.query<{ hid: string; log_import_id: number | null }>('SELECT hid, log_import_id FROM person')
  assert.deepEqual(inserted.rows, [{ hid: '', log_import_id: null }], 'NOT NULL columns fall back to the SUB-HDC empty-string default')
  await db.query('DELETE FROM person')

  const rerun = await createFileTables(db)
  assert.equal(rerun.applied, false, 'creating the file tables again is a no-op')
  assert.equal(rerun.created, 0, 'creating the file tables again adds nothing')
  console.log(`PASS: ${rerun.table_count} 43-file tables created empty with SUB-HDC columns, keys and indexes`)

  // Setup happens once: reopening the database must not redo or re-stamp any of it.
  const before = await db.query<{ component: string; initialized_at: Date }>(
    'SELECT component, initialized_at FROM schema_init ORDER BY component')
  assert.deepEqual(before.rows.map((row) => row.component), ['app', 'files43', 'reference'], 'every component is recorded')
  await db.close()
  db = await openDatabase(join(directory, 'db'))
  const after = await db.query<{ component: string; initialized_at: Date }>(
    'SELECT component, initialized_at FROM schema_init ORDER BY component')
  assert.deepEqual(after.rows, before.rows, 'a later start reuses the schema instead of rebuilding it')
  assert.equal((await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'reference_load'`)).rows.length,
    0, 'the old reference_load marker is gone')
  console.log('PASS: schema is initialized once and skipped on later starts')

  // The 43-file tables accumulate imported rows, so a newer structure file must only ever add.
  await db.query(`INSERT INTO person (hospcode, pid, cid) VALUES ('07476', '00042', '1234567890123')`)
  await db.query(`INSERT INTO home (hospcode, hid) VALUES ('07476', '00042')`)
  const newer = structuredClone(fileStructure) as FileStructure
  newer.pulledAt = new Date().toISOString()
  newer.tables.find((table) => table.name === 'person')!.columns.push(
    { name: 'new_upstream_column', type: 'varchar', length: 20, nullable: false, default: "''" })
  newer.tables.push({ name: 'brand_new_file', columns: [
    { name: 'hospcode', type: 'varchar', length: 10, nullable: false, default: "''" },
  ], primaryKey: ['hospcode'], indexes: [] })

  const upgrade = await createFileTables(db, newer)
  assert.equal(upgrade.applied, true, 'a newer structure file is applied')
  assert.equal(upgrade.created, 1, 'only the genuinely new table is created')
  const kept = await db.query<{ pid: string; new_upstream_column: string }>(
    'SELECT pid, new_upstream_column FROM person')
  assert.deepEqual(kept.rows, [{ pid: '00042', new_upstream_column: '' }],
    'imported rows survive a structure upgrade and pick up the new column default')
  assert.equal((await db.query('SELECT 1 FROM home')).rows.length, 1, 'other imported rows are untouched')
  await db.exec('DELETE FROM person; DELETE FROM home; DROP TABLE brand_new_file;')
  console.log('PASS: imported 43-file rows survive re-init and structure upgrades')

  // The app's own import history: created at setup, kept across restarts, clearable on demand.
  assert.equal((await listImportLog(db)).length, 0, 'a fresh install starts with an empty import log')
  await db.query(`INSERT INTO import52files_log
    (file_name, file_path, file_size, started_at, status, progress_percent, row_count, message)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($9, $10, $11, $12, $13, $14, $15, $16)`, [
    'F43_07494_20260819111824.ZIP', 'C:\Desktop\F43_07494_20260819111824.ZIP', 180421, '2026-09-01 08:00', 'complete', 100, 48213, '',
    'F43_BAD.zip', 'C:\Desktop\F43_BAD.zip', 900, '2026-09-08 09:30', 'failed', 0, 0, 'ไม่ใช่ 52 แฟ้มมาตรฐาน',
  ])
  const log = await listImportLog(db)
  assert.equal(log.length, 2, 'the log lists every run')
  assert.deepEqual(log.map((row) => row.fileName), ['F43_BAD.zip', 'F43_07494_20260819111824.ZIP'],
    'runs come back sorted by import date, newest first')
  assert.equal(log[1].rowCount, 48213)
  assert.equal(log[1].finishedAt, null)

  const untouched = await createAppTables(db)
  assert.equal(untouched.applied, false, 'the app schema is only built once')
  await db.close()
  db = await openDatabase(join(directory, 'db'))
  assert.equal((await listImportLog(db)).length, 2, 'the import log survives a restart')
  console.log('PASS: import52files_log accumulates runs newest first and survives restarts')
} finally {
  if (db && !db.closed) await db.close()
  await rm(directory, { recursive: true, force: true })
}
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
