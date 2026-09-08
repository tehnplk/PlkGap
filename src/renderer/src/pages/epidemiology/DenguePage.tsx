import { useState } from 'react'
import { Icon } from '../../Icon'

interface Village { code: string; name: string; cases: number; population: number; lastOnset: string; state: 'error' | 'warning' | 'passed' }

const WEEKS = [3, 5, 4, 8, 11, 9, 14, 18, 22, 17, 12, 7]
const VILLAGES: Village[] = [
  { code: 'M01', name: 'หมู่ 1 บ้านคลองเตย', cases: 12, population: 1420, lastOnset: '05 ก.ย. 69', state: 'error' },
  { code: 'M02', name: 'หมู่ 2 บ้านท่าทอง', cases: 7, population: 1180, lastOnset: '02 ก.ย. 69', state: 'warning' },
  { code: 'M03', name: 'หมู่ 3 บ้านหัวรอ', cases: 4, population: 980, lastOnset: '28 ส.ค. 69', state: 'warning' },
  { code: 'M04', name: 'หมู่ 4 บ้านวัดจันทร์', cases: 1, population: 1310, lastOnset: '19 ส.ค. 69', state: 'passed' },
  { code: 'M05', name: 'หมู่ 5 บ้านบึงพระ', cases: 0, population: 1520, lastOnset: '-', state: 'passed' },
]
const stateLabel: Record<Village['state'], string> = { error: 'ระบาดต่อเนื่อง', warning: 'เฝ้าระวัง', passed: 'ปกติ' }

export function DenguePage() {
  const [year, setYear] = useState('2569')
  const cases = VILLAGES.reduce((sum, village) => sum + village.cases, 0)
  const population = VILLAGES.reduce((sum, village) => sum + village.population, 0)
  const rate = ((cases / population) * 100000).toFixed(1)
  const peak = Math.max(...WEEKS)

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">งานระบาดวิทยาควบคุมโรค</p>
        <h2>ไข้เลือดออก</h2>
      </div>
      <span className="badge error">{cases} ราย สะสมปีนี้</span>
    </div>
    <p>เฝ้าระวังผู้ป่วยไข้เลือดออก (รหัส A90-A91) รายสัปดาห์ พร้อมสถานะการควบคุมโรครายหมู่บ้าน</p>

    <div className="toolbar-row">
      <label htmlFor="dengue-year">ปีที่รายงาน</label>
      <select id="dengue-year" className="mock-select" value={year} onChange={(event) => setYear(event.target.value)}>
        <option value="2567">2567</option>
        <option value="2568">2568</option>
        <option value="2569">2569</option>
      </select>
      <button type="button" className="mock-button primary"><Icon name="virus" size={15} />สอบสวนโรครายใหม่</button>
      <button type="button" className="mock-button">ส่งออกรายงาน 506</button>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><small>ผู้ป่วยสะสม</small><strong>{cases}</strong></div>
      <div className="stat-card"><small>อัตราป่วยต่อแสนประชากร</small><strong>{rate}</strong></div>
      <div className="stat-card"><small>หมู่บ้านที่มีผู้ป่วย</small><strong>{VILLAGES.filter((village) => village.cases > 0).length}/{VILLAGES.length}</strong></div>
      <div className="stat-card"><small>ค่ามัธยฐาน 5 ปี</small><strong>19</strong></div>
    </div>

    <p className="section-title">ผู้ป่วยรายสัปดาห์ (12 สัปดาห์ล่าสุด)</p>
    <div className="bar-chart" role="img" aria-label={`กราฟผู้ป่วยรายสัปดาห์ สูงสุด ${peak} ราย`}>
      {WEEKS.map((value, index) => <span key={index} className="bar" style={{ height: `${(value / peak) * 100}%` }} title={`สัปดาห์ที่ ${index + 1}: ${value} ราย`}><b>{value}</b></span>)}
    </div>

    <div className="table-wrapper">
      <table className="data-table" aria-label="ตารางผู้ป่วยไข้เลือดออกรายหมู่บ้าน">
        <thead><tr><th>รหัส</th><th>หมู่บ้าน</th><th className="col-right">ผู้ป่วย</th><th className="col-right">ประชากร</th><th>วันเริ่มป่วยล่าสุด</th><th className="col-center">สถานะ</th></tr></thead>
        <tbody>
          {VILLAGES.map((village) => <tr key={village.code}>
            <td className="code-cell"><code>{village.code}</code></td>
            <td className="name-cell"><strong>{village.name}</strong></td>
            <td className="col-right num-cell">{village.cases}</td>
            <td className="col-right num-cell">{village.population.toLocaleString()}</td>
            <td className="num-cell">{village.lastOnset}</td>
            <td className="col-center"><span className={`status-pill status-${village.state}`}>{stateLabel[village.state]}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) ของจริงจะดึงจากแฟ้ม DIAGNOSIS_OPD/IPD และรายงาน 506</p></div>
  </>
}
