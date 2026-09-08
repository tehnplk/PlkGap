import { useState } from 'react'
import { Icon } from '../../Icon'

interface Issue { id: number; file: string; column: string; rule: string; found: number; level: 'error' | 'warning' | 'passed' }

const ISSUES: Issue[] = [
  { id: 1, file: 'PERSON', column: 'CID', rule: 'ต้องเป็นตัวเลข 13 หลัก', found: 42, level: 'error' },
  { id: 2, file: 'PERSON', column: 'BIRTH', rule: 'รูปแบบวันที่ YYYYMMDD', found: 8, level: 'error' },
  { id: 3, file: 'HOME', column: 'HID', rule: 'ห้ามเป็นค่าว่าง', found: 3, level: 'error' },
  { id: 4, file: 'SERVICE', column: 'SEQ', rule: 'ต้องไม่ซ้ำภายในแฟ้ม', found: 17, level: 'warning' },
  { id: 5, file: 'DIAGNOSIS_OPD', column: 'DIAGCODE', rule: 'ความยาวไม่เกิน 6 อักขระ', found: 0, level: 'passed' },
  { id: 6, file: 'DRUG_OPD', column: 'DIDSTD', rule: 'ต้องอยู่ในรหัสยามาตรฐาน 24 หลัก', found: 129, level: 'warning' },
  { id: 7, file: 'CHRONIC', column: 'DATE_DIAG', rule: 'ต้องไม่เป็นวันที่ในอนาคต', found: 0, level: 'passed' },
]
const levelLabel: Record<Issue['level'], string> = { error: 'ไม่ผ่าน', warning: 'ควรแก้ไข', passed: 'ผ่าน' }

export function StructureCheckPage() {
  const [level, setLevel] = useState<'all' | Issue['level']>('all')
  const rows = ISSUES.filter((issue) => level === 'all' || issue.level === level)
  const errors = ISSUES.filter((issue) => issue.level === 'error').length
  const warnings = ISSUES.filter((issue) => issue.level === 'warning').length

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบ 43 แฟ้ม</p>
        <h2>ตรวจตามโครงสร้าง</h2>
      </div>
      <span className={`badge ${errors ? 'error' : ''}`}>{errors ? `ไม่ผ่าน ${errors} รายการ` : 'ผ่านทั้งหมด'}</span>
    </div>
    <p>ตรวจชนิดข้อมูล ความยาว รูปแบบวันที่ และคีย์ซ้ำ ตามโครงสร้างมาตรฐานของแต่ละแฟ้ม</p>

    <div className="toolbar-row">
      <button type="button" className="mock-button primary"><Icon name="structure" size={15} />ตรวจสอบใหม่</button>
      <button type="button" className="mock-button">ส่งออกผลตรวจ (CSV)</button>
      <label htmlFor="structure-level" style={{ marginLeft: 'auto' }}>กรองระดับ</label>
      <select id="structure-level" className="mock-select" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
        <option value="all">ทั้งหมด</option>
        <option value="error">ไม่ผ่าน</option>
        <option value="warning">ควรแก้ไข</option>
        <option value="passed">ผ่าน</option>
      </select>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><small>กฎที่ตรวจ</small><strong>{ISSUES.length}</strong></div>
      <div className="stat-card"><small>ไม่ผ่าน</small><strong>{errors}</strong></div>
      <div className="stat-card"><small>ควรแก้ไข</small><strong>{warnings}</strong></div>
      <div className="stat-card"><small>ตรวจเมื่อ</small><strong>08 ก.ย. 69</strong></div>
    </div>

    <div className="table-wrapper">
      <table className="data-table" aria-label="ผลตรวจตามโครงสร้าง">
        <thead><tr><th className="col-right">#</th><th>แฟ้ม</th><th>ฟิลด์</th><th>กฎที่ใช้ตรวจ</th><th className="col-right">พบ (เรคคอร์ด)</th><th className="col-center">ผล</th></tr></thead>
        <tbody>
          {rows.map((issue) => <tr key={issue.id}>
            <td className="col-right num-cell">{issue.id}</td>
            <td className="code-cell"><code>{issue.file}</code></td>
            <td className="name-cell"><strong>{issue.column}</strong></td>
            <td>{issue.rule}</td>
            <td className="col-right num-cell">{issue.found.toLocaleString()}</td>
            <td className="col-center"><span className={`status-pill status-${issue.level}`}>{levelLabel[issue.level]}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) กฎการตรวจจริงจะอ่านจากพจนานุกรมข้อมูล 43 แฟ้ม</p></div>
  </>
}
