import { SortableTable } from '../../SortableTable'
import { useState } from 'react'
import { Icon } from '../../Icon'

interface RevenueRow { fund: string; claimed: number; approved: number; rejected: number; state: 'passed' | 'pending' | 'warning' }

const REVENUE: RevenueRow[] = [
  { fund: 'ผู้ป่วยนอก (OP) สปสช.', claimed: 2840500, approved: 2612300, rejected: 228200, state: 'passed' },
  { fund: 'ผู้ป่วยใน (IP) สปสช.', claimed: 5120000, approved: 4870000, rejected: 250000, state: 'passed' },
  { fund: 'ส่งเสริมป้องกันโรค (PP)', claimed: 1180400, approved: 990100, rejected: 190300, state: 'warning' },
  { fund: 'ประกันสังคม', claimed: 760000, approved: 742000, rejected: 18000, state: 'passed' },
  { fund: 'กรมบัญชีกลาง (เบิกจ่ายตรง)', claimed: 1435000, approved: 0, rejected: 0, state: 'pending' },
  { fund: 'ชำระเงินเอง', claimed: 312750, approved: 312750, rejected: 0, state: 'passed' },
]
const stateLabel: Record<RevenueRow['state'], string> = { passed: 'ผ่านการตรวจ', pending: 'รอผลตอบกลับ', warning: 'ติดปัญหา' }
const baht = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 0 })

export function RevenueTemplatePage() {
  const [month, setMonth] = useState('2569-08')
  const claimed = REVENUE.reduce((sum, row) => sum + row.claimed, 0)
  const approved = REVENUE.reduce((sum, row) => sum + row.approved, 0)
  const rejected = REVENUE.reduce((sum, row) => sum + row.rejected, 0)
  const rate = Math.round((approved / claimed) * 100)

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบวิเคราะห์ข้อมูล</p>
        <h2>เทมเพลตงานจัดเก็บรายได้</h2>
      </div>
      <span className="badge">อัตราผ่าน {rate}%</span>
    </div>
    <p>สรุปยอดเรียกเก็บ ยอดที่ได้รับอนุมัติ และยอดที่ถูกปฏิเสธ แยกตามกองทุน เพื่อติดตามรายได้ของหน่วยบริการ</p>

    <div className="toolbar-row">
      <label htmlFor="revenue-month">งวดเดือน</label>
      <select id="revenue-month" className="mock-select" value={month} onChange={(event) => setMonth(event.target.value)}>
        <option value="2569-06">มิถุนายน 2569</option>
        <option value="2569-07">กรกฎาคม 2569</option>
        <option value="2569-08">สิงหาคม 2569</option>
      </select>
      <button type="button" className="mock-button primary"><Icon name="money" size={15} />สร้างรายงาน</button>
      <button type="button" className="mock-button">ส่งออก Excel</button>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><small>ยอดเรียกเก็บ</small><strong>{baht(claimed)}</strong></div>
      <div className="stat-card"><small>ยอดอนุมัติ</small><strong>{baht(approved)}</strong></div>
      <div className="stat-card"><small>ยอดถูกปฏิเสธ</small><strong>{baht(rejected)}</strong></div>
      <div className="stat-card"><small>อัตราผ่าน</small><strong>{rate}%</strong><div className="progress"><span style={{ width: `${rate}%` }} /></div></div>
    </div>

    <div className="table-wrapper">
      <SortableTable className="data-table" aria-label="ตารางรายได้แยกตามกองทุน">
        <thead><tr><th>กองทุน</th><th className="col-right">เรียกเก็บ (บาท)</th><th className="col-right">อนุมัติ (บาท)</th><th className="col-right">ปฏิเสธ (บาท)</th><th className="col-center">สถานะ</th></tr></thead>
        <tbody>
          {REVENUE.map((row) => <tr key={row.fund}>
            <td className="name-cell"><strong>{row.fund}</strong></td>
            <td className="col-right num-cell">{baht(row.claimed)}</td>
            <td className="col-right num-cell">{baht(row.approved)}</td>
            <td className="col-right num-cell">{baht(row.rejected)}</td>
            <td className="col-center"><span className={`status-pill status-${row.state}`}>{stateLabel[row.state]}</span></td>
          </tr>)}
        </tbody>
      </SortableTable>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) ยอดจริงจะดึงจากไฟล์ตอบกลับ (REP) ของแต่ละกองทุน</p></div>
  </>
}
