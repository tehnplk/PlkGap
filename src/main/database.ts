import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import type { ObservationLevel, ObservationRule, ObservationRuleId, ObservationFinding, ObservationResult } from '../shared/api'
import type { BoundaryCollection, BoundaryLevel, DataCountResult, DatabaseStatus, FailingRows, Hospital, Household, ImportLogEntry, StructureCheckResult, StructureFinding } from '../shared/api'
import referenceData from './reference/c-tables.json'
import fileStructure from './reference/f43-tables.json'
import geographyData from './reference/geography.json'
import boundaryData from './reference/boundaries.json'

export interface ReferenceTable {
  name: string
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
}
export interface ReferenceData {
  source: string
  pulledAt: string
  excluded: string[]
  tables: ReferenceTable[]
}

export interface FileColumn {
  name: string
  type: string
  length: number | null
  nullable: boolean
  default: string | null
}
export interface FileTable {
  name: string
  columns: FileColumn[]
  primaryKey: string[]
  indexes: { name: string; unique: boolean; columns: string[] }[]
}
export interface FileStructure {
  source: string
  pulledAt: string
  tables: FileTable[]
}

export async function openDatabase(path: string) {
  const db = new PGlite(path, { extensions: { postgis } })
  try {
    await db.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
    const setup = await initializeSchema(db)
    if (setup.firstRun) {
      console.log(`PlkGap: initialized ${setup.reference.table_count} c_* reference tables `
        + `(${setup.reference.row_count} rows) and ${setup.files.table_count} 43-file tables`)
    }
    return db
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}

export async function databaseStatus(db: PGlite, path: string): Promise<DatabaseStatus> {
  const { rows } = await db.query<Omit<DatabaseStatus, 'path'>>(`
    SELECT version() AS version, postgis_full_version() AS postgis,
      ST_AsText(ST_SetSRID(ST_MakePoint(100.2659, 16.8211), 4326)) AS geometry,
      (SELECT table_count FROM schema_init WHERE component = 'reference')::int AS "referenceTables",
      (SELECT row_count FROM schema_init WHERE component = 'reference')::int AS "referenceRows",
      (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN (SELECT file_name FROM c_file))::int AS "fileTables"
  `)
  return { ...rows[0], path }
}

/** The 52 standard file names, straight from the seeded `c_file` reference table. */
export async function listStandardFiles(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ file_name: string }>('SELECT file_name FROM c_file ORDER BY file_name')
  return rows.map((row) => row.file_name)
}

/** Outlines of one administrative level, as GeoJSON that Leaflet can draw directly. */
export async function listBoundaries(db: PGlite, level: BoundaryLevel): Promise<BoundaryCollection> {
  const table = { province: 'c_province', district: 'c_district', subdistrict: 'c_subdistrict' }[level]
  if (!table) throw new Error(`ไม่รู้จักระดับ ${level}`)
  const code = level === 'province' ? 'changwat'
    : level === 'district' ? "changwat || ampur"
    : "changwat || ampur || tambon"
  const { rows } = await db.query<{ collection: BoundaryCollection }>(`
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(json_build_object(
        'type', 'Feature',
        'properties', json_build_object('name', name_th, 'code', ${code}),
        'geometry', ST_AsGeoJSON(geom)::json)), '[]'::json)
    ) AS collection
    FROM ${quote(table)} WHERE geom IS NOT NULL`)
  return rows[0].collection
}

/**
 * Households that carry a usable coordinate. HOME stores latitude/longitude as text, so anything
 * that is not a number inside Thailand's bounding box is dropped rather than plotted in the sea.
 */
export async function listHouseholds(db: PGlite, limit = 50000): Promise<Household[]> {
  // HOME stores area codes, not names, so the geography lookup supplies them.
  const { rows } = await db.query<Household>(`
    SELECT h.hospcode, h.hid, h.house, h.village,
      COALESCE(t.name_th, '') AS "tambonName", COALESCE(a.name_th, '') AS "ampurName",
      h.latitude::float8 AS latitude, h.longitude::float8 AS longitude
    FROM home h
    LEFT JOIN c_subdistrict t ON t.changwat = h.changwat AND t.ampur = h.ampur AND t.tambon = h.tambon
    LEFT JOIN c_district a ON a.changwat = h.changwat AND a.ampur = h.ampur
    WHERE h.latitude ~ '^[0-9]+([.][0-9]+)?$' AND h.longitude ~ '^[0-9]+([.][0-9]+)?$'
      AND h.latitude::float8 BETWEEN 5 AND 21 AND h.longitude::float8 BETWEEN 96 AND 106
    LIMIT $1`, [limit])
  return rows
}

