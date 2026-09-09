// Pulls province / district / subdistrict boundaries from a PostGIS database and writes
// src/main/reference/boundaries.json, which openDatabase() seeds into the c_* geography tables.
//
//   SUBHDC_GIS_PASSWORD=secret node scripts/pull-boundaries.mjs
//
// Boundary codes are "TH65", "TH6501", "TH650101"; dropping the TH prefix gives exactly the
// CHANGWAT / AMPUR / TAMBON codes the 43 files use. There is no province table upstream, so the
// province outline is the union of its districts.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ~55 m: small enough to follow the real outline on screen, large enough to keep the file sane.
const TOLERANCE = process.env.SUBHDC_GIS_TOLERANCE ?? '0.0005'

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'reference', 'boundaries.json')
const cli = join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'db-cli', 'bin', 'db-cli.js')
const connection = [
  '-g', 'postgres',
  '-H', process.env.SUBHDC_GIS_HOST ?? '192.168.200.61',
  '-P', process.env.SUBHDC_GIS_PORT ?? '5434',
  '-u', process.env.SUBHDC_GIS_USER ?? 'postgres',
  '-p', process.env.SUBHDC_GIS_PASSWORD ?? '',
  '-d', process.env.SUBHDC_GIS_DATABASE ?? 'sub_hdc_gis',
]

function run(sql) {
  const output = execFileSync(process.execPath, [cli, ...connection, '-e', sql], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, DB_CLI_SKIP_UTF8_CONSOLE: '1' },
  })
  const lines = output.split(/\r?\n/)
  const header = lines.findIndex((line) => line.trim() === 'j')
  if (header < 0) throw new Error(`unexpected result:\n${output.slice(0, 400)}`)
  return JSON.parse(lines.slice(header + 1).join('\n').trim())
}

const simplified = (column) => `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${column}, ${TOLERANCE}))::json`

const provinces = run(`SELECT COALESCE(json_agg(row), '[]'::json) AS j FROM (
  SELECT REPLACE(province_code, 'TH', '') AS changwat, province_th AS "nameTh",
    ${simplified('ST_Union(geom)')} AS geom
  FROM district_boundary GROUP BY province_code, province_th) row`)

const districts = run(`SELECT COALESCE(json_agg(row), '[]'::json) AS j FROM (
  SELECT SUBSTRING(code, 3, 2) AS changwat, SUBSTRING(code, 5, 2) AS ampur,
    name_th AS "nameTh", ${simplified('geom')} AS geom
  FROM district_boundary ORDER BY code) row`)

const subdistricts = run(`SELECT COALESCE(json_agg(row), '[]'::json) AS j FROM (
  SELECT SUBSTRING(code, 3, 2) AS changwat, SUBSTRING(code, 5, 2) AS ampur, SUBSTRING(code, 7, 2) AS tambon,
    name_th AS "nameTh", ${simplified('geom')} AS geom
  FROM subdistrict_boundary ORDER BY code) row`)

const payload = {
  source: `${connection[3]}:${connection[5]}/${connection[11]}`,
  pulledAt: new Date().toISOString(),
  tolerance: TOLERANCE,
  provinces,
  districts,
  subdistricts,
}
await mkdir(dirname(target), { recursive: true })
await writeFile(target, JSON.stringify(payload))
console.log(`wrote ${target} — ${provinces.length} provinces, ${districts.length} districts, `
  + `${subdistricts.length} subdistricts`)
