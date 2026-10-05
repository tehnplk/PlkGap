import { useCallback, useEffect, useState } from 'react'
import { SortableTable } from '../../SortableTable'
import { Icon } from '../../Icon'
import type { RevenueItem, RevenueReport } from '../../../../shared/api'

const stateLabel: Record<NonNullable<RevenueItem['state']>, string> = {
  passed: 'ผ่านการตรวจ',
  pending: 'รอผลตอบกลับ',
  warning: 'ติดปัญหา',
}

const baht = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 0 })

function thaiMonthName(ym: string): string {
  const [y, m] = ym.split('-')
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ]
  const idx = parseInt(m, 10) - 1
  if (idx >= 0 && idx < 12) {
    return `${monthNames[idx]} ${y}`
  }
  return ym
}

export function RevenueTemplatePage() {
  const now = new Date()
  const defaultYear = now.getFullYear() + 543
  const defaultMonth = String(now.getMonth() + 1).padStart(2, '0')
  const defaultPeriod = `${defaultYear}-${defaultMonth}`

  const [month, setMonth] = useState(defaultPeriod)
  const [report, setReport] = useState<RevenueReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async (selectedMonth: string) => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.getRevenueReport(selectedMonth)
      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(month)
  }, [month, loadData])

  const availableMonths =
    report?.availableMonths && report.availableMonths.length > 0
      ? report.availableMonths
      : ['2569-08', '2569-07', '2569-06']

  const items = report?.items ?? []
  const hasData = Boolean(report?.hasRealData && report?.totalClaimed !== null)
  const claimed = report?.totalClaimed
  const approved = report?.totalApproved
  const rejected = report?.totalRejected
  const rate = report?.passRate

  async function exportExcel() {
    if (!report || !hasData) return
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(
          items.map((row) => ({
            'งวดเดือน': report.month,
            'กองทุน': row.fund,
            'เรียกเก็บ (บาท)': row.claimed ?? '',
            'อนุมัติ (บาท)': row.approved ?? '',
            'ปฏิเสธ (บาท)': row.rejected ?? '',
            'สถานะ': row.state ? stateLabel[row.state] : '',
          }))
        ),
        'จัดเก็บรายได้'
      )
      const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
      await window.api.saveIndicatorWorkbook(`Revenue-${report.month}`, bytes)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <>
      <div className="content-heading">
        <div>
          <p className="eyebrow">ระบบวิเคราะห์ข้อมูล</p>
          <h2>เทมเพลตงานจัดเก็บรายได้</h2>
        </div>
        {hasData && rate !== null ? (
          <span className="badge">อัตราผ่าน {rate}%</span>
        ) : (
          <span className="badge">ไม่มีข้อมูล</span>
        )}
      </div>
      <p>
        สรุปยอดเรียกเก็บ ยอดที่ได้รับอนุมัติ และยอดที่ถูกปฏิเสธ แยกตามกองทุน จากข้อมูลแฟ้มการเงินที่นำเข้า
        (แฟ้ม charge_opd, charge_ipd)
      </p>

      <div className="toolbar-row">
        <label htmlFor="revenue-month">งวดเดือน</label>
        <select
          id="revenue-month"
          className="mock-select"
          value={month}
          disabled={loading}
          onChange={(event) => setMonth(event.target.value)}
        >
          {availableMonths.map((m) => (
            <option key={m} value={m}>
              {thaiMonthName(m)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="mock-button primary"
          disabled={loading}
          onClick={() => void loadData(month)}
        >
          <Icon name="money" size={15} />
          {loading ? 'กำลังโหลด…' : 'สร้างรายงาน'}
        </button>
        <button
          type="button"
          className="mock-button"
          disabled={!hasData || loading}
          onClick={() => void exportExcel()}
        >
          ส่งออก Excel
        </button>
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--theme-error, #d32f2f)', margin: '8px 0' }}>
          {error}
        </p>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <small>ยอดเรียกเก็บ</small>
          <strong>{claimed !== null && claimed !== undefined ? baht(claimed) : ''}</strong>
        </div>
        <div className="stat-card">
          <small>ยอดอนุมัติ</small>
          <strong>{approved !== null && approved !== undefined ? baht(approved) : ''}</strong>
        </div>
        <div className="stat-card">
          <small>ยอดถูกปฏิเสธ</small>
          <strong>{rejected !== null && rejected !== undefined ? baht(rejected) : ''}</strong>
        </div>
        <div className="stat-card">
          <small>อัตราผ่าน</small>
          <strong>{rate !== null && rate !== undefined ? `${rate}%` : ''}</strong>
          <div className="progress">
            <span style={{ width: `${rate ?? 0}%` }} />
          </div>
        </div>
      </div>

      <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ตารางรายได้แยกตามกองทุน">
          <thead>
            <tr>
              <th>กองทุน</th>
              <th className="col-right">เรียกเก็บ (บาท)</th>
              <th className="col-right">อนุมัติ (บาท)</th>
              <th className="col-right">ปฏิเสธ (บาท)</th>
              <th className="col-center">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.fund}>
                <td className="name-cell">
                  <strong>{row.fund}</strong>
                </td>
                <td className="col-right num-cell" data-sort-value={row.claimed ?? ''}>
                  {row.claimed !== null ? baht(row.claimed) : ''}
                </td>
                <td className="col-right num-cell" data-sort-value={row.approved ?? ''}>
                  {row.approved !== null ? baht(row.approved) : ''}
                </td>
                <td className="col-right num-cell" data-sort-value={row.rejected ?? ''}>
                  {row.rejected !== null ? baht(row.rejected) : ''}
                </td>
                <td className="col-center">
                  {row.state ? (
                    <span className={`status-pill status-${row.state}`}>{stateLabel[row.state]}</span>
                  ) : (
                    ''
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </SortableTable>
      </div>
    </>
  )
}