/** Looks a service unit up in the seeded `c_hospital` reference table. */
export async function findHospital(db: PGlite, hospcode: string): Promise<Hospital | null> {
  const { rows } = await db.query<Hospital>(`
    SELECT h.hospcode, h.hospname, h.hospname_short AS "hospnameShort", h.hostype,
      COALESCE(t.hostype, '') AS "hostypeName", h.mu,
      h.tmb_name AS tambon, h.amp_name AS ampur, h.chw_name AS changwat
    FROM c_hospital h LEFT JOIN c_hostype t ON t.code = h.hostype
    WHERE h.hospcode = $1
  `, [hospcode.trim()])
  return rows[0] ?? null
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
const versionOf = (data: { source: string; pulledAt: string }) => `${data.source}@${data.pulledAt}`

/**
 * Records what has already been set up, so the schema is built once — on the first run of a
 * fresh install — and every later start only reads one row per component.
 */
async function ensureInitTable(db: PGlite) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_init (
    component text PRIMARY KEY,
    version text NOT NULL,
    table_count integer NOT NULL,
    row_count integer NOT NULL,
    initialized_at timestamptz NOT NULL DEFAULT now()
  );
  DROP TABLE IF EXISTS reference_load;`)
}

async function initializedVersion(db: PGlite, component: string) {
  const { rows } = await db.query<{ version: string; table_count: number; row_count: number }>(
    'SELECT version, table_count, row_count FROM schema_init WHERE component = $1', [component])
  return rows[0]
}

async function recordInit(db: PGlite, component: string, version: string, tables: number, rows: number) {
  await db.query(`INSERT INTO schema_init (component, version, table_count, row_count)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (component) DO UPDATE
    SET version = EXCLUDED.version, table_count = EXCLUDED.table_count,
        row_count = EXCLUDED.row_count, initialized_at = now()`, [component, version, tables, rows])
}

/**
 * Builds everything the app needs in its own database. Runs on the first start after install
 * (and again only when a pulled structure file changes); on every later start it is a no-op.
 */
export async function initializeSchema(db: PGlite, data: {
  reference?: ReferenceData
  structure?: FileStructure
} = {}) {
  await ensureInitTable(db)
  const reference = await loadReferenceTables(db, data.reference)
  const geography = await loadGeographyTables(db)
  const app = await createAppTables(db)
  const observations = await syncObservationRules(db)
  const files = await createFileTables(db, data.structure)
  return { reference, geography, files, app, observations,
    firstRun: reference.applied || geography.applied || files.applied || app.applied }
}

export interface BoundaryData {
  source: string
  pulledAt: string
  tolerance: string
  provinces: { changwat: string; nameTh: string; geom: unknown }[]
  districts: { changwat: string; ampur: string; nameTh: string; geom: unknown }[]
  subdistricts: { changwat: string; ampur: string; tambon: string; nameTh: string; geom: unknown }[]
}

export interface GeographyData {
  source: string
  pulledAt: string
  provinces: { changwat: string; nameTh: string; nameEn: string }[]
  districts: { changwat: string; ampur: string; code: string; nameTh: string; nameEn: string; postalCode: string }[]
  subdistricts: { changwat: string; ampur: string; tambon: string; code: string; nameTh: string; nameEn: string; postalCode: string }[]
}

/**
 * The province/district/subdistrict lookup, keyed the way the 43 files code an address:
 * CHANGWAT + AMPUR + TAMBON. Data comes from `reference/geography.json`
 * (see `scripts/pull-geography.mjs`); like the c_* tables it is upstream-only, so a newer file
 * replaces the whole set.
 */
export async function loadGeographyTables(db: PGlite, data: GeographyData = geographyData as GeographyData,
  boundaries: BoundaryData = boundaryData as BoundaryData) {
  await ensureInitTable(db)
  const version = `${versionOf(data)}+${boundaries.pulledAt}`
  const done = await initializedVersion(db, 'geography')
  if (done?.version === version) return { ...done, applied: false }

  await db.exec(`DROP TABLE IF EXISTS c_province; DROP TABLE IF EXISTS c_district; DROP TABLE IF EXISTS c_subdistrict;
    CREATE TABLE c_province (changwat varchar(2) PRIMARY KEY, name_th text NOT NULL, name_en text NOT NULL);
    CREATE TABLE c_district (changwat varchar(2) NOT NULL, ampur varchar(2) NOT NULL, code varchar(4) NOT NULL,
      name_th text NOT NULL, name_en text NOT NULL, postal_code varchar(5) NOT NULL DEFAULT '',
      PRIMARY KEY (changwat, ampur));
    CREATE TABLE c_subdistrict (changwat varchar(2) NOT NULL, ampur varchar(2) NOT NULL, tambon varchar(2) NOT NULL,
      code varchar(6) NOT NULL, name_th text NOT NULL, name_en text NOT NULL,
      postal_code varchar(5) NOT NULL DEFAULT '', PRIMARY KEY (changwat, ampur, tambon));
    ALTER TABLE c_province ADD COLUMN geom geometry(MultiPolygon, 4326);
    ALTER TABLE c_district ADD COLUMN geom geometry(MultiPolygon, 4326);
    ALTER TABLE c_subdistrict ADD COLUMN geom geometry(MultiPolygon, 4326);`)

  const insert = async (sql: string, rows: unknown[][], columns: number) => {
    const perBatch = Math.max(1, Math.floor(5000 / columns))
    for (let index = 0; index < rows.length; index += perBatch) {
      const batch = rows.slice(index, index + perBatch)
      const values: unknown[] = []
      const placeholders = batch.map((row) => {
        const slots = row.map((value) => { values.push(value); return `$${values.length}` })
        return `(${slots.join(', ')})`
      })
      await db.query(`${sql} ${placeholders.join(', ')}`, values)
    }
  }
  await insert('INSERT INTO c_province (changwat, name_th, name_en) VALUES',
    data.provinces.map((row) => [row.changwat, row.nameTh, row.nameEn]), 3)
  await insert('INSERT INTO c_district (changwat, ampur, code, name_th, name_en, postal_code) VALUES',
    data.districts.map((row) => [row.changwat, row.ampur, row.code, row.nameTh, row.nameEn, row.postalCode]), 6)
  await insert('INSERT INTO c_subdistrict (changwat, ampur, tambon, code, name_th, name_en, postal_code) VALUES',
    data.subdistricts.map((row) => [row.changwat, row.ampur, row.tambon, row.code, row.nameTh, row.nameEn, row.postalCode]), 7)

  // Boundaries come from the SUB-HDC PostGIS server and cover one province, so they are matched
  // onto the country-wide name rows rather than loaded as tables of their own.
  const shape = async (sql: string, rows: { geom: unknown }[], keys: (row: never) => unknown[]) => {
    for (const row of rows) {
      await db.query(sql, [...keys(row as never), JSON.stringify(row.geom)])
    }
    return rows.length
  }
  const shaped = await shape(
    'UPDATE c_province SET geom = ST_Multi(ST_GeomFromGeoJSON($2)) WHERE changwat = $1',
    boundaries.provinces, (row: { changwat: string }) => [row.changwat])
    + await shape('UPDATE c_district SET geom = ST_Multi(ST_GeomFromGeoJSON($3)) WHERE changwat = $1 AND ampur = $2',
      boundaries.districts, (row: { changwat: string; ampur: string }) => [row.changwat, row.ampur])
    + await shape(`UPDATE c_subdistrict SET geom = ST_Multi(ST_GeomFromGeoJSON($4))
        WHERE changwat = $1 AND ampur = $2 AND tambon = $3`,
      boundaries.subdistricts,
      (row: { changwat: string; ampur: string; tambon: string }) => [row.changwat, row.ampur, row.tambon])
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_c_province_geom ON c_province USING GIST (geom);
    CREATE INDEX IF NOT EXISTS idx_c_district_geom ON c_district USING GIST (geom);
    CREATE INDEX IF NOT EXISTS idx_c_subdistrict_geom ON c_subdistrict USING GIST (geom);`)

  const total = data.provinces.length + data.districts.length + data.subdistricts.length
  await recordInit(db, 'geography', version, 3, total)
  return { version, table_count: 3, row_count: total, shaped, applied: true }
}

