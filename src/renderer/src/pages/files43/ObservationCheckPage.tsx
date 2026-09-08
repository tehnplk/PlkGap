import { SortableTable } from '../../SortableTable'
import { useState } from 'react'
import { Icon } from '../../Icon'

interface Rule { id: string; topic: string; detail: string; affected: number; level: 'error' | 'warning' | 'passed' }

const RULES: Rule[] = [
  { id: 'ACD-01', topic: 'เบาหวาน', detail: 'ผู้ป่วย DM ไม่มีผล HbA1c ในรอบ 12 เดือน', affected: 318, level: 'error' },
  { id: 'ACD-02', topic: 'ความดันโลหิตสูง', detail: 'ผู้ป่วย HT ไม่มีค่าความดันในแฟ้ม NCDSCREEN', affected: 254, level: 'error' },
  { id: 'ACD-03', topic: 'วัคซีน', detail: 'เด็กอายุครบ 1 ปี ได้รับวัคซีนไม่ครบตามเกณฑ์', affected: 46, level: 'warning' },
  { id: 'ACD-04', topic: 'ฝากครรภ์', detail: 'หญิงตั้งครรภ์ฝากครรภ์ครั้งแรกหลังอายุครรภ์ 12 สัปดาห์', affected: 29, level: 'warning' },
  { id: 'ACD-05', topic: 'การวินิจฉัย', detail: 'รหัสวินิจฉัยหลักเป็นรหัสกลุ่มอาการ (R00-R99)', affected: 92, level: 'warning' },
  { id: 'ACD-06', topic: 'การส่งต่อ', detail: 'มีการส่งต่อแต่ไม่มีผลการรักษาปลายทาง', affected: 0, level: 'passed' },
  { id: 'ACD-07', topic: 'คัดกรองมะเร็ง', detail: 'สตรี 30-60 ปี ไม่มีผลคัดกรองมะเร็งปากมดลูกใน 5 ปี', affected: 611, level: 'error' },
]
const levelLabel: Record<Rule['level'], string> = { error: 'ต้องแก้ไข', warning: 'เฝ้าระวัง', passed: 'ผ่าน' }

export function StandardCheckPage() {
  const [topic, setTopic] = useState('all')
  const topics = ['all', ...new Set(RULES.map((rule) => rule.topic))]
  const rows = RULES.filter((rule) => topic === 'all' || rule.topic === topic)
  const affected = RULES.reduce((sum, rule) => sum + rule.affected, 0)
  const passed = RULES.filter((rule) => rule.level === 'passed').length

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบ 43 แฟ้ม</p>
        <h2>ตรวจตามหลักวิชาการ</h2>
      </div>
      <span className={`badge ${affected ? 'error' : ''}`}>{affected.toLocaleString()} เคสที่ต้องทบทวน</span>
    </div>
    <p>ตรวจความสมเหตุสมผลทางคลินิกและความครบถ้วนของบริการ ตามแนวทางเวชปฏิบัติ ไม่ใช่แค่รูปแบบข้อมูล</p>

    <div className="toolbar-row">
      <button type="button" className="mock-button primary"><Icon name="book" size={15} />ประมวลผลใหม่</button>
      <button type="button" className="mock-button">ดูรายชื่อรายบุคคล</button>
      <label htmlFor="standard-topic" style={{ marginLeft: 'auto' }}>หัวข้อ</label>
      <select id="standard-topic" className="mock-select" value={topic} onChange={(event) => setTopic(event.target.value)}>
        {topics.map((name) => <option key={name} value={name}>{name === 'all' ? 'ทั้งหมด' : name}</option>)}
      </select>
    </div>

    <div className="stat-grid">
      <div className="stat-card"><small>เกณฑ์ที่ตรวจ</small><strong>{RULES.length}</strong></div>
      <div className="stat-card"><small>ผ่านเกณฑ์</small><strong>{passed}</strong></div>
      <div className="stat-card"><small>เคสที่ต้องทบทวน</small><strong>{affected.toLocaleString()}</strong></div>
      <div className="stat-card"><small>ปีงบประมาณ</small><strong>2569</strong></div>
    </div>

    <div className="table-wrapper">
      <SortableTable className="data-table" aria-label="ผลตรวจตามหลักวิชาการ">
        <thead><tr><th>รหัสเกณฑ์</th><th>หัวข้อ</th><th>เงื่อนไข</th><th className="col-right">จำนวนเคส</th><th className="col-center">ผล</th></tr></thead>
        <tbody>
          {rows.map((rule) => <tr key={rule.id}>
            <td className="code-cell"><code>{rule.id}</code></td>
            <td className="name-cell"><strong>{rule.topic}</strong></td>
            <td>{rule.detail}</td>
            <td className="col-right num-cell">{rule.affected.toLocaleString()}</td>
            <td className="col-center"><span className={`status-pill status-${rule.level}`}>{levelLabel[rule.level]}</span></td>
          </tr>)}
        </tbody>
      </SortableTable>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) เกณฑ์จริงอ้างอิงแนวทางของกรมวิชาการและ สปสช.</p></div>
  </>
}
