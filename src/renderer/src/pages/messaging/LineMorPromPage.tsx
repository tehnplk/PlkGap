import { SortableTable } from '../../SortableTable'
import { useState } from 'react'
import { Icon } from '../../Icon'

interface Target { id: string; name: string; count: number; note: string }

const TARGETS: Target[] = [
  { id: 'dm-followup', name: 'ผู้ป่วยเบาหวานถึงนัดติดตาม', count: 214, note: 'นัดภายใน 7 วันข้างหน้า' },
  { id: 'ht-followup', name: 'ผู้ป่วยความดันโลหิตสูงถึงนัด', count: 186, note: 'นัดภายใน 7 วันข้างหน้า' },
  { id: 'anc', name: 'หญิงตั้งครรภ์ถึงกำหนดฝากครรภ์', count: 32, note: 'ตามเกณฑ์ ANC คุณภาพ' },
  { id: 'epi', name: 'เด็กถึงกำหนดรับวัคซีน', count: 78, note: 'อายุครบตามตารางวัคซีน' },
  { id: 'cxs', name: 'สตรีกลุ่มเป้าหมายคัดกรองมะเร็งปากมดลูก', count: 402, note: 'ยังไม่มีผลตรวจใน 5 ปี' },
]

interface LogRow { time: string; target: string; sent: number; failed: number; state: 'passed' | 'pending' | 'warning' }

const LOGS: LogRow[] = [
  { time: '08 ก.ย. 69 09:15', target: 'ผู้ป่วยเบาหวานถึงนัดติดตาม', sent: 208, failed: 6, state: 'passed' },
  { time: '07 ก.ย. 69 16:40', target: 'เด็กถึงกำหนดรับวัคซีน', sent: 74, failed: 4, state: 'passed' },
  { time: '07 ก.ย. 69 09:05', target: 'หญิงตั้งครรภ์ถึงกำหนดฝากครรภ์', sent: 28, failed: 4, state: 'warning' },
  { time: '06 ก.ย. 69 09:00', target: 'ผู้ป่วยความดันโลหิตสูงถึงนัด', sent: 0, failed: 0, state: 'pending' },
]
const stateLabel: Record<LogRow['state'], string> = { passed: 'ส่งสำเร็จ', pending: 'อยู่ในคิว', warning: 'มีรายการล้มเหลว' }

export function LineMorPromPage() {
  const [target, setTarget] = useState(TARGETS[0].id)
  const [message, setMessage] = useState('เรียนคุณ {ชื่อ} ท่านมีนัดตรวจที่ {หน่วยบริการ} วันที่ {วันนัด} เวลา {เวลานัด} กรุณานำบัตรประชาชนมาด้วยค่ะ')
  const selected = TARGETS.find((item) => item.id === target)!

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบสื่อสาร</p>
        <h2>ส่ง Line หมอพร้อม</h2>
      </div>
      <span className="badge">กลุ่มเป้าหมาย {selected.count.toLocaleString()} คน</span>
    </div>
    <p>เลือกกลุ่มเป้าหมายจากข้อมูล 43 แฟ้ม แล้วส่งข้อความแจ้งเตือนผ่าน Line หมอพร้อม พร้อมตัวแปรแทนค่ารายบุคคล</p>

    <div className="field-row">
      <label htmlFor="line-target">กลุ่มเป้าหมาย</label>
      <select id="line-target" className="mock-select" style={{ flex: 1, minWidth: 260 }} value={target} onChange={(event) => setTarget(event.target.value)}>
        {TARGETS.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.count.toLocaleString()} คน)</option>)}
      </select>
    </div>
    <p className="hint-text">{selected.note}</p>

    <p className="section-title">ข้อความ</p>
    <textarea className="mock-textarea" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} aria-label="ข้อความที่จะส่ง" />
    <p className="hint-text">ตัวแปรที่ใช้ได้: {'{ชื่อ}'} {'{หน่วยบริการ}'} {'{วันนัด}'} {'{เวลานัด}'} — ความยาว {message.length} อักขระ</p>

    <div className="toolbar-row">
      <button type="button" className="mock-button primary"><Icon name="send" size={15} />ส่งข้อความ</button>
      <button type="button" className="mock-button">ทดสอบส่งหาตัวเอง</button>
      <button type="button" className="mock-button">ตั้งเวลาส่ง</button>
    </div>

    <p className="section-title">ประวัติการส่ง</p>
    <div className="table-wrapper">
      <SortableTable className="data-table" aria-label="ประวัติการส่งข้อความ">
        <thead><tr><th>เวลา</th><th>กลุ่มเป้าหมาย</th><th className="col-right">ส่งสำเร็จ</th><th className="col-right">ล้มเหลว</th><th className="col-center">สถานะ</th></tr></thead>
        <tbody>
          {LOGS.map((log) => <tr key={log.time}>
            <td className="num-cell">{log.time}</td>
            <td className="name-cell"><strong>{log.target}</strong></td>
            <td className="col-right num-cell">{log.sent.toLocaleString()}</td>
            <td className="col-right num-cell">{log.failed.toLocaleString()}</td>
            <td className="col-center"><span className={`status-pill status-${log.state}`}>{stateLabel[log.state]}</span></td>
          </tr>)}
        </tbody>
      </SortableTable>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) การส่งจริงต้องเรียก API ผ่าน main process เพราะมี access token</p></div>
  </>
}