/** Bump when a table below changes shape, so the new DDL runs once on the next start. */
const APP_SCHEMA_VERSION = 'app@5'

/**
 * Tables PlkGap owns itself, as opposed to the ones mirrored from SUB-HDC.
 * `import52files_log` accumulates one row per import run, so this is additive only — never dropped.
 */
export async function createAppTables(db: PGlite) {
  await ensureInitTable(db)
  const done = await initializedVersion(db, 'app')
  if (done?.version === APP_SCHEMA_VERSION) return { ...done, applied: false }

  await db.exec(`CREATE TABLE IF NOT EXISTS import52files_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_size bigint NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running',
    progress_percent integer NOT NULL DEFAULT 0,
    row_count integer NOT NULL DEFAULT 0,
    message text NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_import52files_log_started ON import52files_log (started_at DESC);

  -- Purely derived from the imported rows, so unlike the import history it can be rebuilt.
  DROP TABLE IF EXISTS structure_check_log;
  CREATE TABLE structure_check_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zip_name text NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now(),
    table_name text NOT NULL,
    column_name text NOT NULL,
    rule text NOT NULL,
    detail text NOT NULL DEFAULT '',
    found integer NOT NULL DEFAULT 0,
    level text NOT NULL DEFAULT 'error',
    table_rows integer NOT NULL DEFAULT 0,
    row_count integer NOT NULL DEFAULT 0,
    rule_count integer NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_structure_check_log_zip ON structure_check_log (zip_name, table_name);

  -- The register of observation rules. Rows are seeded from observationRules() by
  -- syncObservationRules(); the SQL of a rule stays in code, only its wording, order and the
  -- on/off switch live here, so is_active is the one column the seeding never overwrites.
  CREATE TABLE IF NOT EXISTS observ_check (
    rule_id text PRIMARY KEY,
    table_name text NOT NULL,
    detail text NOT NULL,
    level text NOT NULL DEFAULT 'error',
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true
  );`)
  await recordInit(db, 'app', APP_SCHEMA_VERSION, 3, 0)
  return { version: APP_SCHEMA_VERSION, table_count: 3, row_count: 0, applied: true }
}

/** One row per import run, newest first. The history is append-only: nothing here deletes it. */
export async function listImportLog(db: PGlite, limit = 200): Promise<ImportLogEntry[]> {
  const { rows } = await db.query<ImportLogEntry>(`
    SELECT id::int AS id, file_name AS "fileName", file_path AS "filePath", file_size::int AS "fileSize",
      started_at AS "startedAt", finished_at AS "finishedAt", status,
      progress_percent AS "progressPercent", row_count AS "rowCount", message
    FROM import52files_log ORDER BY started_at DESC, id DESC LIMIT $1
  `, [limit])
  return rows
}

interface DictionaryColumn { table: string; column: string; type: string; width: number; required: boolean; fieldDescription: string }
interface RuleTest { column: string; rule: string; detail: string; level: string; test: string }

/** Every rule the dictionary puts on one column, as SQL that is true when a row breaks it. */
function ruleTests(entry: DictionaryColumn): RuleTest[] {
  const target = quote(entry.column)
  const tests: RuleTest[] = []
  if (entry.required) {
    tests.push({ column: entry.column, rule: 'required', detail: 'ห้ามเป็นค่าว่าง', level: 'error', test: `${target} = ''` })
  }
  if (entry.width > 0) {
    tests.push({ column: entry.column, rule: 'width', detail: `ความยาวเกิน ${entry.width} อักขระ`, level: 'error', test: `char_length(${target}) > ${entry.width}` })
  }
  if (entry.type === 'N') {
    tests.push({ column: entry.column, rule: 'number', detail: 'ต้องเป็นตัวเลข', level: 'warning', test: `${target} <> '' AND ${target} !~ '^-?[0-9]+([.][0-9]+)?$'` })
  }
  if ((entry.type === 'D' || entry.type === 'DT') && entry.width > 0) {
    tests.push({ column: entry.column, rule: 'date', detail: `รูปแบบต้องเป็นตัวเลข ${entry.width} หลัก`, level: 'error', test: `${target} <> '' AND ${target} !~ '^[0-9]{${entry.width}}$'` })
  }
  return tests
}

/** The rows a zip brought in, for scoping every structure query to that file. */
const importedFromZip = 'log_import_id IN (SELECT id FROM import52files_log WHERE file_name = $1)'


/**
 * Checks the rows imported from one zip against the real 43-file data dictionary
 * (`c_files_schema`): required fields, declared width, numeric fields and date formats.
 * Scope is the zip file name, so every run that imported that file counts — re-importing the
 * same zip adds no rows, and the check still sees the rows the first run brought in.
 * The result replaces the zip's previous one in `structure_check_log`.
 */
