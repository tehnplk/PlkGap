// The code lists PlkGap validates the 43 files against. Two sources, in this order:
//   1. standard-codes.json — the published standard lists (scripts/pull-standard-codes.mjs)
//   2. c_files_schema.description, for fields whose codes the dictionary spells out itself
// Re-run after either source is refreshed; review the generated audit before committing.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import standardCodes from '../src/main/reference/standard-codes.json' with { type: 'json' }

const aliases = { 'provider.sex': 'c_person_sex' }

// Fields whose codes the dictionary states in prose the parser cannot read. Transcribed from the
// same c_files_schema.description text, reviewed by hand. Only lists worth a code rule are here:
// anc.ancno (a visit number) and drugallergy.alevel (a severity scale) keep the required and width
// rules alone, by decision. labor.bplace ends at a bare "5=", so code 5 says so.
const transcribed = {
  'labor.bplace': [
    ['1', 'โรงพยาบาล'],
    ['2', 'สถานีอนามัย/หน่วยบริการปฐมภูมิ'],
    ['3', 'บ้าน'],
    ['4', 'ระหว่างทาง'],
    ['5', 'ไม่ระบุคำอธิบายไว้ในพจนานุกรม'],
  ],
}

export function buildStructureCodes(reference, standard = standardCodes) {
  const dictionary = reference.tables.find((table) => table.name === 'c_files_schema')?.rows ?? []
  const tables = [...standard.tables]
  const bindings = [...standard.bindings]
  const published = new Map(standard.bindings.map((binding) => [`${binding.table}.${binding.column}`, binding.reference]))
  const created = new Map(tables.map((table) => [table.name, table]))
  const audit = standard.tables.map((table) => ({ reference: table.name, status: 'published',
    rows: table.rows.length, source: standard.source }))
  for (const field of dictionary) {
    if (field.is_active !== 1) continue
    const description = String(field.description ?? '')
    const matches = [...description.matchAll(/(?<![\w.])([0-9]+)\s*=\s*/g)]
    const table = field.table_name.toLowerCase()
    const column = field.name.toLowerCase()
    const key = `${table}.${column}`
    if (!matches.length && !transcribed[key]) continue
    // A published list is the standard itself; the dictionary paraphrase never overrides it.
    if (published.has(key)) {
      audit.push({ field: key, reference: published.get(key), status: 'published' })
      continue
    }
    if (transcribed[key]) {
      const name = `c_${table}_${column}`
      const generated = {
        name,
        columns: [{ name: 'code', type: 'varchar' }, { name: 'description', type: 'text' }, { name: 'is_active', type: 'tinyint' }],
        rows: transcribed[key].map(([code, value]) => ({ code, description: value, is_active: 1 })),
      }
      tables.push(generated)
      created.set(name, generated)
      bindings.push({ table, column, reference: name })
      audit.push({ field: key, reference: name, status: 'transcribed', description })
      continue
    }
    // Dates can mention another field's codes; a score plus an unknown sentinel is not an enum.
    if (['D', 'DT', 'N'].includes(field.type) || /YYYY|ค่าคะแนนจริง|ช่วงคะแนน/.test(description)) {
      audit.push({ field: key, status: 'review', reason: 'Date, numeric value or range; not a closed code list.', description })
      continue
    }
    const values = matches.map((match, index) => ({
      code: match[1],
      description: description.slice(match.index + match[0].length, matches[index + 1]?.index ?? description.length)
        .split(/หมายเหตุ\s*:/)[0].trim().replace(/[,\s]+$/, '')
        .replace(index === matches.length - 1 && /\([^)]*$/.test(description.slice(0, matches[0].index)) ? /\)\s*$/ : /$^/, '').trim(),
    }))
    if (new Set(values.map((value) => value.code)).size !== values.length || values.some((value) => !value.description)
      || matches.some((match) => /หมายเหตุ/.test(description.slice(0, match.index)))) {
      audit.push({ field: key, status: 'review', reason: 'Ambiguous or repeated code definitions.', description })
      continue
    }
    const name = aliases[key] ?? `c_${table}_${column}`
    const old = created.get(name)
    if (old) {
      // An alias points at a list another field already defined; both must agree on the codes.
      const codes = new Set(old.rows.map((row) => String(row.code)))
      const missing = values.filter((value) => !codes.has(value.code)).map((value) => value.code)
      audit.push({ field: key, reference: name, status: missing.length ? 'review' : 'reuse', missing })
      if (missing.length) continue
    } else {
      const generated = {
        name,
        columns: [{ name: 'code', type: 'varchar' }, { name: 'description', type: 'text' }, { name: 'is_active', type: 'tinyint' }],
        rows: values.map((value) => ({ ...value, is_active: 1 })),
      }
      tables.push(generated)
      created.set(name, generated)
      audit.push({ field: key, reference: name, status: 'create', description })
    }
    bindings.push({ table, column, reference: name })
  }
  return { source: 'standard-codes.json + c_files_schema.description', standardSource: standard.source,
    standardPulledAt: standard.pulledAt, dictionarySource: reference.source, dictionaryPulledAt: reference.pulledAt,
    tables, bindings, unbound: standard.unbound, audit }
}

async function main() {
  const source = new URL('../src/main/reference/c-tables.json', import.meta.url)
  const target = new URL('../src/main/reference/structure-codes.json', import.meta.url)
  const catalog = buildStructureCodes(JSON.parse(await readFile(source, 'utf8')))
  await writeFile(target, JSON.stringify(catalog, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({
    tables: catalog.tables.length, rows: catalog.tables.reduce((sum, table) => sum + table.rows.length, 0),
    fields: catalog.bindings.length,
    fromDictionary: catalog.audit.filter((entry) => entry.status === 'create').map((entry) => entry.reference),
    review: catalog.audit.filter((entry) => entry.status === 'review'),
  }, null, 2))
}

if (import.meta.url && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
