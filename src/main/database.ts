import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import type { DatabaseStatus, Hospital, ImportLogEntry } from '../shared/api'
import referenceData from './reference/c-tables.json'
import fileStructure from './reference/f43-tables.json'

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
  const files = await createFileTables(db, data.structure)
  const app = await createAppTables(db)
  return { reference, files, app, firstRun: reference.applied || files.applied || app.applied }
}

/** Bump when a table below changes shape, so the new DDL runs once on the next start. */
const APP_SCHEMA_VERSION = 'app@1'

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
  CREATE INDEX IF NOT EXISTS idx_import52files_log_started ON import52files_log (started_at DESC);`)
  await recordInit(db, 'app', APP_SCHEMA_VERSION, 1, 0)
  return { version: APP_SCHEMA_VERSION, table_count: 1, row_count: 0, applied: true }
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

function fileColumnDefinition(column: FileColumn) {
  const type = column.type === 'varchar' && column.length ? `varchar(${column.length})`
    : column.type === 'int' ? 'integer'
    : column.type === 'bigint' ? 'bigint'
    : 'text'
  // MariaDB reports defaults as expressions: "''" for the empty string, "NULL" for none.
  const fallback = column.default && column.default !== 'NULL' ? ` DEFAULT ${column.default}` : ''
  return `${quote(column.name)} ${type}${column.nullable ? '' : ' NOT NULL'}${fallback}`
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
  const version = versionOf(structure)
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
  }
  await recordInit(db, 'files43', version, structure.tables.length, 0)
  return { version, table_count: structure.tables.length, row_count: 0, created, applied: true }
}
