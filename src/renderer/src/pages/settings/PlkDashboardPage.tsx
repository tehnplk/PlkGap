import { useState } from 'react'
import { Icon } from '../../Icon'

interface Feed { id: string; name: string; frequency: string; last: string; state: 'passed' | 'pending' | 'warning' }

const FEEDS: Feed[] = [
  { id: 'kpi', name: 'ชุดข้อมูลตัวชี้วัดจังหวัด', frequency: 'รายเดือน', last: '01 ก.ย. 69', state: 'passed' },
  { id: 'revenue', name: 'ชุดข้อมูลรายได้หน่วยบริการ', frequency: 'รายเดือน', last: '01 ก.ย. 69', state: 'passed' },
  { id: 'dengue', name: 'ชุดข้อมูลเฝ้าระวังไข้เลือดออก', frequency: 'รายสัปดาห์', last: '07 ก.ย. 69', state: 'warning' },
  { id: 'household', name: 'ชุดข้อมูลพิกัดครัวเรือน', frequency: 'รายไตรมาส', last: '01 ก.ค. 69', state: 'pending' },
]
const stateLabel: Record<Feed['state'], string> = { passed: 'ส่งครบ', pending: 'ยังไม่ถึงรอบ', warning: 'ส่งล่าช้า' }

export function PlkDashboardPage() {
  const [config, setConfig] = useState({ url: 'https://dashboard.plkhealth.go.th/api/v1', key: '••••••••••••••••', auto: true })

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ตั้งค่า</p>
        <h2>ตั้งค่าเชื่อมต่อระบบจังหวัด (PLK Dashboard)</h2>
      </div>
      <span className="badge">{FEEDS.filter((feed) => feed.state === 'passed').length}/{FEEDS.length} ชุดข้อมูลเป็นปัจจุบัน</span>
    </div>
    <p>ตั้งค่าการส่งชุดข้อมูลสรุปขึ้น PLK Dashboard ระดับจังหวัด และเลือกว่าจะเผยแพร่ชุดข้อมูลใดบ้าง</p>

    <div className="form-grid">
      <label htmlFor="plk-url">ที่อยู่ API</label>
      <input id="plk-url" className="mock-input" value={config.url} onChange={(event) => setConfig({ ...config, url: event.target.value })} />
      <label htmlFor="plk-key">API key</label>
      <input id="plk-key" className="mock-input" type="password" value={config.key} onChange={(event) => setConfig({ ...config, key: event.target.value })} />
      <label htmlFor="plk-auto">ส่งอัตโนมัติ</label>
      <label className="mock-check">
        <input id="plk-auto" type="checkbox" checked={config.auto} onChange={(event) => setConfig({ ...config, auto: event.target.checked })} />
        ส่งทันทีเมื่อประมวลผลชุดข้อมูลเสร็จ
      </label>
    </div>

    <div className="toolbar-row">
      <button type="button" className="mock-button primary"><Icon name="dashboard" size={15} />ทดสอบการเชื่อมต่อ</button>
      <button type="button" className="mock-button">ส่งข้อมูลทั้งหมด</button>
      <button type="button" className="mock-button">บันทึกการตั้งค่า</button>
    </div>

    <p className="section-title">ชุดข้อมูลที่เผยแพร่</p>
    <div className="table-wrapper">
      <table className="data-table" aria-label="ชุดข้อมูลที่ส่งขึ้น PLK Dashboard">
        <thead><tr><th>ชุดข้อมูล</th><th>ความถี่</th><th>ส่งล่าสุด</th><th className="col-center">สถานะ</th></tr></thead>
        <tbody>
          {FEEDS.map((feed) => <tr key={feed.id}>
            <td className="name-cell"><strong>{feed.name}</strong></td>
            <td>{feed.frequency}</td>
            <td className="num-cell">{feed.last}</td>
            <td className="col-center"><span className={`status-pill status-${feed.state}`}>{stateLabel[feed.state]}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) API key จริงต้องเก็บและเรียกใช้ใน main process</p></div>
  </>
}
