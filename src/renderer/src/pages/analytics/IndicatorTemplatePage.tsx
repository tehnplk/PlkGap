import { SortableTable } from '../../SortableTable'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../Icon'

interface Indicator { code: string; name: string; unit: string; target: number; value: number; owner: string }

const INDICATORS: Indicator[] = [
  { code: 'KPI-01', name: 'ร้อยละหญิงตั้งครรภ์ฝากครรภ์ครั้งแรกก่อน 12 สัปดาห์', unit: '%', target: 75, value: 81.4, owner: 'กลุ่มงานส่งเสริมสุขภาพ' },
  { code: 'KPI-02', name: 'ร้อยละเด็ก 0-5 ปี มีพัฒนาการสมวัย', unit: '%', target: 85, value: 88.2, owner: 'กลุ่มงานส่งเสริมสุขภาพ' },
  { code: 'KPI-03', name: 'ร้อยละผู้ป่วยเบาหวานควบคุมระดับน้ำตาลได้ดี', unit: '%', target: 40, value: 33.7, owner: 'กลุ่มงาน NCD' },
  { code: 'KPI-04', name: 'ร้อยละผู้ป่วยความดันโลหิตสูงควบคุมความดันได้ดี', unit: '%', target: 60, value: 57.1, owner: 'กลุ่มงาน NCD' },
  { code: 'KPI-05', name: 'ร้อยละการคัดกรองมะเร็งปากมดลูกในสตรี 30-60 ปี', unit: '%', target: 80, value: 62.9, owner: 'กลุ่มงานควบคุมโรค' },
  { code: 'KPI-06', name: 'อัตราการครองเตียงผู้ป่วยใน', unit: '%', target: 80, value: 74.5, owner: 'กลุ่มงานบริการ' },
]

const MOCK_PEOPLE = INDICATORS.map((indicator, indicatorIndex) => Array.from({ length: 15 }, (_, index) => ({
  cid: `000${String(indicatorIndex + 1).padStart(2, '0')}${String(index + 1).padStart(8, '0')}`,
  fullname: `บุคคลตัวอย่าง ${String(index + 1).padStart(2, '0')}`,
  sex: indicator.code === 'KPI-01' || indicator.code === 'KPI-05' || index % 2 === 0 ? 'หญิง' : 'ชาย',
  age: indicator.code === 'KPI-02' ? index % 6
    : indicator.code === 'KPI-01' ? 20 + index
      : indicator.code === 'KPI-05' ? 30 + index * 2 : 40 + index * 2,
  passed: (index + indicatorIndex) % 3 !== 0,
})))

export function IndicatorTemplatePage() {
  const [period, setPeriod] = useState('2569-Q4')
  const [onlyBelow, setOnlyBelow] = useState(false)
  const [selected, setSelected] = useState<Indicator | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (selected) dialog.current?.showModal()
    else dialog.current?.close()
  }, [selected])
  const rows = INDICATORS.filter((item) => !onlyBelow || item.value < item.target)
  const passed = INDICATORS.filter((item) => item.value >= item.target).length

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบวิเคราะห์ข้อมูล</p>
        <h2>เทมเพลตตัวชี้วัด</h2>
      </div>
      <span className="badge">ผ่านเกณฑ์ {passed}/{INDICATORS.length}</span>
    </div>
    <p>เทมเพลตสำเร็จรูปสำหรับคำนวณตัวชี้วัดจากข้อมูล 43 แฟ้ม เลือกงวดแล้วสั่งประมวลผล หรือส่งออกเป็นไฟล์รายงาน</p>

    <div className="toolbar-row">
      <label htmlFor="kpi-period">งวดข้อมูล</label>
      <select id="kpi-period" className="mock-select" value={period} onChange={(event) => setPeriod(event.target.value)}>
        <option value="2569-Q1">ปีงบ 2569 ไตรมาส 1</option>
        <option value="2569-Q2">ปีงบ 2569 ไตรมาส 2</option>
        <option value="2569-Q3">ปีงบ 2569 ไตรมาส 3</option>
        <option value="2569-Q4">ปีงบ 2569 ไตรมาส 4</option>
      </select>
      <button type="button" className="mock-button primary"><Icon name="gauge" size={15} />ประมวลผลตัวชี้วัด</button>
      <button type="button" className="mock-button">ส่งออก Excel</button>
      <label className="mock-check" style={{ marginLeft: 'auto' }}>
        <input type="checkbox" checked={onlyBelow} onChange={(event) => setOnlyBelow(event.target.checked)} />
        แสดงเฉพาะที่ต่ำกว่าเป้า
      </label>
    </div>

    <div className="table-wrapper">
      <SortableTable className="data-table" aria-label="ตารางตัวชี้วัด">
        <thead><tr><th>รหัส</th><th>ชื่อตัวชี้วัด</th><th>ผู้รับผิดชอบ</th><th className="col-right">เป้าหมาย</th><th className="col-right">ผลงาน</th><th>ความคืบหน้า</th><th>ส่วนขาด</th></tr></thead>
        <tbody>
          {rows.map((item) => {
            const ratio = Math.min(100, Math.round((item.value / item.target) * 100))
            return <tr key={item.code}>
              <td className="code-cell"><code>{item.code}</code></td>
              <td className="name-cell"><strong>{item.name}</strong></td>
              <td>{item.owner}</td>
              <td className="col-right num-cell">{item.target}{item.unit}</td>
              <td className="col-right num-cell">{item.value.toFixed(1)}{item.unit}</td>
              <td style={{ minWidth: 140 }}>
                <div className="progress"><span className={item.value >= item.target ? '' : 'below'} style={{ width: `${ratio}%` }} /></div>
              </td>
              <td><button type="button" className="mock-button" onClick={() => setSelected(item)}>แสดงส่วนขาด</button></td>
            </tr>
          })}
        </tbody>
      </SortableTable>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) สูตรคำนวณจริงจะเก็บเป็นเทมเพลต SQL ต่อหนึ่งตัวชี้วัด</p></div>
    <dialog className="large-modal" ref={dialog} onClose={() => setSelected(null)} aria-label="แสดงส่วนขาด">
      {selected && <>
        <header>
          <div><strong>แสดงส่วนขาด — {selected.code} {selected.name}</strong><small>ข้อมูลตัวอย่าง (mockup) 15 คน</small></div>
          <button type="button" className="modal-close" aria-label="ปิด" onClick={() => setSelected(null)}><Icon name="close" size={16} /></button>
        </header>
        <div className="table-wrapper">
          <SortableTable key={selected.code} className="data-table" aria-label="รายชื่อส่วนขาด">
            <thead><tr><th>cid</th><th>fullname</th><th>sex</th><th>age</th><th>สถานะ</th></tr></thead>
            <tbody>{MOCK_PEOPLE[INDICATORS.indexOf(selected)].map((person) => <tr key={person.cid}>
              <td className="code-cell">{person.cid}</td><td>{person.fullname}</td><td>{person.sex}</td><td data-sort-value={person.age}>{person.age}</td>
              <td><span className={`badge${person.passed ? '' : ' error'}`}>{person.passed ? 'ผ่าน' : 'ไม่ผ่าน'}</span></td>
            </tr>)}</tbody>
          </SortableTable>
        </div>
      </>}
    </dialog>
  </>
}
