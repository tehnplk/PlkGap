import type { PGlite } from '@electric-sql/pglite'
import fileStructure from '../reference/f43-tables.json'
import type { FileColumn, FileTable, FileStructure } from './types'
import { ensureInitTable, initializedVersion, recordInit } from './schema-state'
import { quote, versionOf } from './shared'
import { createAppTables } from './app-schema'

/**
 * Our own revision of the 52-table schema, on top of whatever structure file is in use.
 * Bump it when the DDL below changes so the change is applied once on the next start.
 */
export const FILES_SCHEMA_REVISION = 4

/**
 * `log_import_id` is a column the 43-file structure carries on all 52 files, and PlkGap uses it as a
 * plain stamp: the id of the `import52files_log` run a row came from, joined on demand.
 * Deliberately no foreign key and no index — nothing to slow a bulk import down.
 * Revision 2 briefly added both, so they are dropped here for databases that already got them.
 */
export async function unlinkImportLog(db: PGlite, table: FileTable) {
  if (!table.columns.some((column) => column.name === 'log_import_id')) return
  await db.exec(`ALTER TABLE ${quote(table.name)} DROP CONSTRAINT IF EXISTS ${quote(`${table.name}_log_import_id_fkey`)};
    DROP INDEX IF EXISTS ${quote(`idx_${table.name}_log_import_id`)};`)
}

export function fileColumnType(column: FileColumn) {
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
export function fileColumnDefault(column: FileColumn) {
  if (column.default && column.default !== 'NULL') return column.default
  if (!column.nullable && fileColumnType(column) !== 'integer' && fileColumnType(column) !== 'bigint') return "''"
  return null
}

export function fileColumnDefinition(column: FileColumn) {
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