export async function checkImportStructure(db: PGlite, zipName: string,
  structure: FileStructure = fileStructure as FileStructure): Promise<StructureCheckResult> {
  const dictionary = await db.query<DictionaryColumn>(`
    SELECT LOWER(table_name) AS table, LOWER(name) AS column, type,
      COALESCE(NULLIF(description, ''), caption, '') AS "fieldDescription",
      -- width is usually plain digits, but the dictionary has the odd '13.00'
      CASE WHEN width ~ '^[0-9]+' THEN SPLIT_PART(width, '.', 1)::int ELSE 0 END AS width,
      not_null = 'Y' AS required
    FROM c_files_schema WHERE is_active = 1`)
  const byTable = new Map<string, DictionaryColumn[]>()
  for (const entry of dictionary.rows) {
    if (!byTable.has(entry.table)) byTable.set(entry.table, [])
    byTable.get(entry.table)!.push(entry)
  }

  const findings: StructureFinding[] = []
  let rows = 0
  let rules = 0
  for (const table of structure.tables) {
    const columns = (byTable.get(table.name) ?? [])
      .filter((entry) => table.columns.some((column) => column.name === entry.column))
    if (!columns.length) continue

    const checks = columns.flatMap(ruleTests)
    if (!checks.length) continue

    const counters = checks.map((check, index) => `SUM(CASE WHEN ${check.test} THEN 1 ELSE 0 END)::int AS c${index}`)
    const { rows: result } = await db.query<Record<string, number>>(
      `SELECT COUNT(*)::int AS total, ${counters.join(', ')} FROM ${quote(table.name)} WHERE ${importedFromZip}`, [zipName])
    const summary = result[0]
    if (!summary || !summary.total) continue
    rows += summary.total
    rules += checks.length
    checks.forEach((check, index) => {
      const found = summary[`c${index}`] ?? 0
      if (found > 0) findings.push({ tableName: table.name, columnName: check.column,
        fieldDescription: columns.find((entry) => entry.column === check.column)?.fieldDescription ?? '',
        rule: check.rule, detail: check.detail, tableRows: summary.total, found, level: check.level })
    })
  }

  await db.query('DELETE FROM structure_check_log WHERE zip_name = $1', [zipName])
  const stored = findings.length ? findings : [
    { tableName: '', columnName: '', rule: 'passed', detail: 'ผ่านทุกเกณฑ์', tableRows: 0, found: 0, level: 'passed' },
  ]
  const values: unknown[] = []
  const placeholders = stored.map((finding) => {
    values.push(zipName, finding.tableName, finding.columnName, finding.rule, finding.detail,
      finding.tableRows, finding.found, finding.level, rows, rules)
    const start = values.length - 10
    return `(${Array.from({ length: 10 }, (_unused, offset) => `$${start + offset + 1}`).join(', ')})`
  })
  await db.query(`INSERT INTO structure_check_log
    (zip_name, table_name, column_name, rule, detail, table_rows, found, level, row_count, rule_count)
    VALUES ${placeholders.join(', ')}`, values)

  return await structureResult(db, zipName) ?? { zipName, rows, rules, checkedAt: new Date().toISOString(), findings }
}

/**
 * The actual rows behind one finding: the file's key columns plus the offending value, so the
 * finding can be traced back to real records. Capped to a readable sample.
 */
