import { useState } from 'react'
import { Icon } from '../../Icon'

interface FileRow { name: string; label: string; records: number; state: 'imported' | 'pending' | 'skipped' }

const FILES: FileRow[] = [
  { name: 'PERSON', label: 'ข้อมูลบุคคล', records: 48213, state: 'imported' },
  { name: 'HOME', label: 'ข้อมูลครัวเรือน', records: 15980, state: 'imported' },
  { name: 'SERVICE', label: 'การรับบริการ', records: 132044, state: 'imported' },
  { name: 'DIAGNOSIS_OPD', label: 'การวินิจฉัยผู้ป่วยนอก', records: 158720, state: 'imported' },
  { name: 'DRUG_OPD', label: 'การจ่ายยาผู้ป่วยนอก', records: 201355, state: 'pending' },
  { name: 'CHRONIC', label: 'ผู้ป่วยโรคเรื้อรัง', records: 6421, state: 'pending' },
  { name: 'EPI', label: 'การให้วัคซีน', records: 9310, state: 'skipped' },
  { name: 'LABFU', label: 'ผลตรวจทางห้องปฏิบัติการ', records: 27600, state: 'pending' },
]
const stateLabel: Record<FileRow['state'], string> = { imported: 'นำเข้าแล้ว', pending: 'รอนำเข้า', skipped: 'ข้าม' }
const stateStyle: Record<FileRow['state'], string> = { imported: 'passed', pending: 'pending', skipped: 'warning' }

export function ImportPage() {
  const [source, setSource] = useState('D:\\43files\\2569-09-08')
  const [format, setFormat] = useState('csv')
  const imported = FILES.filter((file) => file.state === 'imported')
  const percent = Math.round((imported.length / FILES.length) * 100)
  const total = imported.reduce((sum, file) => sum + file.records, 0)

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบ 43 แฟ้ม</p>
        <h2>นำเข้าข้อมูล</h2>
      </div>
      <span className="badge">{imported.length}/{FILES.length} แฟ้ม</span>
    </div>
    <p>เลือกโฟลเดอร์ที่เก็บชุดแฟ้มมาตรฐาน 43 แฟ้ม แล้วสั่งนำเข้าสู่ฐานข้อมูลภายในเครื่อง</p>

    <div className="field-row">
      <label htmlFor="import-source">ที่อยู่ไฟล์</label>
      <input id="import-source" className="mock-input" style={{ flex: 1, minWidth: 220 }} value={source} onChange={(event) => setSource(event.target.value)} />
      <label htmlFor="import-format">รูปแบบ</label>
      <select id="import-format" className="mock-select" value={format} onChange={(event) => setFormat(event.target.value)}>
        <option value="csv">CSV (คั่นด้วย ,)</option>
        <option value="txt">TXT (คั่นด้วย |)</option>
        <option value="zip">ZIP</option>
      </select>
    </div>
    <div className="toolbar-row">
      <button type="button" className="mock-button primary"><Icon name="upload" size={15} />เริ่มนำเข้า</button>
      <button type="button" className="mock-button">เลือกโฟลเดอร์</button>
      <button type="button" className="mock-button">ล้างข้อมูลเดิม</button>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><small>ความคืบหน้า</small><strong>{percent}%</strong><div className="progress"><span style={{ width: `${percent}%` }} /></div></div>
      <div className="stat-card"><small>เรคคอร์ดที่นำเข้าแล้ว</small><strong>{total.toLocaleString()}</strong></div>
      <div className="stat-card"><small>รอบนำเข้าล่าสุด</small><strong>08 ก.ย. 69</strong></div>
    </div>

    <p className="section-title">รายการแฟ้ม</p>
    <div className="table-wrapper">
      <table className="data-table" aria-label="รายการแฟ้มที่นำเข้า">
        <thead><tr><th>แฟ้ม</th><th>คำอธิบาย</th><th className="col-right">จำนวนเรคคอร์ด</th><th className="col-center">สถานะ</th></tr></thead>
        <tbody>
          {FILES.map((file) => <tr key={file.name}>
            <td className="code-cell"><code>{file.name}</code></td>
            <td>{file.label}</td>
            <td className="col-right num-cell">{file.records.toLocaleString()}</td>
            <td className="col-center"><span className={`status-pill status-${stateStyle[file.state]}`}>{stateLabel[file.state]}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) ยังไม่ได้ต่อกับฐานข้อมูลจริง</p></div>
  </>
}
