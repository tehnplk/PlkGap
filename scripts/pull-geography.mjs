// Downloads Thailand's administrative divisions and writes src/main/reference/geography.json,
// which openDatabase() seeds into c_province / c_district / c_subdistrict.
//
//   node scripts/pull-geography.mjs
//
// The codes line up with the 43-file scheme one for one: CHANGWAT is the 2-digit province code,
// AMPUR the 2 digits after it in the 4-digit district code, TAMBON the last 2 of the 6-digit
// subdistrict code. Override the source with GEOGRAPHY_SOURCE if the repository ever moves.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = process.env.GEOGRAPHY_SOURCE
  ?? 'https://raw.githubusercontent.com/thailand-geography-data/thailand-geography-json/main/src/'
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'reference', 'geography.json')

async function download(file) {
  const response = await fetch(source + file)
  if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`)
  return response.json()
}

const pad = (value, width) => String(value).padStart(width, '0')

const [provinces, districts, subdistricts] = await Promise.all(
  ['provinces.json', 'districts.json', 'subdistricts.json'].map(download))

const payload = {
  source,
  pulledAt: new Date().toISOString(),
  provinces: provinces.map((row) => ({
    changwat: pad(row.provinceCode, 2),
    nameTh: row.provinceNameTh,
    nameEn: row.provinceNameEn,
  })),
  districts: districts.map((row) => ({
    changwat: pad(row.provinceCode, 2),
    ampur: pad(row.districtCode, 4).slice(2),
    code: pad(row.districtCode, 4),
    nameTh: row.districtNameTh,
    nameEn: row.districtNameEn,
    postalCode: row.postalCode ? String(row.postalCode) : '',
  })),
  subdistricts: subdistricts.map((row) => ({
    changwat: pad(row.provinceCode, 2),
    ampur: pad(row.districtCode, 4).slice(2),
    tambon: pad(row.subdistrictCode, 6).slice(4),
    code: pad(row.subdistrictCode, 6),
    nameTh: row.subdistrictNameTh,
    nameEn: row.subdistrictNameEn,
    postalCode: row.postalCode ? String(row.postalCode) : '',
  })),
}

await mkdir(dirname(target), { recursive: true })
await writeFile(target, JSON.stringify(payload))
console.log(`wrote ${target} — ${payload.provinces.length} provinces, `
  + `${payload.districts.length} districts, ${payload.subdistricts.length} subdistricts`)
