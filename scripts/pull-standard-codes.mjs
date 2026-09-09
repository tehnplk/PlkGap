// The published standard code lists PlkGap validates the 43 files against, written to
// src/main/reference/standard-codes.json. Every entry names the dictionary fields it serves;
// the pull fails if a field does not exist.
// Re-run after the published lists are updated, then review the printed summary before committing.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'

const folder = 'https://drive.google.com/drive/folders/1V5CiVu3VjYH1u0f6Rv3OYilQBEhmIvKd'
const text = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Rows below the sheet header, keeping only codes shaped the way the field defines them. */
const codes = (rows, { skip = 2, code = 0, label = 1, pattern }) => rows.slice(skip)
  .map((row) => ({ code: text(row[code]), description: text(row[label]) }))
  .filter((row) => row.code && row.description && pattern.test(row.code))

const digits = (width) => new RegExp(`^[0-9]{${width}}$`)

/** ICF ships one row per code plus qualifier; the 43-file ICF keeps the two in separate columns. */
function icfBaseCodes(rows) {
  const groups = new Map()
  for (const row of rows.slice(1)) {
    const value = text(row[0])
    if (!value) continue
    const [code, qualifier = ''] = value.split('.')
    if (!groups.has(code)) groups.set(code, [])
    groups.get(code).push({ qualifier, description: text(row[1]) })
  }
  return groups
}

/** The wording a code's qualifier rows share is the condition itself. */
function commonPrefix(values) {
  let prefix = values[0] ?? ''
  for (const value of values) {
    let length = 0
    while (length < prefix.length && length < value.length && prefix[length] === value[length]) length++
    prefix = prefix.slice(0, length)
  }
  return prefix.trim().replace(/[\s:,\-–]+$/, '')
}

// Fixed by the ICF standard; the pull asserts the file still uses exactly this scale.
const icfQualifiers = [
  { code: '0', description: 'ไม่มีความบกพร่อง (NO)' },
  { code: '1', description: 'มีความบกพร่องเล็กน้อย (MILD)' },
  { code: '2', description: 'มีความบกพร่องปานกลาง (MODERATE)' },
  { code: '3', description: 'มีความบกพร่องรุนแรง (SEVERE)' },
  { code: '4', description: 'มีความบกพร่องทั้งหมด (COMPLETE)' },
  { code: '8', description: 'มีความบกพร่องที่ไม่ระบุรายละเอียด (Not specified)' },
  { code: '9', description: 'ไม่เกี่ยวข้อง (Not applicable)' },
]

