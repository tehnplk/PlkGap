// Pulls two things out of a SUB-HDC MySQL/MariaDB server, both consumed by openDatabase():
//   src/main/reference/c-tables.json   the c_* reference (code) tables, structure AND rows
//   src/main/reference/f43-tables.json the 43-file data tables, structure ONLY (no rows)
//
//   SUBHDC_PASSWORD=secret node scripts/pull-reference-tables.mjs
//
// Host/port/user/database default to the provincial SUB-HDC box and can be overridden
// with SUBHDC_HOST / SUBHDC_PORT / SUBHDC_USER / SUBHDC_DATABASE.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Skipped entirely: SUB-HDC account tables, not 43-file reference data.
// c_user_provider also holds real ProviderID identities (name, cid_hash, e-mail, date of birth).
const EXCLUDED = new Set(['c_user_provider', 'c_user_role'])

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const referenceDirectory = join(root, 'src', 'main', 'reference')
const target = join(referenceDirectory, 'c-tables.json')
const cli = join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'db-cli', 'bin', 'db-cli.js')
const connection = [
  '-g', 'mysql',
  '-H', process.env.SUBHDC_HOST ?? '192.168.200.61',
  '-P', process.env.SUBHDC_PORT ?? '3308',
  '-u', process.env.SUBHDC_USER ?? 'root',
  '-p', process.env.SUBHDC_PASSWORD ?? '',
  '-d', process.env.SUBHDC_DATABASE ?? 'sub_hdc',
]

function run(statements) {
  const sql = ['SET SESSION group_concat_max_len=1000000000', ...statements].join('; ')
  const output = execFileSync(process.execPath, [cli, ...connection, '-e', sql], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, DB_CLI_SKIP_UTF8_CONSOLE: '1' },
  })
  // db-cli separates multi-statement results with a "command|<n>" marker; drop the SET result.
  return output.split(/^command\|\d+\r?\n/m).slice(2).map((block) => {
    const lines = block.split(/\r?\n/)
    if (lines[0].trim() !== 'j') throw new Error(`unexpected result header: ${lines[0]}`)
    return JSON.parse(lines.slice(1).join('\n').trim())
  })
}

const schema = process.env.SUBHDC_DATABASE ?? 'sub_hdc'
const [columns] = run([`SELECT JSON_ARRAYAGG(JSON_OBJECT(
  'table',table_name,'column',column_name,'type',data_type,'position',ordinal_position)) AS j
  FROM information_schema.columns WHERE table_schema='${schema}' AND table_name LIKE 'c\\_%'`])

const tables = new Map()
for (const column of columns.sort((a, b) => a.position - b.position)) {
  if (!tables.has(column.table)) tables.set(column.table, [])
  tables.get(column.table).push({ name: column.column, type: column.type })
}
for (const name of EXCLUDED) tables.delete(name)
const names = [...tables.keys()].sort()
console.log(`${names.length} reference tables (excluded: ${[...EXCLUDED].join(', ')})`)

const rows = {}
const batch = 12
for (let index = 0; index < names.length; index += batch) {
  const chunk = names.slice(index, index + batch)
  const results = run(chunk.map((table) => {
    const fields = tables.get(table).map((column) => `'${column.name}',\`${column.name}\``).join(',')
    return `SELECT IFNULL(JSON_ARRAYAGG(JSON_OBJECT(${fields})),JSON_ARRAY()) AS j FROM \`${table}\``
  }))
  if (results.length !== chunk.length) throw new Error(`expected ${chunk.length} results, got ${results.length}`)
  chunk.forEach((table, position) => { rows[table] = results[position] })
  console.log(`  ${index + chunk.length}/${names.length}`)
}

const total = names.reduce((sum, table) => sum + rows[table].length, 0)
const payload = {
  source: `${connection[3]}:${connection[5]}/${schema}`,
  pulledAt: new Date().toISOString(),
  excluded: [...EXCLUDED],
  tables: names.map((name) => ({ name, columns: tables.get(name), rows: rows[name] })),
}
await mkdir(dirname(target), { recursive: true })
await writeFile(target, JSON.stringify(payload))
console.log(`wrote ${target} — ${names.length} tables, ${total} rows`)

// --- the 43 standard files: structure only, never rows -----------------------------------

// c_file is SUB-HDC's own list of the standard files it accepts.
const [files] = run([`SELECT JSON_ARRAYAGG(file_name) AS j FROM c_file`])
const fileNames = files.map((name) => name.toLowerCase()).sort()
const quoted = fileNames.map((name) => `'${name}'`).join(',')

const [fileColumns, indexes] = run([
  `SELECT JSON_ARRAYAGG(JSON_OBJECT('table',table_name,'column',column_name,'type',data_type,
    'length',character_maximum_length,'nullable',is_nullable,'default',column_default,'position',ordinal_position)) AS j
    FROM information_schema.columns WHERE table_schema='${schema}' AND LOWER(table_name) IN (${quoted})`,
  `SELECT JSON_ARRAYAGG(JSON_OBJECT('table',table_name,'index',index_name,'column',column_name,
    'position',seq_in_index,'unique',1-non_unique)) AS j
    FROM information_schema.statistics WHERE table_schema='${schema}' AND LOWER(table_name) IN (${quoted})`,
])

const fileTables = new Map(fileNames.map((name) => [name, { columns: [], primaryKey: [], indexes: new Map() }]))
for (const column of fileColumns.sort((a, b) => a.position - b.position)) {
  fileTables.get(column.table.toLowerCase()).columns.push({
    name: column.column,
    type: column.type,
    length: column.length,
    nullable: column.nullable === 'YES',
    default: column.default,
  })
}
for (const entry of indexes.sort((a, b) => a.position - b.position)) {
  const table = fileTables.get(entry.table.toLowerCase())
  if (entry.index === 'PRIMARY') { table.primaryKey.push(entry.column); continue }
  if (!table.indexes.has(entry.index)) table.indexes.set(entry.index, { name: entry.index, unique: !!entry.unique, columns: [] })
  table.indexes.get(entry.index).columns.push(entry.column)
}

const structure = {
  source: payload.source,
  pulledAt: payload.pulledAt,
  tables: fileNames.map((name) => {
    const table = fileTables.get(name)
    if (!table.columns.length) throw new Error(`${name}: listed in c_file but has no columns`)
    return { name, columns: table.columns, primaryKey: table.primaryKey, indexes: [...table.indexes.values()] }
  }),
}
const structureTarget = join(referenceDirectory, 'f43-tables.json')
await writeFile(structureTarget, JSON.stringify(structure))
console.log(`wrote ${structureTarget} — ${structure.tables.length} files, `
  + `${structure.tables.reduce((sum, table) => sum + table.columns.length, 0)} columns, structure only`)
