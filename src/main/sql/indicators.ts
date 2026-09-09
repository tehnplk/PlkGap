import type { IndicatorReport, IndicatorResult, IndicatorGap } from '../../shared/api'
import type { PGlite } from '@electric-sql/pglite'
import { validObservationDate } from './shared'

/** Local quarterly calculations, not an implementation of annual HDC population rules. */
export async function processIndicators(db: PGlite, period: string): Promise<IndicatorReport> {
  const match = /^(25\d{2})-Q([1-4])$/.exec(period)
  if (!match) throw new Error('งวดข้อมูลไม่ถูกต้อง')
  const year = Number(match[1]) - 543
  const quarter = Number(match[2])
  const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '')
  const start = format(new Date(Date.UTC(year - 1, 9 + (quarter - 1) * 3, 1)))
  const end = format(new Date(Date.UTC(year - 1, 9 + quarter * 3, 1)))
  const numeric = (column: string) => `CASE WHEN btrim(${column}) ~ '^[0-9]{1,6}([.][0-9]{1,4})?$' THEN btrim(${column})::numeric END`
  const definitions = [
    { code: 'KPI-01', name: 'ร้อยละหญิงตั้งครรภ์ฝากครรภ์ครั้งแรกก่อน 12 สัปดาห์', target: 75, owner: 'กลุ่มงานส่งเสริมสุขภาพ',
      rule: 'B = ครรภ์ที่มี ANC ครั้งแรกที่พบในข้อมูลนำเข้าอยู่ในไตรมาสนี้ แยก HOSPCODE/PID/GRAVIDA; A = GA ครั้งแรก 1–11 สัปดาห์ ค้นประวัติก่อนงวดทุก ZIP; GA ว่าง/ผิดรูปแบบเป็นส่วนขาดข้อมูล ไม่ใช้ ANCNO แทนครั้งแรก',
      sql: `WITH first_anc AS (
        SELECT DISTINCT ON (hospcode, pid, gravida::int) hospcode, pid, gravida::int AS gravida, date_serv, ${numeric('ga')} AS ga
        FROM anc WHERE hospcode <> '' AND pid <> '' AND gravida ~ '^0*[1-9][0-9]?$'
          AND ${validObservationDate('date_serv')} AND date_serv < $2
        ORDER BY hospcode, pid, gravida::int, date_serv
      ), cohort AS (
        SELECT hospcode, pid, COALESCE(ga >= 1 AND ga < 12, false) AS passed,
          'ครรภ์ที่ ' || gravida::text || ': ' || CASE WHEN ga IS NULL OR ga <= 0 THEN 'ไม่มี GA ที่ใช้ได้'
          ELSE 'GA ' || ga::text || ' สัปดาห์' END AS detail
        FROM first_anc WHERE date_serv >= $1
      )` },
    { code: 'KPI-02', name: 'ร้อยละเด็ก 0-5 ปี มีพัฒนาการสมวัย', target: 85, owner: 'กลุ่มงานส่งเสริมสุขภาพ',
      rule: 'ต้องกำหนดชุดรหัส PPSPECIAL กลุ่มอายุ และวิธีรวมผลประเมินซ้ำ', unavailable: 'ยังไม่กำหนดนิยามผลพัฒนาการและประชากรเป้าหมาย' },
    { code: 'KPI-03', name: 'ร้อยละผู้ป่วยเบาหวานควบคุมระดับน้ำตาลได้ดี', target: 40, owner: 'กลุ่มงาน NCD',
      rule: 'B = ผู้ขึ้นทะเบียน CHRONIC รหัส E10–E14 วินิจฉัยก่อนสิ้นงวด และยังไม่จำหน่ายก่อนสิ้นงวด แยก HOSPCODE/PID; A = LABFU 0531601 ล่าสุดในไตรมาส มีค่า > 0 และ < 7 (%) ไม่มีผล/ผลผิดรูปแบบนับเป็นส่วนขาดข้อมูล',
      diagnosis: '^E1[0-4]', measurement: 'labfu', condition: "AND labtest = '0531601'",
      values: `${numeric('labresult')} AS a, NULL::numeric AS b`, passed: 'a > 0 AND a < 7',
      detail: "CASE WHEN a IS NULL OR a <= 0 THEN 'ไม่มี HbA1c ที่ใช้ได้ในงวด' ELSE 'HbA1c ' || a::text || '%' END" },
    { code: 'KPI-04', name: 'ร้อยละผู้ป่วยความดันโลหิตสูงควบคุมความดันได้ดี', target: 60, owner: 'กลุ่มงาน NCD',
      rule: 'B = ผู้ขึ้นทะเบียน CHRONIC รหัส I10–I15 วินิจฉัยก่อนสิ้นงวด และยังไม่จำหน่ายก่อนสิ้นงวด แยก HOSPCODE/PID; A = CHRONICFU ล่าสุดในไตรมาส มี SBP > 0 และ < 140 และ DBP > 0 และ < 90 mmHg ไม่มีผล/ผลผิดรูปแบบนับเป็นส่วนขาดข้อมูล',
      diagnosis: '^I1[0-5]', measurement: 'chronicfu', condition: '',
      values: `${numeric('sbp')} AS a, ${numeric('dbp')} AS b`, passed: 'a > 0 AND a < 140 AND b > 0 AND b < 90',
      detail: "CASE WHEN a IS NULL OR b IS NULL OR a <= 0 OR b <= 0 THEN 'ไม่มีความดันที่ใช้ได้ในงวด' ELSE 'BP ' || a::text || '/' || b::text || ' mmHg' END" },
    { code: 'KPI-05', name: 'ร้อยละการคัดกรองมะเร็งปากมดลูกในสตรี 30-60 ปี', target: 80, owner: 'กลุ่มงานควบคุมโรค',
      rule: 'ต้องกำหนดชุดรหัสคัดกรอง ระยะย้อนหลัง และประชากรเป้าหมาย/ข้อยกเว้น', unavailable: 'ยังไม่กำหนดนิยามการคัดกรองและระยะย้อนหลัง' },
    { code: 'KPI-06', name: 'อัตราการครองเตียงผู้ป่วยใน', target: 80, owner: 'กลุ่มงานบริการ',
      rule: 'วันนอน / จำนวนเตียงที่เปิดบริการและวันเปิดบริการ × 100', unavailable: 'ไม่มีแหล่งจำนวนเตียงที่เปิดบริการรายวัน' },
  ]
  return db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY')
    await tx.query(`SET LOCAL statement_timeout = '60s'`)
    const indicators: IndicatorResult[] = []
    for (const definition of definitions) {
      const base = { code: definition.code, name: definition.name, owner: definition.owner, target: definition.target,
        rule: definition.rule, numerator: 0, denominator: 0, value: null, gaps: [], gapCount: 0 }
      if (definition.unavailable) { indicators.push({ ...base, unavailable: definition.unavailable }); continue }
      const sql = definition.sql ?? `WITH registered AS (
        SELECT DISTINCT hospcode, pid FROM chronic
        WHERE hospcode <> '' AND pid <> '' AND upper(chronic) ~ '${definition.diagnosis}'
          AND ${validObservationDate('date_diag')} AND date_diag < $2
          AND (date_disch = '' OR (${validObservationDate('date_disch')} AND date_disch >= $2))
      ), latest AS (
        SELECT DISTINCT ON (hospcode, pid) hospcode, pid, ${definition.values}
        FROM ${definition.measurement} WHERE ${validObservationDate('date_serv')}
          AND date_serv >= $1 AND date_serv < $2 ${definition.condition}
        ORDER BY hospcode, pid, date_serv DESC
      ), cohort AS (
        SELECT r.hospcode, r.pid, COALESCE(${definition.passed}, false) AS passed, ${definition.detail} AS detail
        FROM registered r LEFT JOIN latest m ON m.hospcode = r.hospcode AND m.pid = r.pid
      )`
      const result = await tx.query<{ numerator: number; denominator: number; gaps: IndicatorGap[] }>(`${sql}
        SELECT (SELECT count(*)::int FROM cohort WHERE passed) AS numerator,
          (SELECT count(*)::int FROM cohort) AS denominator,
          COALESCE((SELECT json_agg(g) FROM (
            SELECT c.hospcode, c.pid, COALESCE(p.cid, '') AS cid,
              COALESCE(NULLIF(btrim(concat_ws(' ', p.name, p.lname)), ''), 'ไม่พบทะเบียน PERSON') AS fullname, c.detail
            FROM cohort c LEFT JOIN person p ON p.hospcode = c.hospcode AND p.pid = c.pid
            WHERE NOT c.passed ORDER BY c.hospcode, c.pid, c.detail LIMIT 500
          ) g), '[]'::json) AS gaps`, [start, end])
      const { numerator, denominator, gaps } = result.rows[0]
      indicators.push({ ...base, numerator, denominator, gaps, gapCount: denominator - numerator,
        value: denominator ? numerator * 100 / denominator : null })
    }
    return { period, start, end, processedAt: new Date().toISOString(), indicators }
  })
}