export async function structureFailingRows(db: PGlite, zipName: string, tableName: string,
  columnName: string, rule: string, limit = 100,
  structure: FileStructure = fileStructure as FileStructure): Promise<FailingRows> {
  const definition = structure.tables.find((entry) => entry.name === tableName)
  if (!definition) throw new Error(`ไม่รู้จักแฟ้ม ${tableName}`)
  const { rows: dictionary } = await db.query<DictionaryColumn>(`
    SELECT LOWER(table_name) AS table, LOWER(name) AS column, type,
      CASE WHEN width ~ '^[0-9]+' THEN SPLIT_PART(width, '.', 1)::int ELSE 0 END AS width,
      not_null = 'Y' AS required
    FROM c_files_schema
    WHERE is_active = 1 AND LOWER(table_name) = $1 AND LOWER(name) = $2`, [tableName, columnName])
  const test = dictionary.flatMap(ruleTests).find((entry) => entry.rule === rule)
  if (!test) throw new Error(`ไม่รู้จักเกณฑ์ ${rule} ของ ${tableName}.${columnName}`)

  // Standing columns first, so a row can always be traced back: who, which visit, and when.
  // `seq` identifies an outpatient visit and `an` an admission; `service` for one has a primary key
  // of (hospcode, seq, date_serv) — no pid — so the keys alone are not enough to recognise a record.
  const standing = ['hospcode', 'pid', 'seq', 'an', countingColumn(definition)]
    .filter((name) => definition.columns.some((column) => column.name === name))
  const shown = [...new Set([...standing, ...definition.primaryKey, columnName])]
  const { rows: sample } = await db.query<Record<string, string>>(
    `SELECT ${shown.map(quote).join(', ')} FROM ${quote(tableName)}
     WHERE ${importedFromZip} AND ${test.test} LIMIT ${limit}`, [zipName])
  const { rows: counted } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ${quote(tableName)} WHERE ${importedFromZip} AND ${test.test}`, [zipName])
  return {
    tableName,
    columnName,
    detail: test.detail,
    columns: shown,
    rows: sample.map((row) => shown.map((name) => String(row[name] ?? ''))),
    total: counted[0]?.n ?? 0,
  }
}

/** Validate YYYYMMDD without allowing malformed imported values to throw on a date cast. */
function validObservationDate(value: string) {
  const year = `substring(${value}, 1, 4)::int`
  const month = `substring(${value}, 5, 2)::int`
  const day = `substring(${value}, 7, 2)::int`
  return `CASE WHEN ${value} ~ '^[0-9]{8}$' THEN
    CASE WHEN ${year} BETWEEN 1 AND 9999 AND ${month} BETWEEN 1 AND 12 AND ${day} BETWEEN 1 AND 31
      THEN to_char(make_date(${year}, ${month}, 1) + (${day} - 1), 'YYYYMMDD') = ${value}
      ELSE false END ELSE false END`
}

/**
 * Every observation rule the app can run. `level` is `error` when the rows cannot be true at once
 * and `warning` when they merely look wrong and a human should judge.
 * The register table `observ_check` is seeded from this list — see syncObservationRules().
 */
function observationRules(): {
  id: ObservationRuleId; tableName: string; detail: string
  level: ObservationLevel; columns: string[]; sql: string
}[] {
  return [
    {
      id: 'service-after-death', tableName: 'service', level: 'error',
      detail: 'วันที่รับบริการหลังวันที่เสียชีวิตใน PERSON',
      columns: ['hospcode', 'pid', 'seq', 'date_serv', 'discharge', 'ddischarge'],
      sql: `SELECT s.hospcode, s.pid, s.seq, s.date_serv, p.discharge, p.ddischarge,
        (p.discharge = '1' AND ${validObservationDate('p.ddischarge')} AND ${validObservationDate('s.date_serv')}) AS eligible,
        (s.date_serv > p.ddischarge) AS failed
        FROM service s LEFT JOIN person p ON p.hospcode = s.hospcode AND p.pid = s.pid
        WHERE s.${importedFromZip}`,
    },
    {
      id: 'thai-cid-mod11', tableName: 'person', level: 'error',
      detail: 'เลขบัตรประชาชนคนไทยไม่ผ่าน MOD11 (ต้องเป็นตัวเลข 13 หลัก)',
      columns: ['hospcode', 'pid', 'cid', 'nation'],
      sql: `SELECT p.hospcode, p.pid, p.cid, p.nation, (p.nation = '099') AS eligible,
        CASE WHEN p.cid ~ '^[0-9]{13}$' THEN
          ((11 - (SELECT SUM(substring(p.cid, n, 1)::int * (14 - n)) FROM generate_series(1, 12) n) % 11) % 10)
            <> substring(p.cid, 13, 1)::int ELSE true END AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    {
      id: 'prename-sex', tableName: 'person', level: 'warning',
      detail: 'คำนำหน้าชื่อไม่สอดคล้องกับเพศ',
      columns: ['hospcode', 'pid', 'prename', 'prename_full', 'sex', 'expected_sex'],
      sql: `SELECT p.hospcode, p.pid, p.prename, r.prename_full, p.sex, r.sex AS expected_sex,
        (p.sex IN ('1', '2') AND r.sex IN ('1', '2')) AS eligible,
        (p.sex <> r.sex) AS failed
        FROM person p LEFT JOIN c_person_prename r ON r.code = p.prename AND r.is_active = 1
        WHERE p.${importedFromZip}`,
    },
    {
      id: 'birth-in-future', tableName: 'person', level: 'error',
      detail: 'วันเกิดใน PERSON อยู่ในอนาคต',
      columns: ['hospcode', 'pid', 'birth', 'check_date'],
      sql: `SELECT p.hospcode, p.pid, p.birth,
        to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') AS check_date,
        ${validObservationDate('p.birth')} AS eligible,
        (p.birth > to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD')) AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    {
      id: 'service-before-birth', tableName: 'service', level: 'error',
      detail: 'วันที่รับบริการก่อนวันเกิดใน PERSON',
      columns: ['hospcode', 'pid', 'seq', 'date_serv', 'birth'],
      sql: `SELECT s.hospcode, s.pid, s.seq, s.date_serv, p.birth,
        (${validObservationDate('p.birth')} AND ${validObservationDate('s.date_serv')}) AS eligible,
        (s.date_serv < p.birth) AS failed
        FROM service s LEFT JOIN person p ON p.hospcode = s.hospcode AND p.pid = s.pid
        WHERE s.${importedFromZip}`,
    },
    {
      id: 'death-before-birth', tableName: 'person', level: 'error',
      detail: 'วันที่เสียชีวิตก่อนวันเกิดใน PERSON',
      columns: ['hospcode', 'pid', 'birth', 'discharge', 'ddischarge'],
      sql: `SELECT p.hospcode, p.pid, p.birth, p.discharge, p.ddischarge,
        (p.discharge = '1' AND ${validObservationDate('p.birth')} AND ${validObservationDate('p.ddischarge')}) AS eligible,
        (p.ddischarge < p.birth) AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    ...(['diagnosis_opd', 'drug_opd'] as const).map((tableName) => ({
      id: (tableName === 'diagnosis_opd' ? 'diagnosis-without-service' : 'drug-without-service') as ObservationRuleId,
      tableName,
      level: 'error' as ObservationLevel,
      detail: `${tableName.toUpperCase()} ไม่มี SERVICE ที่ตรงกัน (HOSPCODE, PID, SEQ, DATE_SERV)`,
      columns: ['hospcode', 'pid', 'seq', 'date_serv', tableName === 'diagnosis_opd' ? 'diagcode' : 'didstd'],
      sql: `SELECT r.hospcode, r.pid, r.seq, r.date_serv, r.${tableName === 'diagnosis_opd' ? 'diagcode' : 'didstd'},
        (btrim(r.hospcode) <> '' AND btrim(r.pid) <> '' AND btrim(r.seq) <> '' AND ${validObservationDate('r.date_serv')}) AS eligible,
        NOT EXISTS (SELECT 1 FROM service s WHERE s.hospcode = r.hospcode AND s.pid = r.pid
          AND s.seq = r.seq AND s.date_serv = r.date_serv) AS failed
        FROM ${tableName} r WHERE r.${importedFromZip}`,
    })),
  ]
}

/**
 * Brings the `observ_check` register in line with the rules compiled into the app: new rules are
 * added, changed wording and order are refreshed, and a rule dropped from the code loses its row
 * because there is no SQL left to run for it. A rule the user switched off stays off.
 * Keyed on a digest of the catalogue, so a start that changes nothing writes nothing.
 */
