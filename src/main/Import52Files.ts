import yauzl from 'yauzl'
import type { ImportCheck } from '../shared/api'

/** The exports are UTF-8 in practice; older ones can still be Thai code page 874. */
function decode(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-874').decode(buffer)
  }
}

/**
 * Hands every file inside the zip to `handler`, one at a time, so only a single entry is ever
 * held in memory. Directories are skipped.
 */
export function eachZipTextEntry(path: string, handler: (name: string, text: string) => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('อ่านไฟล์ zip ไม่ได้')); return }
      zip.on('end', resolve)
      zip.on('error', reject)
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { reject(streamError ?? new Error(`อ่าน ${entry.fileName} ไม่ได้`)); return }
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('error', reject)
          stream.on('end', () => {
            handler(entry.fileName, decode(Buffer.concat(chunks)))
              .then(() => zip.readEntry())
              .catch(reject)
          })
        })
      })
      zip.readEntry()
    })
  })
}

/** The 43-file exports are pipe-delimited with a header row of column names. */
export function parsePipeFile(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  const header = (lines.shift() ?? '').split('|').map((name) => name.trim())
  return { header, rows: lines.map((line) => line.split('|')) }
}

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
