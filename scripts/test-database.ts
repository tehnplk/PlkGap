import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, databaseStatus, loadReferenceTables, createFileTables, createAppTables, countByFiscalYears, listImportLog, startImportRun, insertStandardRows, loadGeographyTables } from '../src/main/database.ts'
import type { FileStructure } from '../src/main/database.ts'
import { checkObservations, observationRows, listObservationRules, setObservationRuleActive, syncObservationRules } from '../src/main/database.ts'
import { describeTable, listTables, runReadOnlySql, createApiSchema, MASK } from '../src/main/database.ts'
import fileStructure from '../src/main/reference/f43-tables.json' with { type: 'json' }
import referenceData from '../src/main/reference/c-tables.json' with { type: 'json' }
import structureCodes from '../src/main/reference/structure-codes.json' with { type: 'json' }
import standardCodes from '../src/main/reference/standard-codes.json' with { type: 'json' }
import { buildStructureCodes } from './generate-structure-codes.mjs'
import { checkImportStructure, structureFailingRows, structureResult, referenceCodeList, loadStructureCodeTables, referenceTablesInUse } from '../src/main/database.ts'

async function main() {
const directory = await mkdtemp(join(tmpdir(), 'plkgap-db-test-'))
let db
try {
  db = await openDatabase(join(directory, 'db'))
  const status = await databaseStatus(db, directory)
  assert.match(status.postgis, /POSTGIS=/)

  // Fresh tables (the 52 files, both logs) arrive as structure only, zero rows. Initial tables
  // (the code lists, the component register and the rule catalog) arrive with the rows this run
  // wrote from code and the reference files — never rows shipped as data.
  const ours = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE 'c\\_%' AND table_name <> 'spatial_ref_sys' ORDER BY table_name`)
  const freshTables = ours.rows.map((row) => row.table_name)
    .filter((name) => name !== 'schema_init' && name !== 'observ_check')
  assert.equal(freshTables.length, fileStructure.tables.length + 2,
    'the 52 files and the two log tables are the fresh tables')
  for (const name of freshTables) {
    const count = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${name}"`)
    assert.equal(count.rows[0].n, 0, `fresh table ${name} is structure only on a new installation`)
  }
  const components = await db.query<{ component: string }>('SELECT component FROM schema_init ORDER BY component')
  assert.deepEqual(components.rows.map((row) => row.component),
    ['api', 'app', 'files43', 'geography', 'observations', 'reference', 'structure_codes'],
    'schema_init records exactly the components this install ran')
  // observ_check is an initial table: the register seeds itself from observationRules(), all active.
  const seededRules = await listObservationRules(db)
  assert.ok(seededRules.length > 0 && seededRules.every((rule) => rule.active),
    'every registered rule starts active, straight from code')
  console.log(`PASS: new installation — ${freshTables.length} fresh tables hold no rows, `
    + `initial tables hold ${components.rows.length} components and ${seededRules.length} rules`)

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
  assert.equal(load.rows[0].table_count, referenceTablesInUse.length,
    'only the dictionary, the file list and the service-unit registry are seeded from the snapshot')
  assert.ok(load.rows[0].row_count > 1000, 'reference rows are seeded')
  // The snapshot's own code lookups are not seeded; the catalog owns those names now.
  const retired = referenceData.tables.map((table) => table.name)
    .filter((name) => !referenceTablesInUse.includes(name) && !structureCodes.tables.some((table) => table.name === name))
  const leftovers = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`, [retired])
  assert.deepEqual(leftovers.rows, [], 'retired lookups are dropped, not left behind')

  const tables = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema='public' AND table_name LIKE 'c\\_%'
       AND table_name NOT IN ('c_province', 'c_district', 'c_subdistrict')`)
  const supplements = await db.query<{ table_count: number; row_count: number }>(
    `SELECT table_count, row_count FROM schema_init WHERE component = 'structure_codes'`)
  assert.equal(tables.rows[0].n, load.rows[0].table_count + supplements.rows[0].table_count,
    'created tables match the snapshot remnant plus the separately recorded catalog')
  assert.equal(status.referenceTables, tables.rows[0].n)
  assert.equal(status.referenceRows, load.rows[0].row_count + supplements.rows[0].row_count)
  assert.deepEqual(buildStructureCodes(referenceData), structureCodes, 'generated catalog matches its two sources')
  assert.ok(structureCodes.tables.length > standardCodes.tables.length,
    'the catalog is the published lists plus the enumerations the dictionary spells out')
  // Every published list is seeded exactly as pulled; CLINIC is composed per hospital, so its
  // department list stays a lookup and never becomes a whole-value code rule.
  for (const table of standardCodes.tables) {
    const seeded = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table.name}`)
    assert.equal(seeded.rows[0].n, table.rows.length, `${table.name} is seeded from the published list`)
  }
  assert.ok(!structureCodes.bindings.some((binding) => binding.reference === 'c_clinic_department'),
    'the clinic department list is never used as a whole-value code rule')
  // No table drifts into the catalog unused: it either serves a field or says why it does not.
  const bound = new Set(structureCodes.bindings.map((binding) => binding.reference))
  const declared = new Set(structureCodes.unbound.map((entry) => entry.reference))
  assert.deepEqual(structureCodes.tables.map((table) => table.name)
    .filter((name) => !bound.has(name) && !declared.has(name)), [], 'every catalog table is bound or declared unbound')
  assert.ok(structureCodes.unbound.every((entry) => entry.reason.length > 20), 'an unbound table carries its reason')
  // Nothing relies on the c_<file>_<column> fallback: every rule comes from a binding that is
  // written down, so reading the catalog tells the whole story.
  const byBinding = new Set(structureCodes.bindings.map((binding) => `${binding.table}.${binding.column}`))
  const dictionary = await db.query<{ field: string }>(`SELECT LOWER(table_name) || '.' || LOWER(name) AS field
    FROM c_files_schema WHERE is_active = 1`)
  const implicit = dictionary.rows.map((row) => row.field).filter((field) => !byBinding.has(field)
    && structureCodes.tables.some((table) => table.name === `c_${field.replace('.', '_')}`))
  assert.deepEqual(implicit, [], 'no field is validated by naming convention alone')
  // labor.bplace states its codes in prose the parser cannot read, so they are transcribed from the
  // same description. A visit number and a severity scale get no code list at all, by decision.
  assert.ok(structureCodes.audit.some((entry) => entry.field === 'labor.bplace' && entry.status === 'transcribed'),
    'labor.bplace keeps its code rule')
  assert.ok(!structureCodes.bindings.some((binding) => ['anc.ancno', 'drugallergy.alevel']
    .includes(`${binding.table}.${binding.column}`)), 'ancno and alevel are left to the required and width rules')
  const prename = await db.query<{ code: string; sex: string; description: string }>(
    `SELECT code, sex, description FROM c_person_prename WHERE code IN ('001', '099') ORDER BY code`)
  assert.deepEqual(prename.rows, [
    { code: '001', sex: '1', description: 'เด็กชาย' },
    { code: '099', sex: '', description: 'พระเจ้าหลานเธอ พระองค์เจ้า' },
  ], 'a title used by one sex keeps it; a title used by both carries none')
  assert.equal(structureCodes.bindings.find((binding) => binding.table === 'icf' && binding.column === 'icf')?.reference,
    'c_icf_icf', 'ICF validates the condition code, with its qualifier checked separately')
  assert.equal(structureCodes.bindings.find((binding) => binding.table === 'provider' && binding.column === 'sex')?.reference,
    'c_person_sex', 'provider sex reuses the existing equivalent list')
  assert.ok(!structureCodes.bindings.some((binding) => ['chronic.date_disch', 'person.ddischarge', 'newborn.asphyxia']
    .includes(`${binding.table}.${binding.column}`)), 'dates and score ranges are not guessed')
  assert.equal((await loadStructureCodeTables(db)).applied, false, 'unchanged code lists do not re-seed')
  assert.equal((await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name IN ('c_user_provider','c_user_role')`)).rows.length,
    0, 'account tables are not shipped')

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
  console.log(`PASS: ${load.rows[0].table_count} c_* reference tables (${load.rows[0].row_count} rows) seeded idempotently`)

  // The geography lookup keys on the same CHANGWAT/AMPUR/TAMBON codes the 43 files use.
  const geography = await db.query<{ table_count: number; row_count: number }>(
    `SELECT table_count, row_count FROM schema_init WHERE component = 'geography'`)
  assert.equal(geography.rows[0].table_count, 3, 'province, district and subdistrict are seeded')
  assert.ok(geography.rows[0].row_count > 8000, 'the whole country is loaded')
  const area = await db.query<{ tambon: string; ampur: string; changwat: string }>(`
    SELECT t.name_th AS tambon, a.name_th AS ampur, p.name_th AS changwat
    FROM c_subdistrict t
    JOIN c_district a ON a.changwat = t.changwat AND a.ampur = t.ampur
    JOIN c_province p ON p.changwat = t.changwat
    WHERE t.changwat = '65' AND t.ampur = '01' AND t.tambon = '12'`)
  assert.deepEqual(area.rows[0], { tambon: 'จอมทอง', ampur: 'เมืองพิษณุโลก', changwat: 'พิษณุโลก' },
    'a 43-file address code resolves to the right names')
  assert.equal((await loadGeographyTables(db)).applied, false, 'the lookup is loaded once')
  console.log(`PASS: geography lookup (${geography.rows[0].row_count} rows) resolves 43-file address codes`)

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
  assert.equal(personColumns.rows.length, 35, 'person keeps all of its standard columns')
  assert.deepEqual(personColumns.rows[0], { column_name: 'hospcode', data_type: 'character varying', character_maximum_length: 10, is_nullable: 'NO', column_default: `''::character varying` })
  const primaryKey = await db.query<{ column_name: string }>(
    `SELECT a.attname AS column_name FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = 'person'::regclass AND i.indisprimary`)
  assert.deepEqual(primaryKey.rows.map((row) => row.column_name).sort(), ['hospcode', 'pid'], 'composite primary key is mirrored')
  assert.equal((await db.query(`SELECT 1 FROM pg_indexes WHERE indexname='idx_person_cid'`)).rows.length, 1, 'secondary indexes are mirrored')

  await db.query(`INSERT INTO person (hospcode, pid, cid) VALUES ('07476', '00001', '1234567890123')`)
  const inserted = await db.query<{ hid: string; log_import_id: number | null }>('SELECT hid, log_import_id FROM person')
  assert.deepEqual(inserted.rows, [{ hid: '', log_import_id: null }], 'NOT NULL columns fall back to the empty-string default')
  await db.query('DELETE FROM person')

  const rerun = await createFileTables(db)
  assert.equal(rerun.applied, false, 'creating the file tables again is a no-op')
  assert.equal(rerun.created, 0, 'creating the file tables again adds nothing')
  console.log(`PASS: ${rerun.table_count} 43-file tables created empty with standard columns, keys and indexes`)

  // Setup happens once: reopening the database must not redo or re-stamp any of it.
  const before = await db.query<{ component: string; initialized_at: Date }>(
    'SELECT component, initialized_at FROM schema_init ORDER BY component')
  assert.deepEqual(before.rows.map((row) => row.component), ['api', 'app', 'files43', 'geography', 'observations', 'reference', 'structure_codes'],
    'every component is recorded')
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

  // Imported rows name their zip by joining, not by copying the file name into every row.
  const run = await db.query<{ id: number }>(
    `SELECT id FROM import52files_log WHERE file_name = 'F43_07494_20260819111824.ZIP'`)
  const runId = run.rows[0].id
  await db.query(`INSERT INTO person (hospcode, pid, log_import_id) VALUES ('07476', '00050', $1)`, [runId])
  const joined = await db.query<{ pid: string; file_name: string }>(`
    SELECT p.pid, l.file_name FROM person p JOIN import52files_log l ON l.id = p.log_import_id`)
  assert.deepEqual(joined.rows, [{ pid: '00050', file_name: 'F43_07494_20260819111824.ZIP' }],
    'log_import_id joins a 43-file row back to the zip it came from')
  // The stamp is just a value: no foreign key, no index, nothing to slow a bulk import down.
  assert.equal((await db.query(`SELECT 1 FROM pg_constraint WHERE conname = 'person_log_import_id_fkey'`)).rows.length, 0,
    'log_import_id carries no foreign key')
  assert.equal((await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_person_log_import_id'`)).rows.length, 0,
    'log_import_id carries no index')
  await db.query('DELETE FROM person')
  console.log('PASS: import52files_log accumulates runs newest first and stamps the 52 files')

  // Importing the same key twice replaces the row instead of duplicating or skipping it.
  const header = ['HOSPCODE', 'PID', 'NAME', 'LNAME']
  const first = await startImportRun(db, { name: 'A.zip', path: 'A.zip', size: 1 })
  assert.equal(await insertStandardRows(db, first, 'person', header, [
    ['07488', '000001', 'สมชาย', 'ใจดี'],
    ['07488', '000002', 'สมหญิง', 'ใจงาม'],
    ['07488', '000002', 'สมหญิง', 'แก้ไขแล้ว'],
  ]), 2, 'a key repeated inside one file is written once')
  const dedup = await db.query<{ lname: string }>(`SELECT lname FROM person WHERE pid = '000002'`)
  assert.equal(dedup.rows[0].lname, 'แก้ไขแล้ว', 'the last occurrence in the file wins')

  const second = await startImportRun(db, { name: 'B.zip', path: 'B.zip', size: 1 })
  await insertStandardRows(db, second, 'person', header, [
    ['07488', '000001', 'สมชาย', 'นามสกุลใหม่'],
    ['07488', '000003', 'สมศรี', 'มาใหม่'],
  ])
  const replaced = await db.query<{ pid: string; lname: string; log_import_id: number }>(
    'SELECT pid, lname, log_import_id FROM person ORDER BY pid')
  assert.deepEqual(replaced.rows, [
    { pid: '000001', lname: 'นามสกุลใหม่', log_import_id: second },
    { pid: '000002', lname: 'แก้ไขแล้ว', log_import_id: first },
    { pid: '000003', lname: 'มาใหม่', log_import_id: second },
  ], 'a later file overwrites matching rows, re-stamps them, and adds the new ones')
  await db.query('DELETE FROM person')
  console.log('PASS: re-importing a key replaces the row instead of duplicating it')
  // ปริมาณข้อมูล splits by month only for a file that records activity on a date of its own.
  // "แฟ้มสะสม" comes from the manual's own marker in c_files_desc, not from what columns exist.
  for (const [table, column, byMonth, why] of [
    ['service', 'date_serv', true, 'a service file with its own date splits by month'],
    ['chronic', 'date_diag', false, 'CHRONIC has an event date but is แฟ้มสะสม, so it is yearly'],
    ['person', 'd_update', false, 'แฟ้มสะสม with no event date at all'],
    ['procedure_refer', 'd_update', false, 'a service file whose date the dictionary hides is yearly too'],
  ] as const) {
    const counted = await countByFiscalYears(db, table, [2569])
    assert.equal(counted.column, column, `${table} is counted by ${column}`)
    assert.equal(counted.byMonth, byMonth, why)
    assert.equal(counted.years.length, 1)
  }
  assert.deepEqual((await countByFiscalYears(db, 'service', [])).years, [], 'no fiscal year asked, nothing counted')
  await assert.rejects(() => countByFiscalYears(db, 'not_a_file', [2569]), /ไม่รู้จักแฟ้ม/)
  console.log('PASS: fiscal-year counting picks its date column and splits by month only for dated service files')

  // What the local HTTP API serves: a table's shape, and read-only SQL that PostgreSQL polices.
  const catalogue = await listTables(db)
  const byKind = (kind: string) => catalogue.filter((entry) => entry.kind === kind).map((entry) => entry.table)
  assert.equal(byKind('file43').length, 52, 'the 52 standard files are tagged as such')
  assert.ok(byKind('reference').length >= 120 && byKind('reference').every((name) => name.startsWith('c_')))
  assert.deepEqual(byKind('postgis'), ['spatial_ref_sys'], 'the extension table is not mistaken for ours')
  // Not an exact list: `test_places` from the PostGIS test above falls in here too, as it should.
  for (const name of ['import52files_log', 'observ_check', 'schema_init', 'structure_check_log']) {
    assert.ok(byKind('app').includes(name), `${name} is listed as one of PlkGap's own tables`)
  }
  assert.ok(catalogue.every((entry) => entry.rowCount === null), 'counting is off unless it is asked for')
  const withCounts = await listTables(db, true)
  assert.equal(withCounts.length, catalogue.length)
  assert.equal(withCounts.find((entry) => entry.table === 'c_file').rowCount, 52)
  assert.equal(withCounts.find((entry) => entry.table === 'person').rowCount, 0)
  assert.ok(withCounts.every((entry) => typeof entry.rowCount === 'number'))

  const described = await describeTable(db, 'PERSON')
  assert.equal(described.table, 'person', 'the table name is matched case-insensitively')
  assert.deepEqual(described.primaryKey, ['hospcode', 'pid'], 'the primary key keeps its order')
  // Not an exact count: the structure-upgrade test above added a column PERSON now keeps for good.
  assert.ok(described.columns.length >= 35, 'every PERSON column is described')
  assert.deepEqual(described.columns.slice(0, 3).map((column) => column.name), ['hospcode', 'cid', 'pid'],
    'columns keep their standard order')
  assert.match(described.columns[0].caption, /รหัสหน่วยบริการ/, 'the Thai dictionary text comes along')
  assert.match(described.description, /แฟ้มสะสม/, 'so does the file description')
  assert.ok(described.indexes.includes('idx_person_cid'))
  assert.equal(await describeTable(db, 'no_such_table'), null)
  assert.equal(await describeTable(db, 'person; DROP TABLE person'), null, 'a non-identifier is refused')

  const answer = await runReadOnlySql(db, 'SELECT file_name FROM c_file ORDER BY file_name LIMIT 3;')
  assert.deepEqual(answer.columns, ['file_name'])
  assert.deepEqual(answer.rows.map((row) => row.file_name), ['accident', 'address', 'admission'])
  assert.equal(answer.rowCount, 3)
  assert.equal(answer.truncated, false)
  const capped = await runReadOnlySql(db, 'SELECT * FROM c_hospital', 5)
  assert.equal(capped.rows.length, 5)
  assert.ok(capped.rowCount > 5 && capped.truncated, 'a long answer is capped and says so')
  const emptied = await runReadOnlySql(db, `SELECT hospcode, pid FROM person WHERE pid = 'nobody'`)
  assert.deepEqual(emptied.rows, [])
  assert.deepEqual(emptied.columns, ['hospcode', 'pid'], 'column names survive an empty answer')
  await assert.rejects(() => runReadOnlySql(db, '   '), /ต้องส่ง SQL/)
  // PostgreSQL refuses the write itself, so no keyword blacklist has to be kept in step. Two
  // things say no now: the read-only transaction, and the API role holding only SELECT.
  for (const write of [
    `INSERT INTO person (hospcode, pid) VALUES ('07488', 'API')`,
    'DELETE FROM person',
    'TRUNCATE person',
    'DROP TABLE person',
    `WITH gone AS (DELETE FROM person RETURNING pid) SELECT * FROM gone`,
  ]) await assert.rejects(() => runReadOnlySql(db, write), /read-only transaction|permission denied|must be owner/i, write)
  assert.equal((await runReadOnlySql(db, 'SELECT COUNT(*)::int AS n FROM c_file')).rows[0].n, 52,
    'the database is untouched after every refused write')
  console.log('PASS: local API describes a table and runs SQL that PostgreSQL holds read-only')

  // Personal data is masked inside the database, so no way of asking for it gets the real value.
  await db.query(`INSERT INTO person (hospcode, pid, cid, name, lname, telephone, mobile, birth)
    VALUES ('07488','MASK','1234567890123','สมชาย','ใจดี','055123456','0812345678','20000101')`)
  await db.query(`INSERT INTO home (hospcode, hid, house, house_id, telephone, village)
    VALUES ('07488','MASKH','99/1','65010112345','055999888','02')`)
  const plain = await runReadOnlySql(db, 'SELECT pid, cid, name, lname, telephone, mobile, birth FROM person')
  assert.deepEqual(plain.rows[0], { pid: 'MASK', cid: MASK, name: 'สมชาย', lname: MASK,
    telephone: MASK, mobile: MASK, birth: '20000101' }, 'only the listed columns are masked')
  // Each of these would defeat a check made on the names a query returns.
  const renamed = await runReadOnlySql(db, 'SELECT cid AS x, upper(lname) AS y, length(cid) AS n FROM person')
  assert.deepEqual(renamed.rows[0], { x: MASK, y: MASK, n: 3 }, 'an alias or a function still reads the mask')
  const buried = await runReadOnlySql(db, 'SELECT p.cid FROM (SELECT cid FROM person) p')
  assert.equal(buried.rows[0].cid, MASK, 'a subquery cannot carry the real value out')
  const wildcard = await runReadOnlySql(db, `SELECT * FROM home WHERE hid = 'MASKH'`)
  assert.equal(wildcard.rows[0].house, MASK)
  assert.equal(wildcard.rows[0].house_id, MASK)
  assert.equal(wildcard.rows[0].telephone, MASK)
  assert.equal(wildcard.rows[0].village, '02', 'SELECT * still answers, with the rest intact')
  // The two house entries are scoped to HOME, so ADDRESS keeps its own house columns in the clear.
  await db.query(`INSERT INTO address (hospcode, pid, addresstype, houseno, house_id)
    VALUES ('07488','MASK','1','88/2','65010199999')`)
  const scoped = await runReadOnlySql(db, `SELECT houseno, house_id FROM address WHERE pid = 'MASK'`)
  assert.deepEqual(scoped.rows[0], { houseno: '88/2', house_id: '65010199999' },
    'a table-scoped entry does not mask the same column name in another file')
  await assert.rejects(() => runReadOnlySql(db, 'SELECT cid FROM public.person'),
    /permission denied/, 'the real table is out of reach for the API role entirely')
  const inside = await db.query('SELECT cid, lname, mobile FROM person WHERE pid = $1', ['MASK'])
  assert.deepEqual(inside.rows[0], { cid: '1234567890123', lname: 'ใจดี', mobile: '0812345678' },
    'the app itself reads the real values, the mask is only on the API')
  await db.exec(`DELETE FROM person WHERE pid = 'MASK'; DELETE FROM home WHERE hid = 'MASKH';
    DELETE FROM address WHERE pid = 'MASK';`)
  console.log(`PASS: /sql masks ${MASK} at source — alias, function, subquery and SELECT * all get it`)

  // An installed database carries api views over its reference tables; re-seeding drops the tables
  // and the views with them, so the next api build has to notice and put them back.
  const upgraded = await loadReferenceTables(db, { ...referenceData, pulledAt: 'upgrade-probe' })
  assert.equal(upgraded.applied, true, 'a changed snapshot re-seeds instead of failing on a dependent view')
  const orphaned = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.views
     WHERE table_schema = 'api' AND table_name = 'c_files_schema'`)
  assert.equal(orphaned.rows[0].n, 0, 'the cascade takes the view of a rebuilt table with it')
  assert.equal((await createApiSchema(db)).applied, true, 'missing views are rebuilt even at the same digest')
  assert.equal((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.views
    WHERE table_schema = 'api' AND table_name = 'c_files_schema'`)).rows[0].n, 1, 'the view is back')
  assert.ok((await runReadOnlySql(db, 'SELECT file_name FROM c_file LIMIT 1')).rows.length,
    'the api role can read through the rebuilt views')
  await loadReferenceTables(db)
  await createApiSchema(db)
  console.log('PASS: re-seeding a reference table survives the api views that depend on it')

  const observationsRun = await startImportRun(db, { name: 'observations.zip', path: 'observations.zip', size: 1 })
  const cidBase = '123456789012'
  const validCid = cidBase + ((11 - [...cidBase].reduce((sum, digit, index) => sum + Number(digit) * (13 - index), 0) % 11) % 10)
  const wrongCid = validCid.slice(0, 12) + ((Number(validCid[12]) + 1) % 10)
  // A third 13-digit CID, so duplicate-cid has something unique to leave alone.
  const loneCid = '9876543210987'
  const personHeader = ['HOSPCODE', 'PID', 'CID', 'NATION', 'PRENAME', 'SEX', 'DISCHARGE', 'DDISCHARGE',
    'BIRTH', 'HID', 'TYPEAREA', 'NAME', 'LNAME']
  await insertStandardRows(db, second, 'person', personHeader, [
    ['07488', 'D', validCid, '099', '003', '1', '1', '20260901', '20000101', 'H1', '1', 'ดี', 'ทดสอบ'],
    ['99999', 'D', validCid, '099', '003', '1', '1', '20200101', '20000101', 'H1', '1', 'ดี', 'ทดสอบ'],
    // Same CID as Y in the checked zip, same HOSPCODE: a duplicate is a duplicate across imports.
    ['07488', 'Z2', loneCid, '099', '003', '1', '1', '20200101', '20000101', 'H1', '1', 'ซี', 'ทดสอบ'],
    // Same CID as M, but another HOSPCODE — another register, so it is not a duplicate.
    ['99999', 'W', wrongCid, '099', '003', '1', '1', '20200101', '20000101', 'H1', '1', 'ดับเบิลยู', 'ทดสอบ'],
  ])
  await insertStandardRows(db, observationsRun, 'person', personHeader, [
    ['07488', 'M', wrongCid, '099', '003', '2', '1', 'invalid', '20000101', 'H1', '1', 'เอ็ม', 'ทดสอบ'],
    ['07488', 'F', 'invalid', '048', '129', '1', '2', '20200101', '19900101', 'H9', '1', 'เอฟ', 'ทดสอบ'],
    ['07488', 'U', '123', '099', '999', '9', '1', '20260230', '20990101', '', '4', 'ยู', 'ทดสอบ'],
    ['07488', 'G', validCid, '099', '004', '2', '9', '', '20000101', 'H1', '1', 'จี', 'ทดสอบ'],
    ['07488', 'X', validCid, '099', '003', '1', '9', '', '20000101', 'H1', '2', 'เอ็กซ์', 'ทดสอบ'],
    ['07488', 'Y', loneCid, '099', '003', '1', '1', '19990101', '20000101', 'H2', '3', 'วาย', 'ทดสอบ'],
  ])
  // Only H1 is a real house, so H9 and H2 are the ones person-without-home should raise.
  await insertStandardRows(db, second, 'home', ['HOSPCODE', 'HID'], [['07488', 'H1']])
  const serviceHeader = ['HOSPCODE', 'PID', 'SEQ', 'DATE_SERV']
  await insertStandardRows(db, observationsRun, 'service', serviceHeader, [
    ['07488', 'D', 'OBS1', '20260831'], ['07488', 'D', 'OBS2', '20260901'], ['07488', 'D', 'OBS3', '20260902'],
    ['07488', 'F', 'OBS4', '20260902'], ['07488', 'U', 'OBS5', '20260902'], ['07488', 'missing', 'OBS6', '20260902'],
    ['07488', 'D', 'OBS7', '20261301'], ['07488', 'D', 'OBS8', '20260230'],
  ])
  await insertStandardRows(db, second, 'service', serviceHeader, [['07488', 'D', 'OTHER', '20260903']])
  await insertStandardRows(db, observationsRun, 'diagnosis_opd',
    ['HOSPCODE', 'PID', 'SEQ', 'DATE_SERV', 'DIAGCODE'], [
      ['07488', 'D', 'OBS1', '20260831', 'J00'],
      ['07488', 'D', 'NOPE', '20260831', 'J01'],
      ['07488', 'D', '', '20260831', 'J02'],
    ])
  await insertStandardRows(db, observationsRun, 'drug_opd',
    ['HOSPCODE', 'PID', 'SEQ', 'DATE_SERV', 'DIDSTD'], [
      ['07488', 'D', 'OBS2', '20260901', '1000'],
      ['07488', 'D', 'NOPE', '20260901', '1001'],
    ])
  await insertStandardRows(db, observationsRun, 'death', ['HOSPCODE', 'PID', 'DDEATH'], [
    ['07488', 'D', '20260901'], // PERSON D is discharged as dead on the same day: consistent
    ['07488', 'M', '20260901'], // discharged as dead, but on a date that is not a date at all
    ['07488', 'G', '20260901'], // still carried as not discharged
    ['07488', 'Z', '20260901'], // no PERSON to compare against
    ['07488', 'K', 'bad'],
  ])
  // Both stamp lengths the 43 files allow, so the rule reads a date-only ADMISSION too.
  await insertStandardRows(db, observationsRun, 'admission',
    ['HOSPCODE', 'PID', 'AN', 'DATETIME_ADMIT', 'DATETIME_DISCH'], [
      ['07488', 'D', 'A1', '20260901080000', '20260903100000'],
      ['07488', 'D', 'A2', '20260903080000', '20260901100000'],
      ['07488', 'D', 'A3', '20260901', '20260830'],
      ['07488', 'D', 'A4', '', '20260901'],
    ])
  const observationSteps: { done: number; total: number; percent: number }[] = []
  const observed = await checkObservations(db, 'observations.zip', (progress) => observationSteps.push(progress))
  assert.equal(observationSteps.length, observed.findings.length + 1, 'one step per rule that ran, then the summary')
  assert.deepEqual([observationSteps[0].percent, observationSteps.at(-1)?.percent], [0, 100])
  assert.deepEqual(observed.findings.map(({ id, checked, skipped, found }) => ({ id, checked, skipped, found })), [
    { id: 'service-after-death', checked: 3, skipped: 5, found: 1 },
    { id: 'thai-cid-mod11', checked: 5, skipped: 1, found: 3 },
    { id: 'prename-sex', checked: 4, skipped: 2, found: 1 },
    { id: 'birth-in-future', checked: 6, skipped: 0, found: 1 },
    { id: 'service-before-birth', checked: 5, skipped: 3, found: 1 },
    { id: 'death-before-birth', checked: 1, skipped: 5, found: 1 },
    { id: 'diagnosis-without-service', checked: 2, skipped: 1, found: 1 },
    { id: 'drug-without-service', checked: 2, skipped: 0, found: 1 },
    { id: 'service-without-person', checked: 8, skipped: 0, found: 1 },
    { id: 'person-without-home', checked: 5, skipped: 1, found: 2 },
    // G and X share a CID inside the zip; Y shares one with Z2 from an earlier zip. M shares its
    // CID only with another HOSPCODE, so it is left alone.
    { id: 'duplicate-cid', checked: 4, skipped: 2, found: 3 },
    { id: 'death-without-discharge', checked: 3, skipped: 2, found: 2 },
    { id: 'discharge-before-admit', checked: 3, skipped: 1, found: 2 },
  ])
  for (const finding of observed.findings) {
    const detail = await observationRows(db, 'observations.zip', finding.id)
    assert.equal(detail.total, finding.found)
    assert.equal(detail.rows.length, finding.found)
  }
  const deathRows = await observationRows(db, 'observations.zip', 'service-after-death')
  assert.equal(deathRows.rows[0][deathRows.columns.indexOf('seq')], 'OBS3')
  await assert.rejects(() => observationRows(db, 'observations.zip', 'unknown'), /ไม่รู้จักเกณฑ์/)
  assert.ok((await checkObservations(db, 'missing.zip')).findings.every((finding) => finding.checked === 0 && finding.found === 0))
  console.log(`PASS: ${observed.findings.length} observation rules — cross-import PERSON/HOME joins, date boundaries,`
    + ' MOD11, prefix mapping, orphan rows, duplicate CID across zips within one HOSPCODE,'
    + ' both datetime stamp lengths, skipped rows and zip scope')

  // The observ_check register: seeded from the rules in code, and the only thing that decides
  // which of them a check actually runs.
  const register = await listObservationRules(db)
  assert.deepEqual(register.map((rule) => rule.id), observed.findings.map((finding) => finding.id),
    'every compiled rule is registered, in the order the check runs them')
  assert.ok(register.every((rule) => rule.active), 'a newly registered rule is switched on')
  assert.equal(register.find((rule) => rule.id === 'prename-sex')?.level, 'warning', 'the register carries the rule level')
  assert.ok(register.some((rule) => rule.level === 'error'), 'both levels reach the register')

  await setObservationRuleActive(db, 'prename-sex', false)
  await db.query(`INSERT INTO observ_check (rule_id, table_name, detail) VALUES ('gone', 'person', 'กฎที่ถูกถอดออก')`)
  await db.query(`DELETE FROM schema_init WHERE component = 'observations'`)
  assert.equal((await syncObservationRules(db)).applied, true, 'the register is rebuilt when its digest is not recorded')
  const reseeded = await listObservationRules(db)
  assert.equal(reseeded.find((rule) => rule.id === 'gone'), undefined, 'a rule with no SQL left in code loses its row')
  assert.equal(reseeded.find((rule) => rule.id === 'prename-sex')?.active, false, 're-seeding never overwrites the switch')
  assert.deepEqual((await checkObservations(db, 'observations.zip')).findings.map((finding) => finding.id),
    reseeded.filter((rule) => rule.active).map((rule) => rule.id), 'the check runs exactly the rules left switched on')
  assert.equal((await syncObservationRules(db)).applied, false, 'an unchanged catalogue re-seeds nothing')
  await setObservationRuleActive(db, 'prename-sex', true)
  assert.equal((await listObservationRules(db)).find((rule) => rule.id === 'prename-sex')?.active, true,
    'a rule can be switched back on')
  console.log('PASS: observ_check register seeds from code, survives re-seeding and decides which rules run')

  // Validate actual imported rows against both reused and generated lists, including drill-down.
  const codeZip = 'structure-codes.zip'
  const codeRun = await startImportRun(db, { name: codeZip, path: codeZip, size: 1 })
  await insertStandardRows(db, codeRun, 'refer_history', ['HOSPCODE', 'REFERID', 'PTYPE', 'EMERGENCY', 'PTYPEDIS', 'CAUSEOUT'], [
    ['07476', 'C1', '1', '1', '01', '7'],
    ['07476', 'C2', '8', '6', '1', '8'],
    ['07476', 'C3', '', '', '', ''],
  ])
  await insertStandardRows(db, codeRun, 'refer_result', ['HOSPCODE', 'REFERID_SOURCE', 'HOSP_SOURCE', 'REFER_RESULT'], [
    ['07476', 'C1', '07488', '1'], ['07476', 'C2', '07488', '8'],
  ])
  await insertStandardRows(db, codeRun, 'village', ['HOSPCODE', 'VID', 'WASTEWATER', 'GARBAGE'], [
    ['07476', 'C1', '9', '0'], ['07476', 'C2', '2', '7'],
  ])
  await insertStandardRows(db, codeRun, 'women', ['HOSPCODE', 'PID', 'FPTYPE'], [
    ['07476', 'C1', '8'], ['07476', 'C2', '0'],
  ])
  await insertStandardRows(db, codeRun, 'provider', ['HOSPCODE', 'PROVIDER', 'SEX'], [
    ['07476', 'C1', '1'], ['07476', 'C2', '9'],
  ])
  await insertStandardRows(db, codeRun, 'service', ['HOSPCODE', 'SEQ', 'DATE_SERV', 'TYPEIN'], [
    ['07476', 'C1', '20260909', '5'], ['07476', 'C2', '20260909', '8'],
  ])
  // Another zip's bad code must not inflate counts or enter drill-down.
  await insertStandardRows(db, second, 'women', ['HOSPCODE', 'PID', 'FPTYPE'], [['07476', 'OTHER', '0']])
  // Both checks report where they are, so a long run can show progress in the status bar.
  const structureSteps: { done: number; total: number; step: string; percent: number }[] = []
  const codeCheck = await checkImportStructure(db, codeZip, (progress) => structureSteps.push(progress))
  assert.equal(structureSteps.length, 53, 'one step per 43-file table, then the summary')
  assert.deepEqual([structureSteps[0].percent, structureSteps.at(-1)?.percent], [0, 100])
  assert.ok(structureSteps.every((entry, index) => index === 0 || entry.percent >= structureSteps[index - 1].percent),
    'progress never goes backwards')
  assert.equal(structureSteps.at(-1)?.step, 'สรุปผล')
  const codeFindings = codeCheck.findings.filter((finding) => finding.rule === 'code')
  assert.equal(codeFindings.length, 10, 'all eight new lists plus two reused lists report invalid codes')
  assert.ok(codeFindings.every((finding) => finding.found === 1 && finding.level === 'error'))
  for (const finding of codeFindings) {
    const detail = await structureFailingRows(db, codeZip, finding.tableName, finding.columnName, 'code')
    assert.equal(detail.total, finding.found, 'drill-down and summary share the same code predicate')
    assert.equal(detail.rows.length, 1)
  }
  const leadingZero = await structureFailingRows(db, codeZip, 'refer_history', 'ptypedis', 'code')
  assert.equal(leadingZero.rows[0][leadingZero.columns.indexOf('ptypedis')], '1', '01 passes but 1 does not match a two-character code')
  const checkedAgain = await checkImportStructure(db, codeZip)
  assert.equal(checkedAgain.findings.filter((finding) => finding.rule === 'code').length, 10, 'recheck replaces stored results')

  const orderedZip = 'structure-order.zip'
  const orderedRun = await startImportRun(db, { name: orderedZip, path: orderedZip, size: 1 })
  await insertStandardRows(db, orderedRun, 'refer_history', ['HOSPCODE', 'REFERID', 'PTYPE', 'PTYPEDIS'], [
    ['07476', 'ORDER1', '', ''], ['07476', 'ORDER2', '88', ''],
    ['07476', 'ORDER3', '8', ''], ['07476', 'ORDER4', '1', '01'],
  ])
  // SQL NULL is distinct from the empty strings produced by ordinary imports.
  await db.exec('ALTER TABLE refer_history ALTER COLUMN ptype DROP NOT NULL')
  await insertStandardRows(db, orderedRun, 'refer_history', ['HOSPCODE', 'REFERID', 'PTYPE'], [['07476', 'ORDER5', '1']])
  await db.query("UPDATE refer_history SET ptype = NULL WHERE referid = 'ORDER5'")
  await insertStandardRows(db, orderedRun, 'service', ['HOSPCODE', 'SEQ', 'DATE_SERV', 'PRICE'], [
    ['07476', 'ORDER1', 'abcdefgh', 'abc'],
  ])
  const ordered = await checkImportStructure(db, orderedZip)
  const orderedField = ordered.findings.filter((finding) => finding.tableName === 'refer_history' && finding.columnName === 'ptype')
  assert.deepEqual(orderedField.map((finding) => [finding.rule, finding.found]),
    [['required', 2], ['width', 1], ['code', 1]], 'required, width, lookup are ordered and mutually exclusive per value')
  assert.ok(!ordered.findings.some((finding) => finding.rule === 'number' || finding.rule === 'date'),
    'structural checks contain only the requested three stages')
  assert.ok(!ordered.findings.some((finding) => finding.columnName === 'ptypedis'), 'optional blanks skip width and lookup')
  for (const [rule, expected] of [['required', ['ORDER1', 'ORDER5']], ['width', ['ORDER2']], ['code', ['ORDER3']]] as const) {
    const sample = await structureFailingRows(db, orderedZip, 'refer_history', 'ptype', rule)
    assert.equal(sample.total, expected.length)
    assert.deepEqual(sample.rows.map((row) => row[sample.columns.indexOf('referid')]).sort(), [...expected])
  }
  // Without a rule the drill-down covers the whole field, and every record names the rule it broke.
  const everyRule = await structureFailingRows(db, orderedZip, 'refer_history', 'ptype')
  assert.equal(everyRule.columns.at(-1), 'เกณฑ์', 'the last column names the rule')
  assert.equal(everyRule.total, 4, 'one record per failing row, never counted twice')
  const named = new Map(everyRule.rows.map((row) => [row[everyRule.columns.indexOf('referid')], row.at(-1) ?? '']))
  assert.equal(named.get('ORDER1'), 'ห้ามเป็นค่าว่าง')
  assert.equal(named.get('ORDER5'), 'ห้ามเป็นค่าว่าง')
  assert.match(named.get('ORDER2') ?? '', /^ความยาวเกิน/)
  assert.equal(named.get('ORDER3'), 'ไม่ตรงตามรหัสมาตรฐาน')

  await db.query("UPDATE refer_history SET ptype = '' WHERE referid = 'ORDER5'")
  await db.exec('ALTER TABLE refer_history ALTER COLUMN ptype SET NOT NULL')
  // The lookup step depends on an actually present c_* table, not just a bundled binding.
  await db.exec('ALTER TABLE c_refer_history_ptype RENAME TO temporarily_missing_ptype')
  try {
    const absent = await checkImportStructure(db, orderedZip)
    assert.deepEqual(absent.findings.filter((finding) => finding.tableName === 'refer_history' && finding.columnName === 'ptype')
      .map((finding) => finding.rule), ['required', 'width'], 'a missing lookup skips only stage three')
    await assert.rejects(structureFailingRows(db, orderedZip, 'refer_history', 'ptype', 'code'), /ไม่รู้จักเกณฑ์/)
  } finally {
    await db.exec('ALTER TABLE temporarily_missing_ptype RENAME TO c_refer_history_ptype')
  }
  const labor = fileStructure.tables.find((table) => table.name === 'labor')!
  await insertStandardRows(db, orderedRun, 'labor', [...labor.primaryKey.map((key) => key.toUpperCase()), 'BPLACE'],
    [[...labor.primaryKey.map((_key, index) => index === 0 ? '07476' : 'ORDER1'), '8']])
  const existingLookup = await checkImportStructure(db, orderedZip)
  assert.ok(existingLookup.findings.some((finding) => finding.tableName === 'labor' && finding.columnName === 'bplace'
    && finding.rule === 'code'), 'existing field-specific tables work even without an extracted description binding')
  console.log('PASS: required -> width -> existing lookup precedence, NULL/empty handling, skipped lookups and matching drill-down')
  assert.deepEqual((await runReadOnlySql(db, "SELECT code FROM c_refer_history_ptypedis WHERE code = '01'")).rows,
    [{ code: '01' }], 'generated code tables are available through the masked read-only API')

  const importedBefore = await db.query('SELECT * FROM refer_history ORDER BY referid')
  const oldLookup = await db.query('SELECT * FROM c_service_typein ORDER BY code')
  const changedCodes = structuredClone(structureCodes)
  changedCodes.tables[0].rows[0].description += ' (test revision)'
  assert.equal((await loadStructureCodeTables(db, changedCodes)).applied, true, 'a changed catalog seeds once')
  assert.equal((await loadStructureCodeTables(db, changedCodes)).applied, false)
  assert.deepEqual((await db.query('SELECT * FROM refer_history ORDER BY referid')).rows, importedBefore.rows,
    'code catalog upgrades preserve imported records')
  assert.deepEqual((await db.query('SELECT * FROM c_service_typein ORDER BY code')).rows, oldLookup.rows,
    'code catalog upgrades do not overwrite upstream tables or their extra codes')
  const brokenCodes = structuredClone(changedCodes)
  brokenCodes.tables[0].rows.push(brokenCodes.tables[0].rows[0])
  await assert.rejects(loadStructureCodeTables(db, brokenCodes), /duplicate key/)
  assert.equal((await loadStructureCodeTables(db, changedCodes)).applied, false, 'failed seed rolls back its version marker')
  assert.equal((await db.query('SELECT * FROM c_refer_history_ptype')).rows.length, 3, 'failed seed rolls back deleted rows')
  await loadStructureCodeTables(db)
  // A published code longer than the dictionary's own width is the dictionary being stale.
  const wideZip = 'structure-wide.zip'
  const wideRun = await startImportRun(db, { name: wideZip, path: wideZip, size: 1 })
  await insertStandardRows(db, wideRun, 'epi', ['HOSPCODE', 'PID', 'SEQ', 'VACCINEPLACE', 'VACCINETYPE', 'DATE_SERV'], [
    ['07476', 'W1', 'W1', '07476', 'HPVG91', '20260909'],
    ['07476', 'W2', 'W2', '07476', 'NOTACODE', '20260909'],
    ['07476', 'W3', 'W3', '07476', '010', '20260909'],
  ])
  const wide = await checkImportStructure(db, wideZip)
  assert.deepEqual(wide.findings.filter((finding) => finding.columnName === 'vaccinetype')
    .map((finding) => [finding.rule, finding.found]), [['code', 1]],
    'no width rule where the list is wider than the dictionary; the list alone judges the value')

  // A service-unit code is the full width in digits. Ward, clinic and DRG fields are the same
  // width and are not unit codes, so they keep the plain width rule.
  const unitZip = 'structure-unit.zip'
  const unitRun = await startImportRun(db, { name: unitZip, path: unitZip, size: 1 })
  await insertStandardRows(db, unitRun, 'service', ['HOSPCODE', 'SEQ', 'DATE_SERV', 'MAIN'], [
    ['07476', 'U1', '20260909', '07476'],
    ['7476', 'U2', '20260909', '074A6'],
    ['0747A', 'U3', '20260909', ''],
    // The nine-character unit code some sites already send belongs to the width rule, once.
    ['GA0007476', 'U4', '20260909', '07476'],
  ])
  await insertStandardRows(db, unitRun, 'diagnosis_opd', ['HOSPCODE', 'PID', 'SEQ', 'DATE_SERV', 'DIAGCODE', 'CLINIC'], [
    ['07476', 'U1', 'U1', '20260909', 'A00', '001'],
  ])
  const unit = await checkImportStructure(db, unitZip)
  assert.deepEqual(unit.findings.filter((finding) => finding.rule === 'unitcode')
    .map((finding) => [finding.tableName, finding.columnName, finding.found, finding.level]).sort(),
    [['service', 'hospcode', 2, 'error'], ['service', 'main', 1, 'error']],
    'short and non-numeric unit codes are reported; an empty one belongs to the required rule')
  assert.deepEqual(unit.findings.filter((finding) => finding.columnName === 'hospcode')
    .map((finding) => [finding.rule, finding.found]), [['width', 1], ['unitcode', 2]],
    'an over-long unit code is counted by width alone, never twice')
  assert.ok(!unit.findings.some((finding) => finding.columnName === 'clinic'),
    'a five-digit clinic code is not a unit code')
  const shortUnit = await structureFailingRows(db, unitZip, 'service', 'hospcode', 'unitcode')
  assert.deepEqual(shortUnit.rows.map((row) => row[shortUnit.columns.indexOf('seq')]).sort(), ['U2', 'U3'],
    'drill-down and summary share the same unit-code predicate')

  // Structure rules judge one row at a time inside one zip: rows from another zip, or from another
  // HOSPCODE, are outside the check and can never change a count.
  const otherRun = await startImportRun(db, { name: 'structure-other.zip', path: 'structure-other.zip', size: 1 })
  await insertStandardRows(db, otherRun, 'service', ['HOSPCODE', 'SEQ', 'DATE_SERV', 'MAIN'], [
    ['0747A', 'X1', '20260909', '074A6'],
    ['99999', 'X2', '20260909', ''],
  ])
  const isolated = await checkImportStructure(db, unitZip)
  assert.deepEqual(isolated.findings, unit.findings, 'another zip and another HOSPCODE stay out of the count')
  assert.deepEqual([isolated.rows, isolated.rules], [unit.rows, unit.rules], 'the checked row count is the zip alone')

  // A finding names the list its field is judged by, so the page can show what is allowed.
  const fpFinding = codeCheck.findings.find((finding) => finding.tableName === 'women' && finding.columnName === 'fptype')
  assert.equal(fpFinding?.reference, 'c_fptype', 'a finding carries the shared list it was judged against')
  const stored = await structureResult(db, codeZip)
  assert.equal(stored?.findings.find((finding) => finding.columnName === 'fptype')?.reference, 'c_fptype',
    'the stored result derives the same list on read')
  assert.ok(!codeCheck.findings.some((finding) => finding.columnName === 'pid' && finding.reference),
    'a field with no list carries no reference')
  const list = await referenceCodeList(db, 'c_fptype')
  assert.deepEqual(list.columns, ['code', 'description', 'is_active'])
  assert.equal(list.rows.length, 9, 'the whole list comes back, sorted by code')
  assert.deepEqual(list.rows[0], ['1', 'ยาเม็ดคุมกำเนิด', '1'])
  await assert.rejects(referenceCodeList(db, 'person'), /ไม่รู้จักตาราง/, 'only a c_* table is readable')
  await assert.rejects(referenceCodeList(db, 'c_files_schema'), /ไม่รู้จักตาราง/, 'and only one that is a code list')
  await assert.rejects(referenceCodeList(db, 'c_nope'), /ไม่รู้จักตาราง/)

  console.log('PASS: generated code lists, preserved upstream data, exact code validation, zip scope, drill-down and transactional upgrades')
} finally {
  if (db && !db.closed) await db.close()
  await rm(directory, { recursive: true, force: true })
}
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