export async function syncObservationRules(db: PGlite) {
  await createAppTables(db)
  const rules = observationRules()
  const version = 'observ@' + createHash('sha1')
    .update(JSON.stringify(rules.map((rule) => [rule.id, rule.tableName, rule.detail, rule.level])))
    .digest('hex').slice(0, 12)
  const done = await initializedVersion(db, 'observations')
  if (done?.version === version) return { ...done, applied: false }

  for (const [order, rule] of rules.entries()) {
    await db.query(`INSERT INTO observ_check (rule_id, table_name, detail, level, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (rule_id) DO UPDATE SET table_name = EXCLUDED.table_name,
        detail = EXCLUDED.detail, level = EXCLUDED.level, sort_order = EXCLUDED.sort_order`,
      [rule.id, rule.tableName, rule.detail, rule.level, order])
  }
  await db.query(`DELETE FROM observ_check WHERE rule_id NOT IN
    (${rules.map((_rule, index) => `$${index + 1}`).join(', ')})`, rules.map((rule) => rule.id))
  await recordInit(db, 'observations', version, 1, rules.length)
  return { version, table_count: 1, row_count: rules.length, applied: true }
}

/** The register as it stands, newest wording and switches included. */
export async function listObservationRules(db: PGlite): Promise<ObservationRule[]> {
  const { rows } = await db.query<ObservationRule>(`
    SELECT rule_id AS id, table_name AS "tableName", detail, level, is_active AS active
    FROM observ_check ORDER BY sort_order, rule_id`)
  return rows
}

/** Turns one registered rule on or off; the check run afterwards skips the ones that are off. */
export async function setObservationRuleActive(db: PGlite, ruleId: string, active: boolean) {
  await db.query('UPDATE observ_check SET is_active = $2 WHERE rule_id = $1', [ruleId, active])
}

/** Read-only checks scoped to imported rows; PERSON lookups may come from an earlier zip. */
export async function checkObservations(db: PGlite, zipName: string): Promise<ObservationResult> {
  await syncObservationRules(db)
  const compiled = new Map(observationRules().map((rule) => [rule.id, rule]))
  const findings: ObservationFinding[] = []
  // The register decides which rules run and in what order; the code decides what each one asks.
  for (const registered of await listObservationRules(db)) {
    const rule = compiled.get(registered.id)
    if (!rule || !registered.active) continue
    const result = await db.query<{ checked: number; skipped: number; found: number }>(`
      WITH candidates AS (${rule.sql}) SELECT
        COUNT(*) FILTER (WHERE eligible)::int AS checked,
        COUNT(*) FILTER (WHERE eligible IS NOT TRUE)::int AS skipped,
        COUNT(*) FILTER (WHERE eligible AND failed)::int AS found FROM candidates`, [zipName])
    findings.push({ id: rule.id, tableName: registered.tableName, detail: registered.detail,
      level: registered.level, ...result.rows[0] })
  }
  return { zipName, checkedAt: new Date().toISOString(), findings }
}

export async function observationRows(db: PGlite, zipName: string, ruleId: string): Promise<FailingRows> {
  const rule = observationRules().find((entry) => entry.id === ruleId)
  if (!rule) throw new Error('ไม่รู้จักเกณฑ์ข้อสังเกต')
  // The heading follows the register, so a reworded rule reads the same here as in the result list.
  const { rows: registered } = await db.query<{ detail: string }>(
    'SELECT detail FROM observ_check WHERE rule_id = $1', [ruleId])
  const detail = registered[0]?.detail ?? rule.detail
  const result = await db.query<Record<string, string | number>>(`WITH candidates AS (${rule.sql})
    SELECT ${rule.columns.map(quote).join(', ')}, COUNT(*) OVER()::int AS total
    FROM candidates WHERE eligible AND failed ORDER BY ${rule.columns.map(quote).join(', ')} LIMIT 100`, [zipName])
  return { tableName: rule.tableName, columnName: '', detail, columns: rule.columns,
    rows: result.rows.map((row) => rule.columns.map((column) => String(row[column] ?? ''))),
    total: Number(result.rows[0]?.total ?? 0) }
}

/** The stored result of the last structure check of a zip. */
export async function structureResult(db: PGlite, zipName: string): Promise<StructureCheckResult | null> {
  const { rows } = await db.query<{
    tableName: string; columnName: string; fieldDescription: string; rule: string; detail: string; tableRows: number
    found: number; level: string; rowCount: number; ruleCount: number; checkedAt: string
  }>(`SELECT table_name AS "tableName", column_name AS "columnName", rule, detail,
        table_rows AS "tableRows", found, level,
        row_count AS "rowCount", rule_count AS "ruleCount", checked_at AS "checkedAt",
        COALESCE((SELECT COALESCE(NULLIF(d.description, ''), d.caption, '') FROM c_files_schema d
          WHERE LOWER(d.table_name) = l.table_name AND LOWER(d.name) = l.column_name AND d.is_active = 1
          ORDER BY d.no LIMIT 1), '') AS "fieldDescription"
      FROM structure_check_log l WHERE zip_name = $1
      ORDER BY CASE level WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, found DESC, table_name, column_name`,
    [zipName])
  if (!rows.length) return null
  return {
    zipName,
    rows: rows[0].rowCount,
    rules: rows[0].ruleCount,
    checkedAt: rows[0].checkedAt,
    findings: rows.filter((row) => row.rule !== 'passed').map(({ tableName, columnName, fieldDescription, rule, detail, tableRows, found, level }) =>
      ({ tableName, columnName, fieldDescription, rule, detail, tableRows, found, level })),
  }
}

/**
 * The date each file is counted by: its own service/event date when it has one, otherwise the
 * `d_update` column that all 52 files carry. Values are `YYYYMMDD` or `YYYYMMDDHHMMSS` in CE.
 */
function countingColumn(table: FileTable) {
  const dated = table.columns.find((column) => /^date(time)?_/i.test(column.name))
  return dated?.name ?? 'd_update'
}

/**
 * Row counts of one standard file for each Thai fiscal year given, October through September.
 * Fiscal 2569 runs from October 2568 (CE 2025-10) to September 2569 (CE 2026-09).
 */
