import { createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { ObservationLevel, ObservationRule, ObservationRuleId, ObservationFinding, ObservationResult } from '../../shared/api'
import type { FailingRows } from '../../shared/api'
import { initializedVersion, recordInit } from './schema-state'
import { quote, CheckReporter, step, importedFromZip, validObservationDate, validObservationStamp } from './shared'
import { createAppTables } from './app-schema'

/**
 * Every observation rule the app can run. `level` is `error` when the rows cannot be true at once
 * and `warning` when they merely look wrong and a human should judge.
 * The register table `observ_check` is seeded from this list — see syncObservationRules().
 */
export function observationRules(): {
  id: ObservationRuleId; tableName: string; detail: string
  level: ObservationLevel; columns: string[]; sql: string
}[] {
  return [
    {
      id: 'service-after-death', tableName: 'service', level: 'error',
      detail: 'วันที่รับบริการหลังวันที่เสียชีวิตใน PERSON',
      columns: ['hospcode', 'pid', 'seq', 'date_serv', 'discharge', 'ddischarge'],
      sql: `SELECT s.hospcode, s.pid, s.seq, s.date_serv, p.discharge, p.ddischarge,
        (p.discharge = '1' AND ${validObservationDate('p.ddischarge')} AND ${validObservationDate('s.date_serv')}) AS eligible,
        (s.date_serv > p.ddischarge) AS failed
        FROM service s LEFT JOIN person p ON p.hospcode = s.hospcode AND p.pid = s.pid
        WHERE s.${importedFromZip}`,
    },
    {
      id: 'thai-cid-mod11', tableName: 'person', level: 'error',
      detail: 'เลขบัตรประชาชนคนไทยไม่ผ่าน MOD11 (ต้องเป็นตัวเลข 13 หลัก)',
      columns: ['hospcode', 'pid', 'cid', 'nation'],
      sql: `SELECT p.hospcode, p.pid, p.cid, p.nation, (p.nation = '099') AS eligible,
        CASE WHEN p.cid ~ '^[0-9]{13}$' THEN
          ((11 - (SELECT SUM(substring(p.cid, n, 1)::int * (14 - n)) FROM generate_series(1, 12) n) % 11) % 10)
            <> substring(p.cid, 13, 1)::int ELSE true END AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    {
      id: 'prename-sex', tableName: 'person', level: 'warning',
      detail: 'คำนำหน้าชื่อไม่สอดคล้องกับเพศ',
      columns: ['hospcode', 'pid', 'prename', 'prename_full', 'sex', 'expected_sex'],
      sql: `SELECT p.hospcode, p.pid, p.prename, r.description AS prename_full, p.sex, r.sex AS expected_sex,
        (p.sex IN ('1', '2') AND r.sex IN ('1', '2')) AS eligible,
        (p.sex <> r.sex) AS failed
        FROM person p LEFT JOIN c_person_prename r ON r.code = p.prename AND r.is_active = 1
        WHERE p.${importedFromZip}`,
    },
    {
      id: 'birth-in-future', tableName: 'person', level: 'error',
      detail: 'วันเกิดใน PERSON อยู่ในอนาคต',
      columns: ['hospcode', 'pid', 'birth', 'check_date'],
      sql: `SELECT p.hospcode, p.pid, p.birth,
        to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') AS check_date,
        ${validObservationDate('p.birth')} AS eligible,
        (p.birth > to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD')) AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    {
      id: 'service-before-birth', tableName: 'service', level: 'error',
      detail: 'วันที่รับบริการก่อนวันเกิดใน PERSON',
      columns: ['hospcode', 'pid', 'seq', 'date_serv', 'birth'],
      sql: `SELECT s.hospcode, s.pid, s.seq, s.date_serv, p.birth,
        (${validObservationDate('p.birth')} AND ${validObservationDate('s.date_serv')}) AS eligible,
        (s.date_serv < p.birth) AS failed
        FROM service s LEFT JOIN person p ON p.hospcode = s.hospcode AND p.pid = s.pid
        WHERE s.${importedFromZip}`,
    },
    {
      id: 'death-before-birth', tableName: 'person', level: 'error',
      detail: 'วันที่เสียชีวิตก่อนวันเกิดใน PERSON',
      columns: ['hospcode', 'pid', 'birth', 'discharge', 'ddischarge'],
      sql: `SELECT p.hospcode, p.pid, p.birth, p.discharge, p.ddischarge,
        (p.discharge = '1' AND ${validObservationDate('p.birth')} AND ${validObservationDate('p.ddischarge')}) AS eligible,
        (p.ddischarge < p.birth) AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    ...(['diagnosis_opd', 'drug_opd'] as const).map((tableName) => ({
      id: (tableName === 'diagnosis_opd' ? 'diagnosis-without-service' : 'drug-without-service') as ObservationRuleId,
      tableName,
      level: 'error' as ObservationLevel,
      detail: `${tableName.toUpperCase()} ไม่มี SERVICE ที่ตรงกัน (HOSPCODE, PID, SEQ, DATE_SERV)`,
      columns: ['hospcode', 'pid', 'seq', 'date_serv', tableName === 'diagnosis_opd' ? 'diagcode' : 'didstd'],
      sql: `SELECT r.hospcode, r.pid, r.seq, r.date_serv, r.${tableName === 'diagnosis_opd' ? 'diagcode' : 'didstd'},
        (btrim(r.hospcode) <> '' AND btrim(r.pid) <> '' AND btrim(r.seq) <> '' AND ${validObservationDate('r.date_serv')}) AS eligible,
        NOT EXISTS (SELECT 1 FROM service s WHERE s.hospcode = r.hospcode AND s.pid = r.pid
          AND s.seq = r.seq AND s.date_serv = r.date_serv) AS failed
        FROM ${tableName} r WHERE r.${importedFromZip}`,
    })),
    {
      id: 'service-without-person', tableName: 'service', level: 'error',
      detail: 'SERVICE ไม่มีตัวตนใน PERSON (HOSPCODE, PID)',
      columns: ['hospcode', 'pid', 'seq', 'date_serv'],
      sql: `SELECT s.hospcode, s.pid, s.seq, s.date_serv,
        (btrim(s.hospcode) <> '' AND btrim(s.pid) <> '') AS eligible,
        NOT EXISTS (SELECT 1 FROM person p WHERE p.hospcode = s.hospcode AND p.pid = s.pid) AS failed
        FROM service s WHERE s.${importedFromZip}`,
    },
    {
      id: 'person-without-home', tableName: 'person', level: 'error',
      detail: 'คนในเขตรับผิดชอบอ้าง HID ที่ไม่มีในแฟ้ม HOME',
      columns: ['hospcode', 'pid', 'hid', 'typearea'],
      // TYPEAREA 4 and 5 live outside the catchment area, so they are not expected to have a house.
      sql: `SELECT p.hospcode, p.pid, p.hid, p.typearea,
        (p.typearea IN ('1', '2', '3') AND btrim(p.hid) NOT IN ('', '0')) AS eligible,
        NOT EXISTS (SELECT 1 FROM home h WHERE h.hospcode = p.hospcode AND h.hid = p.hid) AS failed
        FROM person p WHERE p.${importedFromZip}`,
    },
    {
      id: 'duplicate-cid', tableName: 'person', level: 'error',
      detail: 'เลขบัตรประชาชนเดียวกันถูกใช้หลาย PID ในหน่วยบริการเดียวกัน',
      columns: ['hospcode', 'pid', 'cid', 'name', 'lname'],
      // Counted across every import of the same service unit, so a CID re-registered under a new
      // PID in a later zip is still one person; a different HOSPCODE is a different register and
      // never counts. Grouped once rather than tested per row, so a large PERSON stays a single scan.
      sql: `SELECT p.hospcode, p.pid, p.cid, p.name, p.lname,
        (p.cid ~ '^[0-9]{13}$') AS eligible,
        COALESCE(same_cid.pids, 0) > 1 AS failed
        FROM person p LEFT JOIN (
          SELECT hospcode, cid, COUNT(DISTINCT pid) AS pids FROM person
          WHERE cid ~ '^[0-9]{13}$' GROUP BY hospcode, cid) same_cid
          ON same_cid.hospcode = p.hospcode AND same_cid.cid = p.cid
        WHERE p.${importedFromZip}`,
    },
    {
      id: 'death-without-discharge', tableName: 'death', level: 'error',
      detail: 'มีในแฟ้ม DEATH แต่ PERSON ไม่ได้จำหน่าย "ตาย" หรือวันที่ไม่ตรงกัน',
      columns: ['hospcode', 'pid', 'ddeath', 'discharge', 'ddischarge'],
      sql: `SELECT d.hospcode, d.pid, d.ddeath, p.discharge, p.ddischarge,
        (${validObservationDate('d.ddeath')} AND p.pid IS NOT NULL) AS eligible,
        (p.discharge <> '1' OR p.ddischarge <> d.ddeath) AS failed
        FROM death d LEFT JOIN person p ON p.hospcode = d.hospcode AND p.pid = d.pid
        WHERE d.${importedFromZip}`,
    },
    {
      id: 'discharge-before-admit', tableName: 'admission', level: 'error',
      detail: 'วันจำหน่ายก่อนวันรับไว้นอนโรงพยาบาล',
      columns: ['hospcode', 'pid', 'an', 'datetime_admit', 'datetime_disch'],
      sql: `SELECT a.hospcode, a.pid, a.an, a.datetime_admit, a.datetime_disch,
        (${validObservationStamp('a.datetime_admit')} AND ${validObservationStamp('a.datetime_disch')}) AS eligible,
        (left(a.datetime_disch, 8) < left(a.datetime_admit, 8)) AS failed
        FROM admission a WHERE a.${importedFromZip}`,
    },
  ]
}

/**
 * Brings the `observ_check` register in line with the rules compiled into the app: new rules are
 * added, changed wording and order are refreshed, and a rule dropped from the code loses its row
 * because there is no SQL left to run for it. A rule the user switched off stays off.
 * Keyed on a digest of the catalogue, so a start that changes nothing writes nothing.
 */
export async function syncObservationRules(db: PGlite) {
  await createAppTables(db)
  const rules = observationRules()
  const version = 'observ@' + createHash('sha1')
    .update(JSON.stringify(rules.map((rule) => [rule.id, rule.tableName, rule.detail, rule.level])))
    .digest('hex').slice(0, 12)
  const done = await initializedVersion(db, 'observations')
  if (done?.version === version) return { ...done, applied: false }

  for (const [order, rule] of rules.entries()) {
    await db.query(`INSERT INTO observ_check (rule_id, table_name, detail, level, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (rule_id) DO UPDATE SET table_name = EXCLUDED.table_name,
        detail = EXCLUDED.detail, level = EXCLUDED.level, sort_order = EXCLUDED.sort_order`,
      [rule.id, rule.tableName, rule.detail, rule.level, order])
  }
  await db.query(`DELETE FROM observ_check WHERE rule_id NOT IN
    (${rules.map((_rule, index) => `$${index + 1}`).join(', ')})`, rules.map((rule) => rule.id))
  await recordInit(db, 'observations', version, 1, rules.length)
  return { version, table_count: 1, row_count: rules.length, applied: true }
}

/** The register as it stands, newest wording and switches included. */
export async function listObservationRules(db: PGlite): Promise<ObservationRule[]> {
  const { rows } = await db.query<ObservationRule>(`
    SELECT rule_id AS id, table_name AS "tableName", detail, level, is_active AS active
    FROM observ_check ORDER BY sort_order, rule_id`)
  return rows
}

/** Turns one registered rule on or off; the check run afterwards skips the ones that are off. */
export async function setObservationRuleActive(db: PGlite, ruleId: string, active: boolean) {
  await db.query('UPDATE observ_check SET is_active = $2 WHERE rule_id = $1', [ruleId, active])
}

/** Read-only checks scoped to imported rows; PERSON lookups may come from an earlier zip. */
export async function checkObservations(db: PGlite, zipName: string,
  report?: CheckReporter): Promise<ObservationResult> {
  await syncObservationRules(db)
  const compiled = new Map(observationRules().map((rule) => [rule.id, rule]))
  const findings: ObservationFinding[] = []
  // The register decides which rules run and in what order; the code decides what each one asks.
  const registry = await listObservationRules(db)
  const active = registry.filter((registered) => registered.active && compiled.has(registered.id))
  let done = 0
  for (const registered of registry) {
    const rule = compiled.get(registered.id)
    if (!rule || !registered.active) continue
    step(report, done++, active.length, registered.tableName.toUpperCase())
    const result = await db.query<{ checked: number; skipped: number; found: number }>(`
      WITH candidates AS (${rule.sql}) SELECT
        COUNT(*) FILTER (WHERE eligible)::int AS checked,
        COUNT(*) FILTER (WHERE eligible IS NOT TRUE)::int AS skipped,
        COUNT(*) FILTER (WHERE eligible AND failed)::int AS found FROM candidates`, [zipName])
    findings.push({ id: rule.id, tableName: registered.tableName, detail: registered.detail,
      level: registered.level, ...result.rows[0] })
  }
  step(report, active.length, active.length, 'สรุปผล')
  return { zipName, checkedAt: new Date().toISOString(), findings }
}

export async function observationRows(db: PGlite, zipName: string, ruleId: string): Promise<FailingRows> {
  const rule = observationRules().find((entry) => entry.id === ruleId)
  if (!rule) throw new Error('ไม่รู้จักเกณฑ์ข้อสังเกต')
  // The heading follows the register, so a reworded rule reads the same here as in the result list.
  const { rows: registered } = await db.query<{ detail: string }>(
    'SELECT detail FROM observ_check WHERE rule_id = $1', [ruleId])
  const detail = registered[0]?.detail ?? rule.detail
  const result = await db.query<Record<string, string | number>>(`WITH candidates AS (${rule.sql})
    SELECT ${rule.columns.map(quote).join(', ')}, COUNT(*) OVER()::int AS total
    FROM candidates WHERE eligible AND failed ORDER BY ${rule.columns.map(quote).join(', ')} LIMIT 100`, [zipName])
  return { tableName: rule.tableName, columnName: '', detail, columns: rule.columns,
    rows: result.rows.map((row) => rule.columns.map((column) => String(row[column] ?? ''))),
    total: Number(result.rows[0]?.total ?? 0) }
}
