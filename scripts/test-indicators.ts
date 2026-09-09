import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, processIndicators } from '../src/main/database'

async function main() {
  const directory = process.env.PLKGAP_INDICATOR_FIXTURE_DIR ?? await mkdtemp(join(tmpdir(), 'plkgap-indicators-'))
  const db = await openDatabase(join(directory, 'plkgap-pglite'))
  try {
    await assert.rejects(processIndicators(db, '2569-Q5'))
    const empty = await processIndicators(db, '2569-Q4')
    assert.ok(empty.indicators.every(item => item.value === null))
    await db.exec(`
      INSERT INTO person(hospcode,pid,cid,name,lname) VALUES
        ('11111','1','111','First','Patient'),('22222','1','222','Other','Facility'),('11111','2','333','Missing','Measurement');
      INSERT INTO anc(hospcode,pid,gravida,date_serv,ga) VALUES
        ('11111','1','1','20260701','10'),('11111','1','1','20260801','14'),
        ('22222','1','1','20260701','15'),('11111','2','1','20260703','bad'),
        ('11111','old','1','20260601','8'),('11111','old','1','20260705','12'),
        ('11111','invalid','1','20260230','10'),('11111','next','1','20261001','10');
      INSERT INTO chronic(hospcode,pid,date_diag,chronic,date_disch) VALUES
        ('11111','1','20200101','E119',''),('11111','1','20200201','E110',''),
        ('22222','1','20200101','E119',''),('11111','2','20200101','E119',''),
        ('11111','discharged','20200101','E119','20260601'),('11111','future','20261001','E119',''),
        ('11111','1','20200101','I10',''),('22222','1','20200101','I10',''),('11111','2','20200101','I10','');
      INSERT INTO labfu(hospcode,pid,date_serv,labtest,labresult) VALUES
        ('11111','1','20260701','0531601','9'),('11111','1','20260901','0531601','6.5'),
        ('22222','1','20260901','0531601','7'),('11111','2','20260901','0531601','bad'),
        ('11111','1','20261001','0531601','10');
      INSERT INTO chronicfu(hospcode,pid,date_serv,sbp,dbp) VALUES
        ('11111','1','20260701','150','95'),('11111','1','20260901','139','89'),
        ('22222','1','20260901','140','90'),('11111','2','20260901','0','0');
    `)
    const report = await processIndicators(db, '2569-Q4')
    assert.equal(report.start, '20260701'); assert.equal(report.end, '20261001')
    for (const index of [0, 2, 3]) {
      const item = report.indicators[index]
      assert.equal(item.denominator, 3, item.code)
      assert.equal(item.numerator, 1, item.code)
      assert.equal(item.gapCount, 2)
      assert.equal(item.gaps.length, 2)
      assert.ok(item.gaps.some(gap => gap.fullname === 'Other Facility'))
      assert.ok(item.gaps.every(gap => gap.fullname !== 'First Patient'))
    }
    const q1 = await processIndicators(db, '2569-Q1')
    assert.equal(q1.start, '20251001'); assert.equal(q1.end, '20260101')
    assert.equal(q1.indicators[2].numerator, 0)
    assert.equal(q1.indicators[2].denominator, 4)
    assert.ok(report.indicators[1].unavailable && report.indicators[4].unavailable && report.indicators[5].unavailable)
    await db.exec(`INSERT INTO chronic(hospcode,pid,date_diag,chronic)
      SELECT '33333', 'cap-' || n::text, '20200101', 'E119' FROM generate_series(1, 505) n`)
    const capped = (await processIndicators(db, '2569-Q4')).indicators[2]
    assert.equal(capped.denominator, 508); assert.equal(capped.gaps.length, 500); assert.equal(capped.gapCount, 507)
    await db.exec("DELETE FROM chronic WHERE hospcode = '33333'")
    console.log('PASS: empty data, quarter boundaries, first pregnancy visit, latest measurements, invalid values, facility isolation, deduplicated cohorts, gaps and cap')
  } finally {
    await db.close()
    if (!process.env.PLKGAP_INDICATOR_FIXTURE_DIR) await rm(directory, { recursive: true, force: true })
  }
}
void main()
