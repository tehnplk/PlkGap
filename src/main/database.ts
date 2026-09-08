import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import type { DatabaseStatus } from '../shared/api'
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
    await loadReferenceTables(db)
    await createFileTables(db)
    return db
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}

export async function databaseStatus(db: PGlite, path: string): Promise<DatabaseStatus> {
  const { rows } = await db.query<Omit<DatabaseStatus, 'path'>>(`
    SELECT version() AS version, postgis_full_version() AS postgis,
      ST_AsText(ST_SetSRID(ST_MakePoint(100.2659, 16.8211), 4326)) AS geometry
  `)
  return { ...rows[0], path }
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

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
 * Mirrors the SUB-HDC `c_*` reference (code) tables into this database. The rows come from
 * `reference/c-tables.json`, produced by `scripts/pull-reference-tables.mjs`.
 * Idempotent: the file's version is recorded, and a second run with the same version is a no-op.
 */
export async function loadReferenceTables(db: PGlite, data: ReferenceData = referenceData as ReferenceData) {
  const version = `${data.source}@${data.pulledAt}`
  await db.exec(`CREATE TABLE IF NOT EXISTS reference_load (
    version text PRIMARY KEY,
    table_count integer NOT NULL,
    row_count integer NOT NULL,
    loaded_at timestamptz NOT NULL DEFAULT now()
  );`)
  const loaded = await db.query<{ table_count: number; row_count: number }>(
    'SELECT table_count, row_count FROM reference_load WHERE version = $1', [version])
  if (loaded.rows.length) return { ...loaded.rows[0], version, reloaded: false }

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
  await db.exec('DELETE FROM reference_load;')
  await db.query('INSERT INTO reference_load (version, table_count, row_count) VALUES ($1, $2, $3)',
    [version, data.tables.length, total])
  return { version, table_count: data.tables.length, row_count: total, reloaded: true }
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
 * These tables hold imported data, so this only ever creates what is missing; it never drops.
 */
export async function createFileTables(db: PGlite, structure: FileStructure = fileStructure as FileStructure) {
  let created = 0
  for (const table of structure.tables) {
    const exists = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table.name])
    if (!exists.rows.length) created += 1
    const parts = table.columns.map(fileColumnDefinition)
    if (table.primaryKey.length) parts.push(`PRIMARY KEY (${table.primaryKey.map(quote).join(', ')})`)
    await db.exec(`CREATE TABLE IF NOT EXISTS ${quote(table.name)} (${parts.join(', ')});`)
    for (const index of table.indexes) {
      await db.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(index.name)}
        ON ${quote(table.name)} (${index.columns.map(quote).join(', ')});`)
    }
  }
  return { table_count: structure.tables.length, created }
}