export async function countByFiscalYears(db: PGlite, table: string, years: number[],
  structure: FileStructure = fileStructure as FileStructure): Promise<DataCountResult> {
  const definition = structure.tables.find((entry) => entry.name === table)
  if (!definition) throw new Error(`ไม่รู้จักแฟ้ม ${table}`)
  const column = countingColumn(definition)
  // แฟ้มสะสม carries no service date of its own, so it falls back to `d_update` — the month a row
  // was last edited is not a month of activity, so those files are reported by fiscal year only.
  const cumulative = column === 'd_update'
  if (!years.length) return { table, column, cumulative, years: [] }

  const from = `${Math.min(...years) - 544}10`
  const to = `${Math.max(...years) - 543}09`
  const { rows } = await db.query<{ ym: string; n: number }>(`
    SELECT LEFT(${quote(column)}, 6) AS ym, COUNT(*)::int AS n
    FROM ${quote(table)}
    WHERE LEFT(${quote(column)}, 6) BETWEEN $1 AND $2
    GROUP BY 1`, [from, to])
  const found = new Map(rows.map((row) => [row.ym, row.n]))

  return {
    table,
    column,
    cumulative,
    years: [...years].sort((first, second) => second - first).map((fiscalYear) => {
      const months = Array.from({ length: 12 }, (_unused, index) => {
        const month = ((9 + index) % 12) + 1
        const year = index < 3 ? fiscalYear - 544 : fiscalYear - 543
        return found.get(`${year}${String(month).padStart(2, '0')}`) ?? 0
      })
      return { fiscalYear, months, total: months.reduce((sum, count) => sum + count, 0) }
    }),
  }
}

/** Opens a run in the import history and returns its id, which stamps every row it brings in. */
export async function startImportRun(db: PGlite, file: { name: string; path: string; size: number }) {
  const { rows } = await db.query<{ id: number }>(`
    INSERT INTO import52files_log (file_name, file_path, file_size, status, progress_percent)
    VALUES ($1, $2, $3, 'running', 0) RETURNING id::int AS id`, [file.name, file.path, file.size])
  return rows[0].id
}

export async function finishImportRun(db: PGlite, id: number,
  result: { status: 'complete' | 'failed'; rowCount: number; message: string }) {
  await db.query(`UPDATE import52files_log
    SET status = $2, row_count = $3, message = $4, finished_at = now(),
        progress_percent = CASE WHEN $2 = 'complete' THEN 100 ELSE progress_percent END
    WHERE id = $1`, [id, result.status, result.rowCount, result.message])
}

export async function updateImportProgress(db: PGlite, id: number, percent: number, rowCount: number) {
  await db.query('UPDATE import52files_log SET progress_percent = $2, row_count = $3 WHERE id = $1',
    [id, percent, rowCount])
}

/**
 * Loads one standard file's rows into its table. Columns are matched by header name, so an export
 * with fewer (or extra) columns than the mirrored structure still works; unknown headers are
 * ignored and missing ones keep their default. Every row is stamped with the import run id.
 * Rows that clash with an existing primary key are skipped, so re-importing a file is safe.
 */
export async function insertStandardRows(db: PGlite, runId: number, table: string,
  header: string[], rows: string[][], structure: FileStructure = fileStructure as FileStructure) {
  if (!rows.length) return 0
  const definition = structure.tables.find((entry) => entry.name === table)
  if (!definition) return 0
  const known = new Map(definition.columns.map((column) => [column.name.toLowerCase(), column]))
  const mapped = header
    .map((name, index) => ({ column: known.get(name.trim().toLowerCase()), index }))
    .filter((entry): entry is { column: FileColumn; index: number } => Boolean(entry.column))
  if (!mapped.length) return 0

  const names = [...mapped.map((entry) => entry.column.name), 'log_import_id']
  const cell = (entry: { column: FileColumn; index: number }, row: string[]) => {
    const raw = row[entry.index] ?? ''
    const length = entry.column.type === 'varchar' ? entry.column.length : null
    return length && raw.length > length ? raw.slice(0, length) : raw
  }

  // A newer file wins: rows that already exist are overwritten, not skipped, and re-stamped with
  // the run that brought them in. Files with no primary key have nothing to match on, so they can
  // only be appended.
  const keyed = definition.primaryKey.length
    && definition.primaryKey.every((key) => mapped.some((entry) => entry.column.name === key))
  const updatable = names.filter((name) => !definition.primaryKey.includes(name))
  const conflict = keyed
    ? `ON CONFLICT (${definition.primaryKey.map(quote).join(', ')}) DO UPDATE SET `
      + updatable.map((name) => `${quote(name)} = EXCLUDED.${quote(name)}`).join(', ')
    : 'ON CONFLICT DO NOTHING'

  // One statement may not touch the same row twice, so a duplicated key inside the file keeps its
  // last occurrence — the same "newer wins" rule, applied within the file.
  let incoming = rows
  if (keyed) {
    const byKey = new Map<string, string[]>()
    const keyIndexes = definition.primaryKey.map((key) => mapped.find((entry) => entry.column.name === key)!)
    for (const row of rows) byKey.set(keyIndexes.map((entry) => cell(entry, row)).join('|'), row)
    incoming = [...byKey.values()]
  }

  const target = `INSERT INTO ${quote(table)} (${names.map(quote).join(', ')}) VALUES `
  const perBatch = Math.max(1, Math.floor(5000 / names.length))
  let written = 0
  for (let index = 0; index < incoming.length; index += perBatch) {
    const batch = incoming.slice(index, index + perBatch)
    const values: unknown[] = []
    const placeholders = batch.map((row) => {
      const slots = mapped.map((entry) => { values.push(cell(entry, row)); return `$${values.length}` })
      values.push(runId)
      slots.push(`$${values.length}`)
      return `(${slots.join(', ')})`
    })
    const result = await db.query(`${target}${placeholders.join(', ')} ${conflict}`, values)
    written += result.affectedRows ?? 0
  }
  return written
}

function postgresType(mysqlType: string) {
  if (mysqlType === 'bigint') return 'bigint'
  if (mysqlType === 'int' || mysqlType === 'smallint' || mysqlType === 'tinyint') return 'integer'
  if (mysqlType === 'datetime' || mysqlType === 'timestamp') return 'timestamp'
  if (mysqlType === 'date') return 'date'
  return 'text'
}

