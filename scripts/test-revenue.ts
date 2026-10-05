import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, getRevenueReport, startImportRun, insertStandardRows } from '../src/main/database.ts'

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'plkgap-revenue-test-'))
  let db
  try {
    db = await openDatabase(join(directory, 'db'))

    // 1. Empty database test: should return blank data (all fields null)
    const emptyReport = await getRevenueReport(db, '2569-08')
    assert.equal(emptyReport.hasRealData, false)
    assert.equal(emptyReport.totalClaimed, null)
    assert.equal(emptyReport.totalApproved, null)
    assert.equal(emptyReport.totalRejected, null)
    assert.equal(emptyReport.passRate, null)
    assert.equal(emptyReport.items.length, 6)
    for (const item of emptyReport.items) {
      assert.equal(item.claimed, null)
      assert.equal(item.approved, null)
      assert.equal(item.rejected, null)
      assert.equal(item.state, null)
    }
    console.log('PASS: Empty database returns hasRealData=false and blank (null) values')

    // 2. Insert sample 43-file charge rows
    const runId = await startImportRun(db, { name: 'test.zip', path: 'test.zip', size: 100 })

    // charge_opd:
    // - Row 1: สปสช. OP, date 2026-08-10, price 1000, payprice 900
    // - Row 2: ประกันสังคม, date 2026-08-11, price 500, payprice 500
    // - Row 3: PP (chargeitem 14), date 2026-08-12, price 300, payprice 250
    // - Row 4: ต่างเดือน (2026-07-10), price 2000, payprice 2000
    await insertStandardRows(
      db,
      runId,
      'charge_opd',
      ['HOSPCODE', 'PID', 'SEQ', 'DATE_SERV', 'CLINIC', 'CHARGEITEM', 'CHARGELIST', 'INSTYPE', 'PRICE', 'PAYPRICE'],
      [
        ['10001', 'P1', '1', '20260810', '01', '01', '01', '0100', '1000', '900'],
        ['10001', 'P2', '2', '20260811', '01', '01', '01', '4100', '500', '500'],
        ['10001', 'P3', '3', '20260812', '01', '14', '01', '0100', '300', '250'],
        ['10001', 'P4', '4', '20260710', '01', '01', '01', '0100', '2000', '2000'],
      ]
    )

    // charge_ipd:
    // - Row 1: สปสช. IP, date 2026-08-15, price 3000, payprice 2800
    await insertStandardRows(
      db,
      runId,
      'charge_ipd',
      ['HOSPCODE', 'PID', 'AN', 'DATETIME_ADMIT', 'WARDSTAY', 'CHARGEITEM', 'CHARGELIST', 'INSTYPE', 'PRICE', 'PAYPRICE'],
      [
        ['10001', 'P5', 'A1', '20260815120000', '01', '01', '01', '0100', '3000', '2800'],
      ]
    )

    // 3. Test report for 2569-08 (2026-08)
    const reportAug = await getRevenueReport(db, '2569-08')
    assert.equal(reportAug.hasRealData, true)
    assert.equal(reportAug.totalClaimed, 4800) // 1000 + 500 + 300 + 3000
    assert.equal(reportAug.totalApproved, 4450) // 900 + 500 + 250 + 2800
    assert.equal(reportAug.totalRejected, 350)
    assert.equal(reportAug.passRate, Math.round((4450 / 4800) * 100))

    const opItem = reportAug.items.find((i) => i.fund === 'ผู้ป่วยนอก (OP) สปสช.')
    assert.equal(opItem?.claimed, 1000)
    assert.equal(opItem?.approved, 900)
    assert.equal(opItem?.rejected, 100)
    assert.equal(opItem?.state, 'warning')

    const ipItem = reportAug.items.find((i) => i.fund === 'ผู้ป่วยใน (IP) สปสช.')
    assert.equal(ipItem?.claimed, 3000)
    assert.equal(ipItem?.approved, 2800)
    assert.equal(ipItem?.rejected, 200)

    const ppItem = reportAug.items.find((i) => i.fund === 'ส่งเสริมป้องกันโรค (PP)')
    assert.equal(ppItem?.claimed, 300)
    assert.equal(ppItem?.approved, 250)

    const sssItem = reportAug.items.find((i) => i.fund === 'ประกันสังคม')
    assert.equal(sssItem?.claimed, 500)
    assert.equal(sssItem?.approved, 500)
    assert.equal(sssItem?.rejected, 0)
    assert.equal(sssItem?.state, 'passed')

    // Funds with no data in this month should have null values (blank)
    const directPay = reportAug.items.find((i) => i.fund === 'กรมบัญชีกลาง (เบิกจ่ายตรง)')
    assert.equal(directPay?.claimed, null)
    assert.equal(directPay?.approved, null)
    assert.equal(directPay?.state, null)

    const cash = reportAug.items.find((i) => i.fund === 'ชำระเงินเอง')
    assert.equal(cash?.claimed, null)
    assert.equal(cash?.approved, null)

    console.log('PASS: Real data calculates correctly by fund and leaves empty funds blank')

    // 4. Test report for 2569-07 (2026-07)
    const reportJul = await getRevenueReport(db, '2569-07')
    assert.equal(reportJul.hasRealData, true)
    assert.equal(reportJul.totalClaimed, 2000)
    assert.equal(reportJul.totalApproved, 2000)
    assert.equal(reportJul.totalRejected, 0)
    assert.equal(reportJul.passRate, 100)
    console.log('PASS: Month filtering works correctly across different months')

  } finally {
    if (db && !db.closed) await db.close()
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
