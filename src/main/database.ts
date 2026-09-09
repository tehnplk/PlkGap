import { createHash } from 'node:crypto'
import type { IndicatorReport, IndicatorResult, IndicatorGap } from '../shared/api'
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import type { ObservationLevel, ObservationRule, ObservationRuleId, ObservationFinding, ObservationResult } from '../shared/api'
import type { BoundaryCollection, BoundaryLevel, CheckProgress, DataCountResult, DatabaseStatus, FailingRows, Hospital, Household, ImportLogEntry, ReferenceCodeList, StructureCheckResult, StructureFinding } from '../shared/api'
import referenceData from './reference/c-tables.json'
import fileStructure from './reference/f43-tables.json'
import geographyData from './reference/geography.json'
import boundaryData from './reference/boundaries.json'
import structureCodes from './reference/structure-codes.json'
import tablesInUse from './reference/tables-in-use.json'

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

/** Named as each startup phase begins, so a splash screen can say what is taking the time. */
export type SchemaPhase = (phase: string) => void

export async function openDatabase(path: string, onPhase?: SchemaPhase) {
  const db = new PGlite(path, { extensions: { postgis } })
  try {
    onPhase?.('postgis')
    await db.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
    const setup = await initializeSchema(db, {}, onPhase)
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
      (SELECT SUM(table_count) FROM schema_init WHERE component IN ('reference', 'structure_codes'))::int AS "referenceTables",
      (SELECT SUM(row_count) FROM schema_init WHERE component IN ('reference', 'structure_codes'))::int AS "referenceRows",
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
 * What PlkGap seeds from the `c-tables.json` snapshot: the 43-file dictionary and file list, and
 * the service-unit registry. The `c_*` code lookups in that file are not seeded — the standard
 * code lists come from `structure-codes.json` instead.
 * Bump the revision when this list changes so an installed database is re-seeded once.
 */
export const referenceTablesInUse: string[] = tablesInUse.tables
const REFERENCE_TABLES_REVISION = 2

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
  DROP TABLE IF EXISTS reference_load CASCADE;`)
}

async function initializedVersion(db: PGlite, component: string) {
  const { rows } = await db.query<{ version: string; table_count: number; row_count: number }>(
    'SELECT version, table_count, row_count FROM schema_init WHERE component = $1', [component])
  return rows[0]
}

async function recordInit(db: Pick<PGlite, 'query'>, component: string, version: string, tables: number, rows: number) {
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
} = {}, onPhase?: SchemaPhase) {
  await ensureInitTable(db)
  onPhase?.('reference')
  const reference = await loadReferenceTables(db, data.reference)
  onPhase?.('geography')
  const geography = await loadGeographyTables(db)
  onPhase?.('app')
  const app = await createAppTables(db)
  onPhase?.('observations')
  const observations = await syncObservationRules(db)
  onPhase?.('files43')
  const files = await createFileTables(db, data.structure)
  onPhase?.('structure_codes')
  const codes = await loadStructureCodeTables(db, structureCodes, data.reference)
  // Last: the masked views mirror whatever tables the steps above ended up creating.
  onPhase?.('api')
  const api = await createApiSchema(db)
  return { reference, geography, files, app, observations, codes, api,
    firstRun: reference.applied || geography.applied || files.applied || app.applied || codes.applied }
}

/**
 * PlkGap's own standard code lists: the ministry's published files first, then the enumerations
 * `c_files_schema.description` spells out. These tables hold no user data, so each seed rebuilds
 * them; the 43-file tables and the dictionary are never touched.
 */
export async function loadStructureCodeTables(db: PGlite,
  catalog: { tables: ReferenceTable[] } = structureCodes,
  upstream: ReferenceData = referenceData as ReferenceData) {
  const version = createHash('sha256').update(JSON.stringify(catalog)).update(versionOf(upstream)).digest('hex')
  const done = await initializedVersion(db, 'structure_codes')
  if (done?.version === version) return { ...done, applied: false }
  // The snapshot still owns the dictionary and the service-unit registry, and always will.
  const tables = catalog.tables.filter((table) => !referenceTablesInUse.includes(table.name))
  let total = 0
  await db.transaction(async (tx) => {
    for (const table of tables) {
      if (!/^c_[a-z0-9_]+$/.test(table.name)) throw new Error('Invalid structure code table name')
      const names = table.columns.map((column) => column.name)
      if (names[0] !== 'code' || !names.includes('is_active')) throw new Error(`${table.name} is not a code list`)
      const definition = names.map((name) => name === 'code' ? '"code" text PRIMARY KEY'
        : name === 'is_active' ? '"is_active" integer NOT NULL DEFAULT 1'
        : `${quote(name)} text NOT NULL DEFAULT ''`).join(', ')
      // Rebuild only when the shape changed: the masked api views read these tables, and
      // createApiSchema restores them in the same run because their structure moved with it.
      const existing = await tx.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table.name])
      if (existing.rows.length && existing.rows.map((row) => row.column_name).join(',') === names.join(',')) {
        await tx.exec(`DELETE FROM ${quote(table.name)}`)
      } else {
        await tx.exec(`DROP TABLE IF EXISTS ${quote(table.name)} CASCADE; CREATE TABLE ${quote(table.name)} (${definition});`)
      }
      const target = `INSERT INTO ${quote(table.name)} (${names.map(quote).join(', ')}) VALUES `
      const perBatch = Math.max(1, Math.floor(5000 / names.length))
      for (let index = 0; index < table.rows.length; index += perBatch) {
        const values: unknown[] = []
        const placeholders = table.rows.slice(index, index + perBatch).map((row) => {
          const slots = names.map((name) => { values.push(parameter(row[name])); return `$${values.length}` })
          return `(${slots.join(', ')})`
        })
        await tx.query(target + placeholders.join(', '), values)
      }
      total += table.rows.length
    }
    await recordInit(tx, 'structure_codes', version, tables.length, total)
  })
  return { version, table_count: tables.length, row_count: total, applied: true }
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

  await db.exec(`DROP TABLE IF EXISTS c_province CASCADE; DROP TABLE IF EXISTS c_district CASCADE;
    DROP TABLE IF EXISTS c_subdistrict CASCADE;
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

  // Boundaries cover one province, so they are matched onto the country-wide name rows rather
  // than loaded as tables of their own.
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
 * PlkGap's own system tables (`observ_check`, alongside the `schema_init` register) and log tables
 * (`import52files_log`, `structure_check_log`), as opposed to the code lists and the 52 files.
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
  DROP TABLE IF EXISTS structure_check_log CASCADE;
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

/** Told after each file or rule finishes, so a long check can show where it is. */
export type CheckReporter = (progress: Omit<CheckProgress, 'kind' | 'zipName'>) => void
const step = (report: CheckReporter | undefined, done: number, total: number, name: string) =>
  report?.({ done, total, step: name, percent: total ? Math.round((done / total) * 100) : 100 })

interface DictionaryColumn { table: string; column: string; type: string; width: number; required: boolean
  unitCode: boolean; fieldDescription: string }
/**
 * Fields holding a service-unit code, which is always the full width in digits. The dictionary
 * leads with the words; ward, clinic, DRG and admission-number fields of the same width do not,
 * so they keep the plain width rule instead.
 */
const UNIT_CODE_FIELD = `(caption LIKE 'รหัสหน่วยบริการ%' OR caption LIKE 'หน่วยบริการ%'
  OR description LIKE 'รหัสหน่วยบริการ%')`
interface RuleTest { column: string; rule: string; detail: string; level: string; test: string }
const structureCodeReferences = new Map(structureCodes.bindings.map((binding) =>
  [`${binding.table}.${binding.column}`, binding.reference]))
/** The code list a field is judged by: an explicit binding first, then the naming convention. */
const referenceFor = (table: string, column: string) =>
  structureCodeReferences.get(`${table}.${column}`) ?? `c_${table}_${column}`
/** The longest code each list holds, to spot a field the dictionary declares too narrow. */
const longestCode = new Map(structureCodes.tables.map((table) =>
  [table.name, table.rows.reduce((longest, row) => Math.max(longest, String(row.code).length), 0)]))

async function structureReferenceTables(db: PGlite): Promise<Set<string>> {
  const { rows } = await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND LEFT(table_name, 2) = 'c_' AND column_name = 'code'`)
  return new Set(rows.map((row) => row.table_name))
}

/** Per value: required -> width -> existing reference lookup; report only the first failure. */
function ruleTests(entry: DictionaryColumn, references: Set<string>): RuleTest[] {
  const target = quote(entry.column)
  const empty = `${target} IS NULL OR ${target} = ''`
  const tests: RuleTest[] = []
  if (entry.required) {
    tests.push({ column: entry.column, rule: 'required', detail: 'ห้ามเป็นค่าว่าง', level: 'error', test: `(${empty})` })
  }
  const reference = referenceFor(entry.table, entry.column)
  // Where the published list holds a code longer than the dictionary declares, the width is the
  // stale part, not the data: EPI vaccine codes are C3 while the list holds HPVG91. Such a field
  // is checked by its list alone — not empty, and present in the list — with no width rule, so
  // the code rule must see every non-empty value including the long ones.
  const listedWider = references.has(reference) && (longestCode.get(reference) ?? 0) > entry.width
  // Every later rule skips what an earlier one already reported, so one value fails one rule.
  const tooWide = entry.width > 0 && !listedWider ? ` OR char_length(${target}) > ${entry.width}` : ''
  if (entry.width > 0 && !listedWider) {
    tests.push({ column: entry.column, rule: 'width', detail: `ความยาวเกิน ${entry.width} อักขระ`, level: 'error',
      test: `CASE WHEN ${empty} THEN FALSE ELSE char_length(${target}) > ${entry.width} END` })
  }
  if (entry.unitCode && entry.width > 0) {
    tests.push({ column: entry.column, rule: 'unitcode', level: 'error',
      detail: `รหัสหน่วยบริการต้องเป็นตัวเลข ${entry.width} หลัก`,
      // Empty values belong to the required rule, over-long ones to the width rule.
      test: `CASE WHEN ${empty}${tooWide} THEN FALSE ELSE ${target} !~ '^[0-9]{${entry.width}}$' END` })
  }
  if (references.has(reference)) {
    tests.push({ column: entry.column, rule: 'code', level: 'error',
      // A code the current standard does not list is wrong even when it once existed: the value
      // has a replacement, so say to fix it rather than which table failed to match.
      detail: 'ไม่ตรงตามรหัสมาตรฐาน',
      // Keep text comparison (01 differs from 1). Empty values belong to the required rule.
      test: `CASE WHEN ${empty}${tooWide} THEN FALSE ELSE NOT EXISTS (
        SELECT 1 FROM ${quote(reference)} AS valid_code
        WHERE valid_code.code::text = ${quote(entry.table)}.${target}) END` })
  }
  return tests
}

/** The rows a zip brought in, for scoping every structure query to that file. */
const importedFromZip = 'log_import_id IN (SELECT id FROM import52files_log WHERE file_name = $1)'


/**
 * Checks the rows imported from one zip against the real 43-file data dictionary
 * (`c_files_schema`): required values, then width, then an existing reference code list.
 * Scope is the zip file name, so every run that imported that file counts — re-importing the
 * same zip adds no rows, and the check still sees the rows the first run brought in.
 * The result replaces the zip's previous one in `structure_check_log`.
 */
export async function checkImportStructure(db: PGlite, zipName: string,
  report?: CheckReporter, structure: FileStructure = fileStructure as FileStructure): Promise<StructureCheckResult> {
  const dictionary = await db.query<DictionaryColumn>(`
    SELECT LOWER(table_name) AS table, LOWER(name) AS column, type,
      COALESCE(NULLIF(description, ''), caption, '') AS "fieldDescription",
      ${UNIT_CODE_FIELD} AS "unitCode",
      -- width is usually plain digits, but the dictionary has the odd '13.00'
      CASE WHEN width ~ '^[0-9]+' THEN SPLIT_PART(width, '.', 1)::int ELSE 0 END AS width,
      not_null = 'Y' AS required
    FROM c_files_schema WHERE is_active = 1`)
  const references = await structureReferenceTables(db)
  const byTable = new Map<string, DictionaryColumn[]>()
  for (const entry of dictionary.rows) {
    if (!byTable.has(entry.table)) byTable.set(entry.table, [])
    byTable.get(entry.table)!.push(entry)
  }

  const findings: StructureFinding[] = []
  let rows = 0
  let rules = 0
  let done = 0
  for (const table of structure.tables) {
    step(report, done++, structure.tables.length, table.name.toUpperCase())
    const columns = (byTable.get(table.name) ?? [])
      .filter((entry) => table.columns.some((column) => column.name === entry.column))
    if (!columns.length) continue

    const checks = columns.flatMap((entry) => ruleTests(entry, references))
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
      const reference = referenceFor(table.name, check.column)
      if (found > 0) findings.push({ tableName: table.name, columnName: check.column,
        fieldDescription: columns.find((entry) => entry.column === check.column)?.fieldDescription ?? '',
        rule: check.rule, detail: check.detail, tableRows: summary.total, found, level: check.level,
        ...(references.has(reference) ? { reference } : {}) })
    })
  }

  step(report, structure.tables.length, structure.tables.length, 'สรุปผล')
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

/** The column that names, per record, which rule the value broke. */
export const RULE_COLUMN = 'เกณฑ์'

/**
 * The actual rows behind a field's findings: the file's key columns, the offending value and the
 * rule each record broke, so a finding can be traced back to real records. Capped to a readable
 * sample. Without `rule` it covers every rule of that field — the rules are mutually exclusive per
 * value, so each record still names exactly one.
 */
export async function structureFailingRows(db: PGlite, zipName: string, tableName: string,
  columnName: string, rule = '', limit = 100,
  structure: FileStructure = fileStructure as FileStructure): Promise<FailingRows> {
  const definition = structure.tables.find((entry) => entry.name === tableName)
  if (!definition) throw new Error(`ไม่รู้จักแฟ้ม ${tableName}`)
  const { rows: dictionary } = await db.query<DictionaryColumn>(`
    SELECT LOWER(table_name) AS table, LOWER(name) AS column, type,
      CASE WHEN width ~ '^[0-9]+' THEN SPLIT_PART(width, '.', 1)::int ELSE 0 END AS width,
      not_null = 'Y' AS required, ${UNIT_CODE_FIELD} AS "unitCode"
    FROM c_files_schema
    WHERE is_active = 1 AND LOWER(table_name) = $1 AND LOWER(name) = $2`, [tableName, columnName])
  const references = await structureReferenceTables(db)
  const all = dictionary.flatMap((entry) => ruleTests(entry, references))
  const tests = rule ? all.filter((entry) => entry.rule === rule) : all
  if (!tests.length) throw new Error(rule
    ? `ไม่รู้จักเกณฑ์ ${rule} ของ ${tableName}.${columnName}`
    : `ไม่มีเกณฑ์สำหรับ ${tableName}.${columnName}`)

  // Standing columns first, so a row can always be traced back: who, which visit, and when.
  // `seq` identifies an outpatient visit and `an` an admission; `service` for one has a primary key
  // of (hospcode, seq, date_serv) — no pid — so the keys alone are not enough to recognise a record.
  const standing = ['hospcode', 'pid', 'seq', 'an', countingColumn(definition)]
    .filter((name) => definition.columns.some((column) => column.name === name))
  const shown = [...new Set([...standing, ...definition.primaryKey, columnName])]
  // Rule wording travels as a parameter, never inlined, and the CASE follows the same order the
  // check itself reports in: the first rule a value breaks is the one it is named by.
  const failed = tests.map((test) => `(${test.test})`).join(' OR ')
  const named = `CASE ${tests.map((test, index) => `WHEN ${test.test} THEN $${index + 2}`).join(' ')} END`
  const values = [zipName, ...tests.map((test) => test.detail)]
  const { rows: sample } = await db.query<Record<string, string>>(
    `SELECT ${shown.map(quote).join(', ')}, ${named} AS ${quote(RULE_COLUMN)}
     FROM ${quote(tableName)} WHERE ${importedFromZip} AND (${failed}) LIMIT ${limit}`, values)
  const { rows: counted } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ${quote(tableName)} WHERE ${importedFromZip} AND (${failed})`, [zipName])
  const columns = [...shown, RULE_COLUMN]
  return {
    tableName,
    columnName,
    detail: tests.length === 1 ? tests[0].detail : `ไม่ผ่าน ${tests.length} เกณฑ์`,
    columns,
    rows: sample.map((row) => columns.map((name) => String(row[name] ?? ''))),
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
 * The same for a `datetime_*` column, which the 43 files write as `YYYYMMDDHHMMSS` — though a
 * unit that only knows the day writes eight digits, so both lengths count as usable.
 * Only the date half is validated, so compare two stamps on `left(value, 8)`: a plain string
 * comparison of a 14-digit stamp against an 8-digit one would be meaningless.
 */
function validObservationStamp(value: string) {
  return `(${value} ~ '^[0-9]{8}([0-9]{6})?$' AND ${validObservationDate(`left(${value}, 8)`)})`
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
      sql: `SELECT p.hospcode, p.pid, p.prename, r.description AS prename_full, p.sex, r.sex AS expected_sex,
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
    {
      id: 'service-without-person', tableName: 'service', level: 'error',
      detail: 'SERVICE ไม่มีตัวตนใน PERSON (HOSPCODE, PID)',
      columns: ['hospcode', 'pid', 'seq', 'date_serv'],
      sql: `SELECT s.hospcode, s.pid, s.seq, s.date_serv,
        (btrim(s.hospcode) <> '' AND btrim(s.pid) <> '') AS eligible,
        NOT EXISTS (SELECT 1 FROM person p WHERE p.hospcode = s.hospcode AND p.pid = s.pid) AS failed
        FROM service s WHERE s.${importedFromZip}`,
    },
    {
      id: 'person-without-home', tableName: 'person', level: 'error',
      detail: 'คนในเขตรับผิดชอบอ้าง HID ที่ไม่มีในแฟ้ม HOME',
      columns: ['hospcode', 'pid', 'hid', 'typearea'],
      // TYPEAREA 4 and 5 live outside the catchment area, so they are not expected to have a house.
      sql: `SELECT p.hospcode, p.pid, p.hid, p.typearea,
        (p.typearea IN ('1', '2', '3') AND btrim(p.hid) NOT IN ('', '0')) AS eligible,
        NOT EXISTS (SELECT 1 FROM home h WHERE h.hospcode = p.hospcode AND h.hid = p.hid) AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    {
      id: 'duplicate-cid', tableName: 'person', level: 'error',
      detail: 'เลขบัตรประชาชนเดียวกันถูกใช้หลาย PID ในหน่วยบริการเดียวกัน',
      columns: ['hospcode', 'pid', 'cid', 'name', 'lname'],
      // Counted across every import of the same service unit, so a CID re-registered under a new
      // PID in a later zip is still one person; a different HOSPCODE is a different register and
      // never counts. Grouped once rather than tested per row, so a large PERSON stays a single scan.
      sql: `SELECT p.hospcode, p.pid, p.cid, p.name, p.lname,
        (p.cid ~ '^[0-9]{13}$') AS eligible,
        COALESCE(same_cid.pids, 0) > 1 AS failed
        FROM person p LEFT JOIN (
          SELECT hospcode, cid, COUNT(DISTINCT pid) AS pids FROM person
          WHERE cid ~ '^[0-9]{13}$' GROUP BY hospcode, cid) same_cid
          ON same_cid.hospcode = p.hospcode AND same_cid.cid = p.cid
        WHERE p.${importedFromZip}`,
    },
    {
      id: 'death-without-discharge', tableName: 'death', level: 'error',
      detail: 'มีในแฟ้ม DEATH แต่ PERSON ไม่ได้จำหน่าย "ตาย" หรือวันที่ไม่ตรงกัน',
      columns: ['hospcode', 'pid', 'ddeath', 'discharge', 'ddischarge'],
      sql: `SELECT d.hospcode, d.pid, d.ddeath, p.discharge, p.ddischarge,
        (${validObservationDate('d.ddeath')} AND p.pid IS NOT NULL) AS eligible,
        (p.discharge <> '1' OR p.ddischarge <> d.ddeath) AS failed
        FROM death d LEFT JOIN person p ON p.hospcode = d.hospcode AND p.pid = d.pid
        WHERE d.${importedFromZip}`,
    },
    {
      id: 'discharge-before-admit', tableName: 'admission', level: 'error',
      detail: 'วันจำหน่ายก่อนวันรับไว้นอนโรงพยาบาล',
      columns: ['hospcode', 'pid', 'an', 'datetime_admit', 'datetime_disch'],
      sql: `SELECT a.hospcode, a.pid, a.an, a.datetime_admit, a.datetime_disch,
        (${validObservationStamp('a.datetime_admit')} AND ${validObservationStamp('a.datetime_disch')}) AS eligible,
        (left(a.datetime_disch, 8) < left(a.datetime_admit, 8)) AS failed
        FROM admission a WHERE a.${importedFromZip}`,
    },
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
export async function checkObservations(db: PGlite, zipName: string,
  report?: CheckReporter): Promise<ObservationResult> {
  await syncObservationRules(db)
  const compiled = new Map(observationRules().map((rule) => [rule.id, rule]))
  const findings: ObservationFinding[] = []
  // The register decides which rules run and in what order; the code decides what each one asks.
  const registry = await listObservationRules(db)
  const active = registry.filter((registered) => registered.active && compiled.has(registered.id))
  let done = 0
  for (const registered of registry) {
    const rule = compiled.get(registered.id)
    if (!rule || !registered.active) continue
    step(report, done++, active.length, registered.tableName.toUpperCase())
    const result = await db.query<{ checked: number; skipped: number; found: number }>(`
      WITH candidates AS (${rule.sql}) SELECT
        COUNT(*) FILTER (WHERE eligible)::int AS checked,
        COUNT(*) FILTER (WHERE eligible IS NOT TRUE)::int AS skipped,
        COUNT(*) FILTER (WHERE eligible AND failed)::int AS found FROM candidates`, [zipName])
    findings.push({ id: rule.id, tableName: registered.tableName, detail: registered.detail,
      level: registered.level, ...result.rows[0] })
  }
  step(report, active.length, active.length, 'สรุปผล')
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
      ORDER BY table_name, column_name,
        CASE rule WHEN 'required' THEN 0 WHEN 'width' THEN 1 WHEN 'unitcode' THEN 2 WHEN 'code' THEN 3 ELSE 4 END, found DESC`,
    [zipName])
  if (!rows.length) return null
  // The log stores the finding, not the list it came from; both reads derive that the same way.
  const references = await structureReferenceTables(db)
  return {
    zipName,
    rows: rows[0].rowCount,
    rules: rows[0].ruleCount,
    checkedAt: rows[0].checkedAt,
    findings: rows.filter((row) => row.rule !== 'passed').map(({ tableName, columnName, fieldDescription, rule, detail, tableRows, found, level }) => {
      const reference = referenceFor(tableName, columnName)
      return { tableName, columnName, fieldDescription, rule, detail, tableRows, found, level,
        ...(references.has(reference) ? { reference } : {}) }
    }),
  }
}

/**
 * One whole `c_*` code list, so a finding can show what the field is allowed to contain.
 * Only a real code list is readable: the name has to be a `c_*` table that carries a `code` column.
 */
export async function referenceCodeList(db: PGlite, table: string): Promise<ReferenceCodeList> {
  const name = table.toLowerCase()
  if (!/^c_[a-z0-9_]+$/.test(name)) throw new Error(`ไม่รู้จักตาราง ${table}`)
  const { rows: columns } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [name])
  if (!columns.length || !columns.some((column) => column.column_name === 'code')) {
    throw new Error(`ไม่รู้จักตาราง ${table}`)
  }
  const names = columns.map((column) => column.column_name)
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${names.map(quote).join(', ')} FROM ${quote(name)} ORDER BY code`)
  return { table: name, columns: names,
    rows: rows.map((row) => names.map((column) => row[column] === null ? '' : String(row[column]))) }
}

/**
 * The date each file is counted by: its own service/event date when it has one, otherwise the
 * `d_update` column that all 52 files carry. Values are `YYYYMMDD` or `YYYYMMDDHHMMSS` in CE.
 * Matched on the column name because the data dictionary cannot be trusted for this: it types
 * `clinical_refer.datetime_assess` and `drug_refer.datetime_dstart` as plain text, and does not
 * list `icf.date_serv` at all. So a file whose date is named otherwise (`procedure_refer.timestart`,
 * `death.ddeath`, `newborn.bdate`) still falls back to `d_update` and is reported by year only.
 */
function countingColumn(table: FileTable) {
  const dated = table.columns.find((column) => /^date(time)?_/i.test(column.name))
  return dated?.name ?? 'd_update'
}

/**
 * แฟ้มสะสม as the 43-file manual marks it. `c_files_desc.description` carries the file's own
 * "□/☑ แฟ้มสะสม  □/☑ แฟ้มบริการ  □/☑ แฟ้มบริการกึ่งสำรวจ" line, and it is the only place upstream
 * says which kind a file is — `c_file.type` is null for all 52. DATA_CORRECT carries no such line
 * and counts as not cumulative.
 */
async function isCumulativeFile(db: PGlite, table: string) {
  const { rows } = await db.query<{ cumulative: boolean }>(
    `SELECT description ~ '☑\\s*แฟ้มสะสม' AS cumulative
     FROM c_files_desc WHERE LOWER(table_name) = $1 AND is_active = 1 LIMIT 1`, [table])
  return rows[0]?.cumulative ?? false
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
  // A month only means something for a file that records activity and has a date of its own:
  // แฟ้มสะสม is a standing register, and `d_update` says when a row was last edited, not when
  // anything happened. Everything else is reported by fiscal year alone.
  const byMonth = column !== 'd_update' && !await isCumulativeFile(db, table)
  if (!years.length) return { table, column, byMonth, years: [] }

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
    byMonth,
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
 * Loads the `c_*` reference tables into this database, structure and rows, from
 * `reference/c-tables.json` (produced by `scripts/pull-reference-tables.mjs`).
 * These tables are pure copies of upstream lists, so a newer pull replaces them wholesale.
 */
export async function loadReferenceTables(db: PGlite, data: ReferenceData = referenceData as ReferenceData) {
  await ensureInitTable(db)
  const kept = data.tables.filter((table) => referenceTablesInUse.includes(table.name))
  // Retired means nobody owns the name any more: not this list, and not the code catalog either,
  // which seeds its own tables under names the snapshot also happens to carry.
  const retired = data.tables.filter((table) => !referenceTablesInUse.includes(table.name)
    && !structureCodes.tables.some((entry) => entry.name === table.name))
  const version = `${versionOf(data)}#${REFERENCE_TABLES_REVISION}`
  const done = await initializedVersion(db, 'reference')
  if (done?.version === version) return { ...done, applied: false }

  // Databases seeded before the switch still hold the snapshot's code lookups; the catalog owns those
  // names now, and loadStructureCodeTables recreates the ones it defines later in this run.
  for (const table of retired) await db.exec(`DROP TABLE IF EXISTS ${quote(table.name)} CASCADE`)
  let total = 0
  for (const table of kept) {
    const definition = table.columns.map((column) => `${quote(column.name)} ${postgresType(column.type)}`).join(', ')
    await db.exec(`DROP TABLE IF EXISTS ${quote(table.name)} CASCADE; CREATE TABLE ${quote(table.name)} (${definition});`)
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
  await recordInit(db, 'reference', version, kept.length, total)
  return { version, table_count: kept.length, row_count: total, applied: true }
}

/**
 * Our own revision of the 52-table schema, on top of whatever structure file is in use.
 * Bump it when the DDL below changes so the change is applied once on the next start.
 */
const FILES_SCHEMA_REVISION = 4

/**
 * `log_import_id` is a column the 43-file structure carries on all 52 files, and PlkGap uses it as a
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
 * One NOT NULL text column has no default at all (`service.chiefcomp`); MySQL lets an
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
 * Creates the 52 standard 43-file tables with the structure `reference/f43-tables.json` defines —
 * columns, types, NOT NULL/defaults, primary keys and secondary indexes — and no rows.
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

/** One row of the answer to `GET /tables`. */
export interface TableSummary {
  table: string
  /** `file43` for the 52 standard files, `reference` for c_*, `app` for PlkGap's own, `postgis` for the extension's. */
  kind: 'file43' | 'reference' | 'app' | 'postgis'
  /** Only filled in when counting was asked for; null otherwise. */
  rowCount: number | null
}

/**
 * Every table in the database, tagged by which group it belongs to.
 * Counting is opt-in because an exact count of the 52 files is a full scan of tables holding every
 * row ever imported, and PGlite shares the main process with the windows — so the count runs under
 * the same read-only transaction and statement timeout as an API query.
 */
export async function listTables(db: PGlite, withCounts = false): Promise<TableSummary[]> {
  const { rows } = await db.query<{ table: string; kind: TableSummary['kind'] }>(`
    SELECT t.table_name AS "table",
      CASE WHEN t.table_name IN (SELECT file_name FROM c_file) THEN 'file43'
           WHEN t.table_name LIKE 'c\_%' THEN 'reference'
           WHEN t.table_name = 'spatial_ref_sys' THEN 'postgis'
           ELSE 'app' END AS kind
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY 2, 1`)
  if (!withCounts || !rows.length) return rows.map((row) => ({ ...row, rowCount: null }))

  const counted = await db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY')
    await tx.query(`SET LOCAL statement_timeout = '15s'`)
    const union = rows.map((row, index) =>
      `SELECT $${index + 1}::text AS t, COUNT(*)::int AS n FROM ${quote(row.table)}`).join(' UNION ALL ')
    return (await tx.query<{ t: string; n: number }>(union, rows.map((row) => row.table))).rows
  })
  const found = new Map(counted.map((row) => [row.t, row.n]))
  return rows.map((row) => ({ ...row, rowCount: found.get(row.table) ?? 0 }))
}

/** One column of the answer to `GET /desc/{table}`. */
export interface ColumnDescription {
  name: string
  type: string
  nullable: boolean
  default: string | null
  /** Thai field name and note from the 43-file dictionary; empty for tables it does not cover. */
  caption: string
  description: string
}
export interface TableDescription {
  table: string
  /** The file's own entry in `c_files_desc`, empty for anything that is not one of the 52. */
  description: string
  rowCount: number
  primaryKey: string[]
  indexes: string[]
  columns: ColumnDescription[]
}

/** Structure of one table in this database, with the Thai dictionary text where there is any. */
export async function describeTable(db: PGlite, table: string): Promise<TableDescription | null> {
  const name = table.trim().toLowerCase()
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) return null
  const { rows: present } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`, [name])
  if (!present[0]?.n) return null

  const { rows: columns } = await db.query<ColumnDescription>(`
    SELECT c.column_name AS name,
      c.data_type || COALESCE('(' || c.character_maximum_length || ')', '') AS type,
      c.is_nullable = 'YES' AS nullable, c.column_default AS "default",
      COALESCE(d.caption, '') AS caption, COALESCE(d.description, '') AS description
    FROM information_schema.columns c
    LEFT JOIN LATERAL (
      SELECT s.caption, s.description FROM c_files_schema s
      WHERE LOWER(s.table_name) = $1 AND LOWER(s.name) = c.column_name AND s.is_active = 1
      ORDER BY s.no LIMIT 1) d ON true
    WHERE c.table_schema = 'public' AND c.table_name = $1
    ORDER BY c.ordinal_position`, [name])
  const { rows: key } = await db.query<{ name: string }>(`
    SELECT a.attname AS name FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = to_regclass($1) AND i.indisprimary ORDER BY k.ord`, [name])
  const { rows: indexes } = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1
     ORDER BY indexname`, [name])
  const { rows: counted } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${quote(name)}`)
  const { rows: file } = await db.query<{ description: string }>(
    `SELECT description FROM c_files_desc WHERE LOWER(table_name) = $1 AND is_active = 1 LIMIT 1`, [name])

  return {
    table: name,
    description: file[0]?.description ?? '',
    rowCount: counted[0]?.n ?? 0,
    primaryKey: key.map((row) => row.name),
    indexes: indexes.map((row) => row.indexname),
    columns,
  }
}

/**
 * Columns `POST /sql` must never hand real values for. An entry without a table masks that column
 * name in every table it appears in; one with a table masks it there only.
 */
export const blockedApiColumns: { table?: string; column: string }[] = [
  { column: 'lname' },
  { column: 'cid' },
  { column: 'telephone' },
  { column: 'mobile' },
  { table: 'home', column: 'house' },
  { table: 'home', column: 'house_id' },
]

/** What a masked column reads as. */
export const MASK = '***'
/** The role `POST /sql` runs as: it can read the masked views and nothing else. */
export const API_ROLE = 'plkgap_api'
/** The schema holding one masked view per table, which is all that role can see. */
export const API_SCHEMA = 'api'

const blockedIn = (table: string, column: string) =>
  blockedApiColumns.some((entry) => entry.column === column && (!entry.table || entry.table === table))

/**
 * Builds a masked mirror of every table in schema `api` and points the API role at it.
 *
 * Masking the column names a query happens to return would stop nothing: `SELECT cid AS x` renames
 * it, `length(cid)` measures it, a subquery buries it. Replacing the value inside a view masks it
 * at the source, so every one of those reads `***` instead. The role gets no privilege at all on
 * `public`, so naming the real table outright is refused rather than answered.
 * Rebuilt only when the blocked list or the shape of the tables changes.
 */
export async function createApiSchema(db: PGlite) {
  await ensureInitTable(db)
  const { rows: columns } = await db.query<{ table_name: string; column_name: string }>(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position`)
  const version = 'api@' + createHash('sha1')
    .update(JSON.stringify([blockedApiColumns, MASK, columns])).digest('hex').slice(0, 12)
  const done = await initializedVersion(db, 'api')
  // Rebuilding a reference table drops its view along with it, and the column list can come back
  // identical, so the digest alone is not proof the views are still there.
  const { rows: present } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.views WHERE table_schema = '${API_SCHEMA}'`)
  const expected = new Set(columns.map((row) => row.table_name)).size
  if (done?.version === version && present[0].n === expected) return { ...done, applied: false }

  await db.exec(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${API_ROLE}') THEN
        CREATE ROLE ${API_ROLE} NOLOGIN;
      END IF;
    END $$;
    DROP SCHEMA IF EXISTS ${API_SCHEMA} CASCADE;
    CREATE SCHEMA ${API_SCHEMA};
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${API_ROLE};
    REVOKE ALL ON SCHEMA public FROM ${API_ROLE};
    -- USAGE only: enough to resolve the PostGIS functions living in public, never to read a table.
    GRANT USAGE ON SCHEMA public TO ${API_ROLE};
    GRANT USAGE ON SCHEMA ${API_SCHEMA} TO ${API_ROLE};`)

  const tables = [...new Set(columns.map((row) => row.table_name))]
  let masked = 0
  for (const table of tables) {
    const own = columns.filter((row) => row.table_name === table)
    if (own.some((row) => blockedIn(table, row.column_name))) masked += 1
    const list = own.map((row) => blockedIn(table, row.column_name)
      ? `'${MASK}'::text AS ${quote(row.column_name)}`
      : quote(row.column_name)).join(', ')
    await db.exec(`CREATE VIEW ${API_SCHEMA}.${quote(table)} AS SELECT ${list} FROM public.${quote(table)};`)
  }
  await db.exec(`GRANT SELECT ON ALL TABLES IN SCHEMA ${API_SCHEMA} TO ${API_ROLE};`)
  await recordInit(db, 'api', version, masked, blockedApiColumns.length)
  return { version, table_count: masked, row_count: blockedApiColumns.length, applied: true }
}

