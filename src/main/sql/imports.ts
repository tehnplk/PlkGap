import type { PGlite } from '@electric-sql/pglite'
import type { ImportLogEntry } from '../../shared/api'
import fileStructure from '../reference/f43-tables.json'
import type { FileColumn, FileStructure } from './types'
import { quote } from './shared'

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
