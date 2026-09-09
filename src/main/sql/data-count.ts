import type { PGlite } from '@electric-sql/pglite'
import type { DataCountResult } from '../../shared/api'
import fileStructure from '../reference/f43-tables.json'
import type { FileTable, FileStructure } from './types'
import { quote } from './shared'

/**
 * The date each file is counted by: its own service/event date when it has one, otherwise the
 * `d_update` column that all 52 files carry. Values are `YYYYMMDD` or `YYYYMMDDHHMMSS` in CE.
 * Matched on the column name because the data dictionary cannot be trusted for this: it types
 * `clinical_refer.datetime_assess` and `drug_refer.datetime_dstart` as plain text, and does not
 * list `icf.date_serv` at all. So a file whose date is named otherwise (`procedure_refer.timestart`,
 * `death.ddeath`, `newborn.bdate`) still falls back to `d_update` and is reported by year only.
 */
export function countingColumn(table: FileTable) {
  const dated = table.columns.find((column) => /^date(time)?_/i.test(column.name))
  return dated?.name ?? 'd_update'
}

/**
 * แฟ้มสะสม as the 43-file manual marks it. `c_files_desc.description` carries the file's own
 * "□/☑ แฟ้มสะสม  □/☑ แฟ้มบริการ  □/☑ แฟ้มบริการกึ่งสำรวจ" line, and it is the only place upstream
 * says which kind a file is — `c_file.type` is null for all 52. DATA_CORRECT carries no such line
 * and counts as not cumulative.
 */
export async function isCumulativeFile(db: PGlite, table: string) {
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
