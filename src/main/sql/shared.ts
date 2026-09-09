import type { CheckProgress } from '../../shared/api'

export const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

export const versionOf = (data: { source: string; pulledAt: string }) => `${data.source}@${data.pulledAt}`

/** Told after each file or rule finishes, so a long check can show where it is. */
export type CheckReporter = (progress: Omit<CheckProgress, 'kind' | 'zipName'>) => void

export const step = (report: CheckReporter | undefined, done: number, total: number, name: string) =>
  report?.({ done, total, step: name, percent: total ? Math.round((done / total) * 100) : 100 })

/** The rows a zip brought in, for scoping every structure query to that file. */
export const importedFromZip = 'log_import_id IN (SELECT id FROM import52files_log WHERE file_name = $1)'

/** Validate YYYYMMDD without allowing malformed imported values to throw on a date cast. */
export function validObservationDate(value: string) {
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
export function validObservationStamp(value: string) {
  return `(${value} ~ '^[0-9]{8}([0-9]{6})?$' AND ${validObservationDate(`left(${value}, 8)`)})`
}
