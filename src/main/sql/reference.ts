import { createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { Hospital, ReferenceCodeList } from '../../shared/api'
import referenceData from '../reference/c-tables.json'
import structureCodes from '../reference/structure-codes.json'
import tablesInUse from '../reference/tables-in-use.json'
import type { ReferenceTable, ReferenceData } from './types'
import { ensureInitTable, initializedVersion, recordInit } from './schema-state'
import { quote, versionOf } from './shared'

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

/**
 * What PlkGap seeds from the `c-tables.json` snapshot: the 43-file dictionary and file list, and
 * the service-unit registry. The `c_*` code lookups in that file are not seeded — the standard
 * code lists come from `structure-codes.json` instead.
 * Bump the revision when this list changes so an installed database is re-seeded once.
 */
export const referenceTablesInUse: string[] = tablesInUse.tables

export const REFERENCE_TABLES_REVISION = 2

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

export function postgresType(mysqlType: string) {
  if (mysqlType === 'bigint') return 'bigint'
  if (mysqlType === 'int' || mysqlType === 'smallint' || mysqlType === 'tinyint') return 'integer'
  if (mysqlType === 'datetime' || mysqlType === 'timestamp') return 'timestamp'
  if (mysqlType === 'date') return 'date'
  return 'text'
}

export function parameter(value: unknown) {
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