export interface SqlAnswer {
  columns: string[]
  rows: Record<string, unknown>[]
  /** Rows the statement produced, which is more than `rows.length` when the answer was capped. */
  rowCount: number
  truncated: boolean
}

/**
 * Runs one statement for the local HTTP API inside a read-only transaction with a statement
 * timeout. PostgreSQL itself refuses any write, so a data-modifying CTE cannot slip past a
 * keyword check and the 52 files full of imported rows cannot be dropped or emptied from here.
 * The timeout matters because PGlite runs in the main process: a runaway query freezes the app.
 */
export async function runReadOnlySql(db: PGlite, sql: string, limit = 5000): Promise<SqlAnswer> {
  const statement = sql.trim().replace(/;+\s*$/, '')
  if (!statement) throw new Error('ต้องส่ง SQL มาด้วย')
  return db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY')
    await tx.query(`SET LOCAL statement_timeout = '15s'`)
    // Dropping to the restricted role last, so the two SETs above still run as the owner.
    // `api` ahead of `public` means an unqualified table name lands on the masked view.
    await tx.query(`SET LOCAL ROLE ${API_ROLE}`)
    await tx.query(`SET LOCAL search_path = ${API_SCHEMA}, public`)
    const result = await tx.query<Record<string, unknown>>(statement).catch((reason: unknown) => {
      throw maskedAway(reason)
    })
    return {
      columns: result.fields.map((field) => field.name),
      rows: result.rows.slice(0, limit),
      rowCount: result.rows.length,
      truncated: result.rows.length > limit,
    }
  })
}