function parameter(value: unknown) {
  if (value === undefined) return null
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Mirrors the SUB-HDC `c_*` reference (code) tables into this database, structure and rows,
 * from `reference/c-tables.json` (produced by `scripts/pull-reference-tables.mjs`).
 * These tables are pure copies of upstream code lists, so a newer pull replaces them wholesale.
 */
export async function loadReferenceTables(db: PGlite, data: ReferenceData = referenceData as ReferenceData) {
  await ensureInitTable(db)
  const version = versionOf(data)
  const done = await initializedVersion(db, 'reference')
  if (done?.version === version) return { ...done, applied: false }

  let total = 0
  for (const table of data.tables) {
    const definition = table.columns.map((column) => `${quote(column.name)} ${postgresType(column.type)}`).join(', ')
    await db.exec(`DROP TABLE IF EXISTS ${quote(table.name)}; CREATE TABLE ${quote(table.name)} (${definition});`)
    if (!table.rows.length) continue
    const names = table.columns.map((column) => column.name)
    const target = `INSERT INTO ${quote(table.name)} (${names.map(quote).join(', ')}) VALUES `
    const perBatch = Math.max(1, Math.floor(5000 / names.length))
    for (let index = 0; index < table.rows.length; index += perBatch) {
      const batch = table.rows.slice(index, index + perBatch)
      const values: unknown[] = []
      const placeholders = batch.map((row) => {
        const slots = names.map((name) => { values.push(parameter(row[name])); return `$${values.length}` })
        return `(${slots.join(', ')})`
      })
      await db.query(target + placeholders.join(', '), values)
    }
    total += table.rows.length
  }
  await recordInit(db, 'reference', version, data.tables.length, total)
  return { version, table_count: data.tables.length, row_count: total, applied: true }
}

/**
 * Our own revision of the 52-table schema, on top of whatever SUB-HDC structure file is in use.
 * Bump it when the DDL below changes so the change is applied once on the next start.
 */
const FILES_SCHEMA_REVISION = 4

/**
 * `log_import_id` is SUB-HDC's own column on every one of the 52 files, and PlkGap uses it as a
 * plain stamp: the id of the `import52files_log` run a row came from, joined on demand.
 * Deliberately no foreign key and no index — nothing to slow a bulk import down.
 * Revision 2 briefly added both, so they are dropped here for databases that already got them.
 */
async function unlinkImportLog(db: PGlite, table: FileTable) {
  if (!table.columns.some((column) => column.name === 'log_import_id')) return
  await db.exec(`ALTER TABLE ${quote(table.name)} DROP CONSTRAINT IF EXISTS ${quote(`${table.name}_log_import_id_fkey`)};
    DROP INDEX IF EXISTS ${quote(`idx_${table.name}_log_import_id`)};`)
}

function fileColumnType(column: FileColumn) {
  if (column.type === 'varchar' && column.length) return `varchar(${column.length})`
  if (column.type === 'int') return 'integer'
  if (column.type === 'bigint') return 'bigint'
  return 'text'
}

/**
 * MariaDB reports defaults as expressions: "''" for the empty string, "NULL" for none.
 * SUB-HDC has one NOT NULL text column with no default at all (`service.chiefcomp`); MySQL lets an
 * insert omit it, PostgreSQL does not, so give every NOT NULL text column the same empty default.
 */
function fileColumnDefault(column: FileColumn) {
  if (column.default && column.default !== 'NULL') return column.default
  if (!column.nullable && fileColumnType(column) !== 'integer' && fileColumnType(column) !== 'bigint') return "''"
  return null
}

function fileColumnDefinition(column: FileColumn) {
  const fallback = fileColumnDefault(column)
  return `${quote(column.name)} ${fileColumnType(column)}${column.nullable ? '' : ' NOT NULL'}`
    + (fallback ? ` DEFAULT ${fallback}` : '')
}

/**
 * Creates the 52 standard 43-file tables with the same structure as SUB-HDC — columns, types,
 * NOT NULL/defaults, primary keys and secondary indexes — and no rows. Structure comes from
 * `reference/f43-tables.json`.
 * These tables hold imported data, so this is additive only: it creates what is missing and
 * never drops a table, a column or the rows inside them.
 */
export async function createFileTables(db: PGlite, structure: FileStructure = fileStructure as FileStructure) {
  await ensureInitTable(db)
  await createAppTables(db)
  const version = `${versionOf(structure)}#${FILES_SCHEMA_REVISION}`
  const done = await initializedVersion(db, 'files43')
  if (done?.version === version) return { ...done, applied: false, created: 0 }

  const present = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
  const existing = new Set(present.rows.map((row) => row.table_name))
  let created = 0
  for (const table of structure.tables) {
    if (existing.has(table.name)) {
      // A newer structure file may add columns to a table that already holds imported rows.
      for (const column of table.columns) {
        await db.exec(`ALTER TABLE ${quote(table.name)} ADD COLUMN IF NOT EXISTS ${fileColumnDefinition(column)};`)
        const fallback = fileColumnDefault(column)
        if (fallback) {
          await db.exec(`ALTER TABLE ${quote(table.name)} ALTER COLUMN ${quote(column.name)} SET DEFAULT ${fallback};`)
        }
      }
    } else {
      created += 1
      const parts = table.columns.map(fileColumnDefinition)
      if (table.primaryKey.length) parts.push(`PRIMARY KEY (${table.primaryKey.map(quote).join(', ')})`)
      await db.exec(`CREATE TABLE ${quote(table.name)} (${parts.join(', ')});`)
    }
    for (const index of table.indexes) {
      await db.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(index.name)}
        ON ${quote(table.name)} (${index.columns.map(quote).join(', ')});`)
    }
    await unlinkImportLog(db, table)
  }
  await recordInit(db, 'files43', version, structure.tables.length, 0)
  return { version, table_count: structure.tables.length, row_count: 0, created, applied: true }
}
