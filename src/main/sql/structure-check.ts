import type { PGlite } from '@electric-sql/pglite'
import type { FailingRows, StructureCheckResult, StructureFinding } from '../../shared/api'
import fileStructure from '../reference/f43-tables.json'
import structureCodes from '../reference/structure-codes.json'
import type { FileStructure } from './types'
import { quote, CheckReporter, step, importedFromZip } from './shared'
import { countingColumn } from './data-count'

export interface DictionaryColumn { table: string; column: string; type: string; width: number; required: boolean
  unitCode: boolean; fieldDescription: string }

/**
 * Fields holding a service-unit code, which is always the full width in digits. The dictionary
 * leads with the words; ward, clinic, DRG and admission-number fields of the same width do not,
 * so they keep the plain width rule instead.
 */
export const UNIT_CODE_FIELD = `(caption LIKE 'รหัสหน่วยบริการ%' OR caption LIKE 'หน่วยบริการ%'
  OR description LIKE 'รหัสหน่วยบริการ%')`

export interface RuleTest { column: string; rule: string; detail: string; level: string; test: string }

export const structureCodeReferences = new Map(structureCodes.bindings.map((binding) =>
  [`${binding.table}.${binding.column}`, binding.reference]))

/** The code list a field is judged by: an explicit binding first, then the naming convention. */
export const referenceFor = (table: string, column: string) =>
  structureCodeReferences.get(`${table}.${column}`) ?? `c_${table}_${column}`

/** The longest code each list holds, to spot a field the dictionary declares too narrow. */
export const longestCode = new Map(structureCodes.tables.map((table) =>
  [table.name, table.rows.reduce((longest, row) => Math.max(longest, String(row.code).length), 0)]))

export async function structureReferenceTables(db: PGlite): Promise<Set<string>> {
  const { rows } = await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND LEFT(table_name, 2) = 'c_' AND column_name = 'code'`)
  return new Set(rows.map((row) => row.table_name))
}

/** Per value: required -> width -> existing reference lookup; report only the first failure. */
export function ruleTests(entry: DictionaryColumn, references: Set<string>): RuleTest[] {
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
