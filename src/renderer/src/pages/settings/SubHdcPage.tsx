import { SortableTable } from '../../SortableTable'
import { useState } from 'react'
import { Icon } from '../../Icon'

interface SyncRow { time: string; job: string; records: number; state: 'passed' | 'pending' | 'warning' }

const HISTORY: SyncRow[] = [
  { time: '08 ก.ย. 69 02:00', job: 'ส่งข้อมูล 43 แฟ้มรายวัน', records: 18420, state: 'passed' },
  { time: '07 ก.ย. 69 02:00', job: 'ส่งข้อมูล 43 แฟ้มรายวัน', records: 17985, state: 'passed' },
  { time: '06 ก.ย. 69 02:00', job: 'ส่งข้อมูล 43 แฟ้มรายวัน', records: 4210, state: 'warning' },
  { time: '05 ก.ย. 69 02:00', job: 'ส่งข้อมูล 43 แฟ้มรายวัน', records: 19102, state: 'passed' },
]
const stateLabel: Record<SyncRow['state'], string> = { passed: 'สำเร็จ', pending: 'กำลังส่ง', warning: 'ส่งไม่ครบ' }

export function SubHdcPage() {
  const [config, setConfig] = useState({ url: 'https://subhdc.example.go.th/api', user: 'plk10726', token: '••••••••••••', schedule: 'daily' })
  function set(key: keyof typeof config, value: string) { setConfig((current) => ({ ...current, [key]: value })) }

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ตั้งค่า</p>
        <h2>ตั้งค่าเชื่อมต่อระบบอำเภอ (SUB-HDC)</h2>
      </div>
      <span className="badge">เชื่อมต่อแล้ว</span>
    </div>
    <p>ตั้งค่าปลายทางและตารางเวลาส่งข้อมูล 43 แฟ้มขึ้นระบบ SUB-HDC ระดับอำเภอ</p>

    <div className="form-grid">
      <label htmlFor="subhdc-url">ที่อยู่เซิร์ฟเวอร์ (Endpoint)</label>
      <input id="subhdc-url" className="mock-input" value={config.url} onChange={(event) => set('url', event.target.value)} />
      <label htmlFor="subhdc-user">ชื่อผู้ใช้</label>
      <input id="subhdc-user" className="mock-input" value={config.user} onChange={(event) => set('user', event.target.value)} />
      <label htmlFor="subhdc-token">Access token</label>
      <input id="subhdc-token" className="mock-input" type="password" value={config.token} onChange={(event) => set('token', event.target.value)} />
      <label htmlFor="subhdc-schedule">ตารางเวลาส่ง</label>
      <select id="subhdc-schedule" className="mock-select" value={config.schedule} onChange={(event) => set('schedule', event.target.value)}>
        <option value="manual">ส่งเมื่อสั่งเท่านั้น</option>
        <option value="daily">ทุกวัน เวลา 02:00 น.</option>
        <option value="weekly">ทุกสัปดาห์ (วันจันทร์)</option>
      </select>
    </div>

    <div className="toolbar-row">
      <button type="button" className="mock-button primary"><Icon name="link" size={15} />ทดสอบการเชื่อมต่อ</button>
      <button type="button" className="mock-button">ส่งข้อมูลเดี๋ยวนี้</button>
      <button type="button" className="mock-button">บันทึกการตั้งค่า</button>
    </div>

    <p className="section-title">ประวัติการส่งข้อมูล</p>
    <div className="table-wrapper">
      <SortableTable className="data-table" aria-label="ประวัติการส่งข้อมูลไป SUB-HDC">
        <thead><tr><th>เวลา</th><th>งาน</th><th className="col-right">เรคคอร์ด</th><th className="col-center">ผล</th></tr></thead>
        <tbody>
          {HISTORY.map((row) => <tr key={row.time}>
            <td className="num-cell">{row.time}</td>
            <td className="name-cell"><strong>{row.job}</strong></td>
            <td className="col-right num-cell">{row.records.toLocaleString()}</td>
            <td className="col-center"><span className={`status-pill status-${row.state}`}>{stateLabel[row.state]}</span></td>
          </tr>)}
        </tbody>
      </SortableTable>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) token จริงต้องเก็บและเรียกใช้ใน main process</p></div>
  </>
}