/** One entry per published file: which fields it governs and how to read its sheet. */
export const sources = [
  {
    id: '1p0oejpxcYw6GW3VXo_kWxvAFw6VGlcET', sheet: 'รหัสคำนำหน้าชื่อ-mapping',
    title: '1.รหัสคำนำหน้าชื่อ (แฟ้ม PERSON)_Dec19.xlsx',
    // A title used by both sexes gets one row per sex here; PERSON stores the title alone.
    build: (rows) => {
      const titles = new Map()
      for (const row of rows.slice(2)) {
        const code = text(row[0])
        if (!digits(3).test(code)) continue
        const entry = titles.get(code)
          ?? { code, description: text(row[3]), prename: text(row[2]), sex: new Set() }
        if (text(row[4])) entry.sex.add(text(row[4]))
        titles.set(code, entry)
      }
      return [{
        name: 'c_person_prename', fields: ['person.prename', 'provider.prename'],
        columns: ['code', 'description', 'prename', 'sex'],
        rows: [...titles.values()].map((entry) => ({ code: entry.code, description: entry.description,
          prename: entry.prename, sex: entry.sex.size === 1 ? [...entry.sex][0] : '' })),
      }]
    },
  },
  {
    id: '1dSmX_6QB04p39aCQxTSjtKE5KZkCu2yN', sheet: 'update (Sep17)',
    title: '6,7.รหัสเชื้อชาติ-สัญชาติ (แฟ้ม PERSON)Sep17.xls',
    build: (rows) => [{ name: 'c_person_nation', fields: ['person.race', 'person.nation'],
      rows: codes(rows, { skip: 1, pattern: digits(3) }) }],
  },
  {
    id: '1ojFSfaGqr5_JClDJZ-6uyI_8pbv25D_u', sheet: 'รหัสต่างด้าว',
    title: '15.รหัสความเป็นคนต่างด้าว (แฟ้ม PERSON).xls',
    build: (rows) => [{ name: 'c_person_labor', fields: ['person.labor'],
      rows: codes(rows, { pattern: digits(2) }) }],
  },
  {
    id: '1vZ1J4xebUCxxKzvE9xdXZ_658fiy2eEK', sheet: 'รหัสสถานะบุคคล',
    title: '16.รหัสสถานะบุคคล (แฟ้ม PERSON).xls',
    build: (rows) => [{ name: 'c_person_typearea', fields: ['person.typearea'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '12XzhE0pkhbP-ShHf-PJgBIM5lq7JHTXc', sheet: 'update (26Sep16)',
    title: '29.รหัสการตั้งครรภ์และการคลอด (แฟ้ม DEATH)26Sep16.xls',
    build: (rows) => [{ name: 'c_death_pregdeath', fields: ['death.pregdeath'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1Oq53sTcAOLzkORQZkq-CC6dseklnwDCu', sheet: 'รหัสประเภทการจำหน่าย',
    title: '33.รหัสประเภทการจำหน่าย (แฟ้ม CHRONIC).xls',
    build: (rows) => [{ name: 'c_chronic_typedisch', fields: ['chronic.typedisch'],
      rows: codes(rows, { pattern: digits(2) }) }],
  },
  {
    id: '1DyaxG3QRUDGTDa6AWQbD6Fxg25-3p1U4', sheet: 'รหัสสิทธิ(new)',
    title: '34,76,95,129,150.รหัสสิทธิการรักษาพยาบาล.xls',
    build: (rows) => [{ name: 'c_instype',
      fields: ['service.instype', 'admission.instype', 'charge_opd.instype', 'charge_ipd.instype'],
      rows: codes(rows, { pattern: digits(4) }) }],
  },
  {
    id: '1OFm4s2Hez1B3Z0wxS38XZnI-7OaVH8qL', sheet: '21Oct16',
    title: '39.รหัสประเภทที่อยู่ (แฟ้ม HOME).xls',
    build: (rows) => [{ name: 'c_housetype', fields: ['home.housetype', 'address.housetype'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1secRUY7Bt_1Q9IXfAK9VQnX_P-tJLynH', sheet: 'รหัสที่ตั้ง',
    title: '40.รหัสที่ตั้ง (แฟ้ม HOME).xls',
    build: (rows) => [{ name: 'c_home_locatype', fields: ['home.locatype'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1AkkMwZESaKs3LJWluvEzFeqkYrEIN8_2', sheet: 'รหัสการมีส้วม',
    title: '41.รหัสการมีส้วม (แฟ้ม HOME).xls',
    build: (rows) => [{ name: 'c_home_toilet', fields: ['home.toilet'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1sq6tOaiI8QqB5uvyJcUvsFhhL1XKkmY9', sheet: 'Sheet1',
    title: '57.รหัสประเภทความพิการ (แฟ้ม DISABILITY).xls',
    build: (rows) => [{ name: 'c_disability_disabtype', fields: ['disability.disabtype'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '186dnC0cbvaqHdaSPwiqECnq6GG5VVfPF', sheet: 'Sheet1',
    title: '58.รหัสสาเหตุความพิการ (แฟ้ม DISABILITY).xls',
    build: (rows) => [{ name: 'c_disability_disabcause', fields: ['disability.disabcause'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1_hwa1EZWewr4QTFc083UTlj0zQiFIe5u', sheet: 'รหัสประเภทบุคลากร 15Oct19',
    title: '61.รหัสประเภทบุคลากร (แฟ้ม PROVIDER) 15Oct19.xls',
    build: (rows) => [{ name: 'c_provider_providertype', fields: ['provider.providertype'],
      rows: codes(rows, { pattern: /^[0-9]{2,3}$/ }) }],
  },
  {
    id: '1VpRlUwiu2NbKABiXMJKwlT452zIHwOz_', sheet: 'รหัสสภาวิชาชีพ',
    title: '62.รหัสสภาวิชาชีพ (แฟ้ม PROVIDER) 04Nov68.xlsx',
    build: (rows) => [{ name: 'c_provider_council', fields: ['provider.council'],
      rows: codes(rows, { pattern: digits(2) }) }],
  },
  {
    id: '1n4pfUXO1FJzXIilTItOuIPGDpJ6vF3DC', sheet: 'รหัสวิธีการคุมกำเนิด ',
    title: '63,172.รหัสวิธีการคุมกำเนิด (แฟ้ม FP, WOMEN).xls',
    build: (rows) => [{ name: 'c_fptype', fields: ['fp.fptype', 'women.fptype'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1Pf46nulajn2qnw6cXHhXRKNyU1am6gBp', sheet: 'รหัสสาเหตุที่ไม่คุมกำเนิด',
    title: '64.รหัสสาเหตุที่ไม่คุมกำเนิด (แฟ้ม WOMEN).xls',
    build: (rows) => [{ name: 'c_women_nofpcause', fields: ['women.nofpcause'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1hW9vFt0jmneFuZ7x_6mVpa_G3XOxtZP7', sheet: 'ICF',
    title: '73.รหัสสภาวะสุขภาพ (แฟ้ม ICF).xls',
    build: (rows) => {
      const groups = icfBaseCodes(rows)
      const scale = icfQualifiers.map((entry) => entry.code).join(',')
      for (const [code, entries] of groups) {
        const found = entries.map((entry) => entry.qualifier).filter(Boolean).sort().join(',')
        // d570 ships without qualifier rows; anything else must use the full ICF scale.
        if (found && found !== scale) throw new Error(`ICF ${code} uses qualifiers ${found}`)
      }
      // The dictionary keeps ICF and QUALIFIER apart, but the published list is written together
      // and real files use that form, so both are valid: the condition alone and code.qualifier.
      return [
        { name: 'c_icf_icf', fields: ['icf.icf'], rows: [
          ...[...groups].map(([code, entries]) => ({ code,
            description: commonPrefix(entries.map((entry) => entry.description)) })),
          ...[...groups].flatMap(([code, entries]) => entries.filter((entry) => entry.qualifier)
            .map((entry) => ({ code: `${code}.${entry.qualifier}`, description: entry.description }))),
        ] },
        { name: 'c_icf_qualifier', fields: ['icf.qualifier'], rows: icfQualifiers },
      ]
    },
  },
  {
    id: '1cZ1hdKHQxLHYhLlJGv7FrziU6Za15aLc', sheet: 'รหัสชนิดผู้ป่วย',
    title: '75.รหัสที่ตั้งของที่อยู่ผู้รับบริการ (แฟ้ม SERVICE).xls',
    build: (rows) => [{ name: 'c_service_location', fields: ['service.location'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1tS_pgJT6ScPcqhk7yiyhVQiRpg4hM9cx', sheet: 'Sheet1',
    title: '78.รหัสประเภทการมารับบริการ (แฟ้ม SERVICE) 16June21.xls',
    build: (rows) => [{ name: 'c_service_typein', fields: ['service.typein'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1QnIvqHs0-TVQhmhycqW3QxR1kYPc0RZ1', sheet: 'Sheet1',
    title: '81.รหัสสถานบริการ (แฟ้มSERVICE).xls',
    build: (rows) => [{ name: 'c_servplace',
      fields: ['service.servplace', 'dental.servplace', 'ncdscreen.servplace', 'specialpp.servplace'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '14pPlcjSzpSHs972bmJpiX13gPNr_jHDp', sheet: 'update (26Sep16)',
    title: '82.รหัสสถานะผู้มารับบริการเมื่อเสร็จสิ้นบริการ (แฟ้ม SERVICE) 26Sep16.xls',
    build: (rows) => [{ name: 'c_service_typeout', fields: ['service.typeout'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1cOUSF_JU6K95-JwivdCOO5Mh3y8dSGQt', sheet: 'Sheet1',
    title: '85,139.รหัสประเภทการวินิจฉัย (แฟ้ม DIAGNOSIS_IPD,OPD).xls',
    build: (rows) => [{ name: 'c_diagtype', fields: ['diagnosis_opd.diagtype', 'diagnosis_ipd.diagtype'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1J7HWIyReeHArOmMdPPSok_HkUzNSiTZ-', sheet: 'update (26Sep16)',
    title: '87,88,91,96,128,133,141,145,147,151.รหัสแผนกที่รับบริการ 26Sep16.xls',
    // CLINIC is five digits: service type, this department, then a sub-clinic each hospital
    // defines itself, so the department list is a lookup, never a whole-value code rule.
    build: (rows) => [{ name: 'c_clinic_department', fields: [],
      unbound: 'CLINIC ประกอบจากหลายส่วน หลักที่ 4-5 หน่วยบริการกำหนดเอง จึงใช้เป็นตารางอ้างอิงเท่านั้น',
      rows: codes(rows, { pattern: digits(2) }) }],
  },
  {
    id: '1WyNDNZKVG9s1BCbJPYhQKooq7Bf_Qn-n', sheet: 'Sheet1',
    title: '93,148.รหัสหมวดค่าบริการ (แฟ้ม CHARGE_OPD,IPD).xls',
    build: (rows) => [{ name: 'c_chargeitem', fields: ['charge_opd.chargeitem', 'charge_ipd.chargeitem'],
      rows: codes(rows, { pattern: digits(2) }) }],
  },
  {
    id: '1rjrN_-U8oG67HhRxhIlKtZ2d3NXsSZKw', sheet: 'รง 506',
    title: '108.รหัสประเภทผู้ป่วยอุบัติเหตุ19สาเหตุ (แฟ้ม ACCIDENT).xls',
    // Sub-causes sit on unnumbered rows; only the 19 reported causes carry a code.
    build: (rows) => [{ name: 'c_accident_aetype', fields: ['accident.aetype'],
      rows: codes(rows, { label: 2, pattern: digits(2) })
        .map((row) => ({ ...row, description: row.description.replace(/^[0-9.]+\s*/, '') })) }],
  },
  {
    id: '1MYti4OTvWyEbG5lOncXs16ONZyXVSILq', sheet: 'Sheet1',
    title: '120.การให้น้ำเกลือ (แฟ้ม ACCIDENT).xls',
    build: (rows) => [{ name: 'c_accident_fluid', fields: ['accident.fluid'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1gF3qO4jSElEVCM4jFVv9RcHs3EFIPgrm', sheet: 'Lab2016',
    title: '125.รหัสการตรวจทางห้องปฎิบัติการ2016 (แฟ้ม LABFU) 27Feb67.xlsx',
    build: (rows) => [{ name: 'c_labfu_labtest', fields: ['labfu.labtest'],
      rows: codes(rows, { skip: 1, label: 2, pattern: digits(7) }) }],
  },
  {
    id: '1NCzR7kAsiz3FWEb4WzJvDSswKzab9Aic', sheet: 'รหัส ตรวจเท้า',
    title: '126.รหัสตรวจเท้า (แฟ้ม CHRONICFU).xls',
    build: (rows) => [{ name: 'c_chronicfu_foot', fields: ['chronicfu.foot'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1qLYGQoI1S168yiNyl0I3o5mPyubUBzH1', sheet: 'รหัส',
    title: '127.รหัสตรวจจอประสาทตา (แฟ้ม CHRONICFU).xls',
    build: (rows) => [{ name: 'c_chronicfu_retina', fields: ['chronicfu.retina'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1zoqx7Fl_jRQB-htuDiNB-8FhD72vbHPr', sheet: 'Sheet1',
    title: '131,136.รหัสสถานภาพการจำหน่ายผู้ป่วย (แฟ้ม ADMISSION).xls',
    build: (rows) => [{ name: 'c_admission_dischstatus', fields: ['admission.dischstatus'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1gvDzYj9Uni5H-0phhrq2obHnvmh9BK7f', sheet: 'upd 15Oct19',
    title: '158.รหัสประเภทผู้ได้รับบริการตรวจสภาวะทันตสุขภาพ (แฟ้ม DENTAL)15Oct19.xlsx',
    build: (rows) => [{ name: 'c_dental_denttype', fields: ['dental.denttype'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1OsmSDNtGpeTQlooctJY1f2nRtDlcjIER', sheet: 'Sheet1',
    title: '170.รหัสวิธีการตรวจน้ำตาลในเลือด (แฟ้ม NCDSCREEN).xls',
    build: (rows) => [{ name: 'c_ncdscreen_bstest', fields: ['ncdscreen.bstest'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1hGqbXlSOsn5QX24JVnUMxsKg-u1EZxKy', sheet: 'รหัสได้รับ VITK หรือไม่ ',
    title: '193.รหัสได้รับวิตามิน K หรือไม่ (แฟ้ม NEWBORN).xls',
    build: (rows) => [{ name: 'c_newborn_vitk', fields: ['newborn.vitk'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1VcsTxHIQfCoolhDGYdzSDSixjxTLcaQE', sheet: 'Sheet1',
    title: '194.รหัสได้รับการตรวจ TSH (แฟ้ม NEWBORN).xls',
    build: (rows) => [{ name: 'c_newborn_tsh', fields: ['newborn.tsh'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1sfnP_hZk_zBWb0d-IiwnfuMsISx0cLrK', sheet: 'วัคซีนใน EPI',
    title: '198.รหัสวัคซีน (แฟ้มEPIและนอกแผน)Edit2569 Update 14.02.69.xlsx',
    // The in-plan and out-of-plan sheets are one code list for the EPI file.
    extraSheets: ['วัคซีนนอก EPI'],
    build: (rows, extra) => [{ name: 'c_epi_vaccinetype', fields: ['epi.vaccinetype'],
      rows: [...codes(rows, { code: 1, label: 3, pattern: /^[0-9A-Z]{3,6}$/ }),
        ...codes(extra['วัคซีนนอก EPI'], { code: 1, label: 3, pattern: /^[0-9A-Z]{3,6}$/ })] }],
  },
  {
    id: '1G_P8Y-4tabxYiqTkCJNSLciUej3hTMxI', sheet: 'Sheet1',
    title: '162.รหัสกายอุปกรณ์ที่ได้รับ (แฟ้ม REHABILITATION) 25Sep68.xlsx',
    // Four digits, some with a variant letter; the sheet ends with a source note, not a code.
    build: (rows) => [{ name: 'c_rehabilitation_at_device', fields: ['rehabilitation.at_device'],
      rows: codes(rows, { skip: 1, pattern: /^[0-9]{4}[A-Z]?$/ }) }],
  },
  {
    id: '1D7mTQ81b1WaepEmlyELAzvkyQjr4CfOX', sheet: 'Sheet1',
    title: '201.รหัสระดับพัฒนาการเด็ก (แฟ้ม NUTRITION).xls',
    build: (rows) => [{ name: 'c_nutrition_childdevelop', fields: ['nutrition.childdevelop'],
      rows: codes(rows, { pattern: digits(1) }) }],
  },
  {
    id: '1WKXL6wwkdsJ5EV6M21KEXuP72Uo-DOjp', sheet: 'special pp',
    title: '205.รหัสบริการส่งเสริมป้องกันเฉพาะ (แฟ้มSpecialPP) Update Jun69.xlsx',
    build: (rows) => [{ name: 'c_specialpp_ppspecial', fields: ['specialpp.ppspecial'],
      rows: codes(rows, { pattern: /^[0-9][A-Z][0-9A-Z]{1,5}$/ }) }],
  },
  {
    id: '1MLq7UFccHrLntLbn_glIu_Fiv1fpTqr6', sheet: 'Community Activity',
    title: '207.รหัสกิจกรรมในชุมชน (CommunityActivity)21Apr23.xlsx',
    build: (rows) => [{ name: 'c_community_activity_comactivity', fields: ['community_activity.comactivity'],
      rows: codes(rows, { pattern: /^[0-9][A-Z][0-9A-Z]{1,5}$/ }) }],
  },
  {
    id: '1N9T48SqrI82uuVCxWHQ5_IfHHO24e-9e', sheet: 'Community Service',
    title: '208.รหัสการให้บริการสุขภาพระดับบุคคลในชุมชน (CommunityService)2April2025.xlsx',
    build: (rows) => [{ name: 'c_community_service_comservice', fields: ['community_service.comservice'],
      rows: codes(rows, { pattern: /^[0-9][A-Z][0-9A-Z]{1,5}$/ }) }],
  },
  {
    id: '1RizixfByrlSQ21ERm2uwWUycfGYi-aSo', sheet: 'POLICY_CODE',
    title: '209.รหัสนโยบาย (แฟ้มPOLICY).xlsx',
    build: (rows) => [{ name: 'c_policy_policy_id', fields: ['policy.policy_id'],
      rows: codes(rows, { label: 2, pattern: digits(3) }) }],
  },
]

async function download(id) {
  const response = await fetch(`https://drive.google.com/uc?export=download&id=${id}`)
  if (!response.ok) throw new Error(`Download ${id} failed: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export function buildStandardCodes(loaded, dictionary) {
  const known = new Set(dictionary.map((field) => `${String(field.table_name).toLowerCase()}.${String(field.name).toLowerCase()}`))
  const tables = []
  const bindings = []
  const unbound = []
  const files = []
  const duplicates = []
  for (const source of loaded) {
    const built = source.build(source.rows, source.extra ?? {})
    for (const table of built) {
      const seen = new Map()
      for (const row of table.rows) {
        // The published lists carry a few repeated codes; the first definition wins.
        if (seen.has(row.code)) { duplicates.push({ reference: table.name, code: row.code }); continue }
        seen.set(row.code, row)
      }
      if (!seen.size) throw new Error(`${table.name} has no rows`)
      for (const field of table.fields) {
        if (!known.has(field)) throw new Error(`${table.name} binds unknown field ${field}`)
        bindings.push({ table: field.split('.')[0], column: field.split('.')[1], reference: table.name })
      }
      if (table.unbound) unbound.push({ reference: table.name, reason: table.unbound })
      const columns = table.columns ?? ['code', 'description']
      tables.push({
        name: table.name,
        columns: [...columns.map((name) => ({ name, type: name === 'code' ? 'varchar' : 'text' })),
          { name: 'is_active', type: 'tinyint' }],
        rows: [...seen.values()].map((row) => ({ ...row, is_active: 1 })),
      })
    }
    files.push({ id: source.id, title: source.title, sheet: source.sheet,
      tables: built.map((table) => table.name) })
  }
  const names = tables.map((table) => table.name)
  if (new Set(names).size !== names.length) throw new Error('Duplicate table name in the catalog')
  return { tables, bindings, unbound, files, duplicates }
}

async function main() {
  const reference = new URL('../src/main/reference/c-tables.json', import.meta.url)
  const target = new URL('../src/main/reference/standard-codes.json', import.meta.url)
  const dictionary = JSON.parse(await readFile(reference, 'utf8')).tables
    .find((table) => table.name === 'c_files_schema').rows.filter((field) => field.is_active === 1)
  const loaded = []
  for (const source of sources) {
    const workbook = XLSX.read(await download(source.id), { type: 'buffer' })
    const read = (name) => {
      if (!workbook.Sheets[name]) throw new Error(`${source.title} has no sheet ${name}`)
      return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: '' })
    }
    const extra = Object.fromEntries((source.extraSheets ?? []).map((name) => [name, read(name)]))
    loaded.push({ ...source, rows: read(source.sheet), extra })
  }
  const { tables, bindings, unbound, files, duplicates } = buildStandardCodes(loaded, dictionary)
  const catalog = { source: folder, pulledAt: new Date().toISOString(), files, tables, bindings, unbound, duplicates }
  await writeFile(target, JSON.stringify(catalog, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({
    tables: tables.map((table) => `${table.name} (${table.rows.length})`),
    fields: bindings.length, unbound, duplicates,
  }, null, 2))
}

if (import.meta.url && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