/** Names the guardrail when a query reached past the masked views for the real table. */
function maskedAway(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (!/permission denied/i.test(message)) return reason
  return new Error(`${message} — API นี้อ่านได้เฉพาะ schema ${API_SCHEMA} ที่ปิดบังข้อมูลส่วนบุคคลไว้แล้ว`
    + ' ให้เรียกชื่อตารางเปล่า ๆ ไม่ต้องนำหน้าด้วย public.')
}

/** Local quarterly calculations, not an implementation of annual HDC population rules. */
export async function processIndicators(db: PGlite, period: string): Promise<IndicatorReport> {
  const match = /^(25\d{2})-Q([1-4])$/.exec(period)
  if (!match) throw new Error('งวดข้อมูลไม่ถูกต้อง')
  const year = Number(match[1]) - 543
  const quarter = Number(match[2])
  const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '')
  const start = format(new Date(Date.UTC(year - 1, 9 + (quarter - 1) * 3, 1)))
  const end = format(new Date(Date.UTC(year - 1, 9 + quarter * 3, 1)))
  const numeric = (column: string) => `CASE WHEN btrim(${column}) ~ '^[0-9]{1,6}([.][0-9]{1,4})?$' THEN btrim(${column})::numeric END`
  const definitions = [
    { code: 'KPI-01', name: 'ร้อยละหญิงตั้งครรภ์ฝากครรภ์ครั้งแรกก่อน 12 สัปดาห์', target: 75, owner: 'กลุ่มงานส่งเสริมสุขภาพ',
      rule: 'B = ครรภ์ที่มี ANC ครั้งแรกที่พบในข้อมูลนำเข้าอยู่ในไตรมาสนี้ แยก HOSPCODE/PID/GRAVIDA; A = GA ครั้งแรก 1–11 สัปดาห์ ค้นประวัติก่อนงวดทุก ZIP; GA ว่าง/ผิดรูปแบบเป็นส่วนขาดข้อมูล ไม่ใช้ ANCNO แทนครั้งแรก',
      sql: `WITH first_anc AS (
        SELECT DISTINCT ON (hospcode, pid, gravida) hospcode, pid, gravida, date_serv, ${numeric('ga')} AS ga
        FROM anc WHERE hospcode <> '' AND pid <> '' AND gravida ~ '^[0-9]{1,2}$' AND ${numeric('gravida')} > 0
          AND ${validObservationDate('date_serv')} AND date_serv < $2
        ORDER BY hospcode, pid, gravida, date_serv, d_update DESC
      ), cohort AS (
        SELECT hospcode, pid, COALESCE(ga >= 1 AND ga < 12, false) AS passed,
          'ครรภ์ที่ ' || gravida || ': ' || CASE WHEN ga IS NULL OR ga <= 0 THEN 'ไม่มี GA ที่ใช้ได้'
          ELSE 'GA ' || ga::text || ' สัปดาห์' END AS detail
        FROM first_anc WHERE date_serv >= $1
      )` },
    { code: 'KPI-02', name: 'ร้อยละเด็ก 0-5 ปี มีพัฒนาการสมวัย', target: 85, owner: 'กลุ่มงานส่งเสริมสุขภาพ',
      rule: 'ต้องกำหนดชุดรหัส PPSPECIAL กลุ่มอายุ และวิธีรวมผลประเมินซ้ำ', unavailable: 'ยังไม่กำหนดนิยามผลพัฒนาการและประชากรเป้าหมาย' },
    { code: 'KPI-03', name: 'ร้อยละผู้ป่วยเบาหวานควบคุมระดับน้ำตาลได้ดี', target: 40, owner: 'กลุ่มงาน NCD',
      rule: 'B = ผู้ขึ้นทะเบียน CHRONIC รหัส E10–E14 วินิจฉัยก่อนสิ้นงวด และยังไม่จำหน่ายก่อนสิ้นงวด แยก HOSPCODE/PID; A = LABFU 0531601 ล่าสุดในไตรมาส มีค่า > 0 และ < 7 (%) ไม่มีผล/ผลผิดรูปแบบนับเป็นส่วนขาดข้อมูล',
      diagnosis: '^E1[0-4]', measurement: 'labfu', condition: "AND labtest = '0531601'",
      values: `${numeric('labresult')} AS a, NULL::numeric AS b`, passed: 'a > 0 AND a < 7',
      detail: "CASE WHEN a IS NULL OR a <= 0 THEN 'ไม่มี HbA1c ที่ใช้ได้ในงวด' ELSE 'HbA1c ' || a::text || '%' END" },
    { code: 'KPI-04', name: 'ร้อยละผู้ป่วยความดันโลหิตสูงควบคุมความดันได้ดี', target: 60, owner: 'กลุ่มงาน NCD',
      rule: 'B = ผู้ขึ้นทะเบียน CHRONIC รหัส I10–I15 วินิจฉัยก่อนสิ้นงวด และยังไม่จำหน่ายก่อนสิ้นงวด แยก HOSPCODE/PID; A = CHRONICFU ล่าสุดในไตรมาส มี SBP > 0 และ < 140 และ DBP > 0 และ < 90 mmHg ไม่มีผล/ผลผิดรูปแบบนับเป็นส่วนขาดข้อมูล',
      diagnosis: '^I1[0-5]', measurement: 'chronicfu', condition: '',
      values: `${numeric('sbp')} AS a, ${numeric('dbp')} AS b`, passed: 'a > 0 AND a < 140 AND b > 0 AND b < 90',
      detail: "CASE WHEN a IS NULL OR b IS NULL OR a <= 0 OR b <= 0 THEN 'ไม่มีความดันที่ใช้ได้ในงวด' ELSE 'BP ' || a::text || '/' || b::text || ' mmHg' END" },
    { code: 'KPI-05', name: 'ร้อยละการคัดกรองมะเร็งปากมดลูกในสตรี 30-60 ปี', target: 80, owner: 'กลุ่มงานควบคุมโรค',
      rule: 'ต้องกำหนดชุดรหัสคัดกรอง ระยะย้อนหลัง และประชากรเป้าหมาย/ข้อยกเว้น', unavailable: 'ยังไม่กำหนดนิยามการคัดกรองและระยะย้อนหลัง' },
    { code: 'KPI-06', name: 'อัตราการครองเตียงผู้ป่วยใน', target: 80, owner: 'กลุ่มงานบริการ',
      rule: 'วันนอน / จำนวนเตียงที่เปิดบริการและวันเปิดบริการ × 100', unavailable: 'ไม่มีแหล่งจำนวนเตียงที่เปิดบริการรายวัน' },
  ]
  return db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY')
    await tx.query(`SET LOCAL statement_timeout = '60s'`)
    const indicators: IndicatorResult[] = []
    for (const definition of definitions) {
      const base = { code: definition.code, name: definition.name, owner: definition.owner, target: definition.target,
        rule: definition.rule, numerator: 0, denominator: 0, value: null, gaps: [], gapCount: 0 }
      if (definition.unavailable) { indicators.push({ ...base, unavailable: definition.unavailable }); continue }
      const sql = definition.sql ?? `WITH registered AS (
        SELECT DISTINCT hospcode, pid FROM chronic
        WHERE hospcode <> '' AND pid <> '' AND upper(chronic) ~ '${definition.diagnosis}'
          AND ${validObservationDate('date_diag')} AND date_diag < $2
          AND (date_disch = '' OR (${validObservationDate('date_disch')} AND date_disch >= $2))
      ), latest AS (
        SELECT DISTINCT ON (hospcode, pid) hospcode, pid, ${definition.values}
        FROM ${definition.measurement} WHERE ${validObservationDate('date_serv')}
          AND date_serv >= $1 AND date_serv < $2 ${definition.condition}
        ORDER BY hospcode, pid, date_serv DESC, d_update DESC
      ), cohort AS (
        SELECT r.hospcode, r.pid, COALESCE(${definition.passed}, false) AS passed, ${definition.detail} AS detail
        FROM registered r LEFT JOIN latest m ON m.hospcode = r.hospcode AND m.pid = r.pid
      )`
      const result = await tx.query<{ numerator: number; denominator: number; gaps: IndicatorGap[] }>(`${sql}
        SELECT (SELECT count(*)::int FROM cohort WHERE passed) AS numerator,
          (SELECT count(*)::int FROM cohort) AS denominator,
          COALESCE((SELECT json_agg(g) FROM (
            SELECT c.hospcode, c.pid, COALESCE(p.cid, '') AS cid,
              COALESCE(NULLIF(btrim(concat_ws(' ', p.name, p.lname)), ''), 'ไม่พบทะเบียน PERSON') AS fullname, c.detail
            FROM cohort c LEFT JOIN person p ON p.hospcode = c.hospcode AND p.pid = c.pid
            WHERE NOT c.passed ORDER BY c.hospcode, c.pid, c.detail LIMIT 500
          ) g), '[]'::json) AS gaps`, [start, end])
      const { numerator, denominator, gaps } = result.rows[0]
      indicators.push({ ...base, numerator, denominator, gaps, gapCount: denominator - numerator,
        value: denominator ? numerator * 100 / denominator : null })
    }
    return { period, start, end, processedAt: new Date().toISOString(), indicators }
  })
}
