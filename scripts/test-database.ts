import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, databaseStatus, loadReferenceTables, createFileTables, createAppTables, countByFiscalYears, listImportLog, startImportRun, insertStandardRows, loadGeographyTables } from '../src/main/database.ts'
import type { FileStructure } from '../src/main/database.ts'
import { checkObservations, observationRows, listObservationRules, setObservationRuleActive, syncObservationRules } from '../src/main/database.ts'
import { describeTable, listTables, runReadOnlySql, MASK } from '../src/main/database.ts'
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
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema='public' AND table_name LIKE 'c\\_%'
       AND table_name NOT IN ('c_province', 'c_district', 'c_subdistrict')`)
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
  assert.deepEqual(before.rows.map((row) => row.component), ['api', 'app', 'files43', 'geography', 'observations', 'reference'],
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
    'columns keep their SUB-HDC order')
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
  const observed = await checkObservations(db, 'observations.zip')
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
    { id: 'duplicate-cid', checked: 4, skipped: 2, found: 2 },
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
    + ' MOD11, prefix mapping, orphan rows, duplicate CID, both datetime stamp lengths, skipped rows and zip scope')

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
} finally {
  if (db && !db.closed) await db.close()
  await rm(directory, { recursive: true, force: true })
}
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
