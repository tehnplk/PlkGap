import yauzl from 'yauzl'
import type { ImportCheck } from '../shared/api'

/** Entry names inside a zip, directories dropped. Only the central directory is read. */
export function readZipEntries(path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('อ่านไฟล์ zip ไม่ได้')); return }
      const names: string[] = []
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('/')) names.push(entry.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

/**
 * `F43_07494_.../DIAGNOSIS_OPD.txt` and a bare `DIAGNOSIS_OPD.txt` both map to `diagnosis_opd`;
 * the zip may nest the files in a folder or not. Anything that is not a .txt maps to null.
 */
function standardName(entry: string): string | null {
  const base = entry.split(/[\\/]/).pop() ?? ''
  if (!/\.txt$/i.test(base)) return null
  return base.slice(0, -4).toLowerCase()
}

/**
 * Only a zip whose contents are exactly the standard files may be imported: every entry has to be
 * a .txt named after one of them (`c_file`), and none of them may be missing.
 */
export async function checkImportZip(path: string, standard: string[]): Promise<ImportCheck> {
  const expected = new Set(standard.map((name) => name.toLowerCase()))
  let entries: string[]
  try {
    entries = await readZipEntries(path)
  } catch (reason: unknown) {
    return { valid: false, entries: 0, found: [], missing: [...expected].sort(), unexpected: [], error: String(reason) }
  }
  const found = new Set<string>()
  const unexpected: string[] = []
  for (const entry of entries) {
    const name = standardName(entry)
    if (name && expected.has(name)) found.add(name)
    else unexpected.push(entry)
  }
  const missing = [...expected].filter((name) => !found.has(name)).sort()
  return {
    valid: !unexpected.length && !missing.length,
    entries: entries.length,
    found: [...found].sort(),
    missing,
    unexpected,
    error: '',
  }
}
