import { SortableTable } from '../../SortableTable'
import { useEffect, useId, useState } from 'react'
import { Icon } from '../../Icon'
import { OutbreakRadiusMap } from '../../OutbreakRadiusMap'

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

const TABS = ['ส่งเตือนนัด', 'ส่งเตือนโรคระบาด', 'ส่งประชาสัมพันธ์'] as const

export function LineMorPromPage() {
  const [active, setActive] = useState(0)
  const id = useId()
  return <>
    <div className="content-heading"><div><p className="eyebrow">ระบบสื่อสาร</p><h2>ส่ง Line หมอพร้อม</h2></div></div>
    <div className="toolbar-row" role="tablist" aria-label="ประเภทการส่งข้อความ">
      {TABS.map((label, index) => <button key={label} type="button" role="tab"
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index}
        tabIndex={active === index ? 0 : -1} className={`mock-button${active === index ? ' primary' : ''}`}
        onClick={() => setActive(index)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
            : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
          if (next === null) return
          event.preventDefault(); setActive(next)
          document.getElementById(`${id}-tab-${next}`)?.focus()
        }}>{label}</button>)}
    </div>
    {TABS.map((label, index) => <div key={label} role="tabpanel" id={`${id}-panel-${index}`}
      aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} tabIndex={0}>
      <MessagePanel mode={index} active={active === index} />
    </div>)}
  </>
}

function MessagePanel({ mode, active }: { mode: number; active: boolean }) {
  const appointment = mode === 0
  const targetId = useId()
  const [appointmentGroup, setAppointmentGroup] = useState('ncd')
  const [areaMode, setAreaMode] = useState('village')
  const [village, setVillage] = useState('')
  const [villages, setVillages] = useState<{ id: string; label: string }[]>([])
  const [areaError, setAreaError] = useState('')
  const [loadingAreas, setLoadingAreas] = useState(false)
  const [radius, setRadius] = useState(500)
  const [center, setCenter] = useState<[number, number] | null>(null)
  useEffect(() => {
    if (mode !== 1 || !active) return
    let cancelled = false
    setLoadingAreas(true)
    window.api.listMessageVillages().then(rows => { if (!cancelled) { setVillages(rows); setAreaError('') } })
      .catch(reason => { if (!cancelled) setAreaError(String(reason)) })
      .finally(() => { if (!cancelled) setLoadingAreas(false) })
    return () => { cancelled = true }
  }, [mode, active])
  const [target, setTarget] = useState(TARGETS[0].id)
  const [message, setMessage] = useState(appointment ? 'เรียนคุณ {ชื่อ} ท่านมีนัดตรวจที่ {หน่วยบริการ} วันที่ {วันนัด} เวลา {เวลานัด} กรุณานำบัตรประชาชนมาด้วยค่ะ' : '')
  const selected = TARGETS.find((item) => item.id === target)!

  return <>
    <p>เลือกกลุ่มเป้าหมายและข้อความที่จะส่งผ่าน Line หมอพร้อม</p>
    {appointment && <div className="field-row">
      <label htmlFor={targetId}>เลือกกลุ่มนัด</label>
      <select id={targetId} className="mock-select" value={appointmentGroup} onChange={event => setAppointmentGroup(event.target.value)}>
        <option value="ncd">ผู้ป่วย NCD</option><option value="vaccine">วัคซีนเด็ก</option>
      </select>
    </div>}
    {mode === 1 && <>
      <div className="field-row" role="group" aria-label="เลือกพื้นที่แจ้งระบาด">
        <label className="mock-check"><input type="radio" name={targetId} value="village" checked={areaMode === 'village'} onChange={() => setAreaMode('village')} />เลือกหมู่ที่</label>
        <label className="mock-check"><input type="radio" name={targetId} value="radius" checked={areaMode === 'radius'} onChange={() => setAreaMode('radius')} />วาดรัศมี</label>
      </div>
      {areaMode === 'village' ? <div className="field-row">
        <label htmlFor={`${targetId}-village`}>หมู่ที่</label>
        <select id={`${targetId}-village`} className="mock-select" value={village} disabled={loadingAreas} onChange={event => setVillage(event.target.value)}>
          <option value="">{loadingAreas ? 'กำลังโหลดหมู่บ้าน…' : villages.length ? 'เลือกหมู่ที่' : 'ไม่มีหมู่บ้านในข้อมูล HOME'}</option>
          {villages.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {areaError && <p role="alert">{areaError}</p>}
      </div> : <>
        <div className="field-row"><label htmlFor={`${targetId}-radius`}>รัศมี (เมตร)</label>
          <input id={`${targetId}-radius`} className="mock-select" type="number" min={1} max={50000} value={radius}
            onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setRadius(Math.max(1, Math.min(50000, value))) }} />
        </div>
        <p className="hint-text">คลิกจุดศูนย์กลางบนแผนที่ แล้วคลิกจุดขอบวงกลมเพื่อวาดรัศมี</p>
        {active && <OutbreakRadiusMap center={center} radius={radius} onCenter={setCenter} onRadius={setRadius} />}
        {center && <p className="hint-text">จุดศูนย์กลาง {center[0].toFixed(6)}, {center[1].toFixed(6)} · รัศมี {radius.toLocaleString()} เมตร</p>}
      </>}
    </>}
    {mode === 2 && <div className="field-row">
      <label htmlFor={targetId}>กลุ่มเป้าหมาย</label>
      <select id={targetId} className="mock-select" style={{ flex: 1, minWidth: 260 }} value={target} onChange={(event) => setTarget(event.target.value)}>
        {TARGETS.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.count.toLocaleString()} คน)</option>)}
      </select>
    </div>}
    {mode === 2 && <p className="hint-text">{selected.note}</p>}

    <p className="section-title">ข้อความ</p>
    <textarea className="mock-textarea" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} aria-label="ข้อความที่จะส่ง" />
    <p className="hint-text">ตัวแปรที่ใช้ได้: {'{ชื่อ}'} {'{หน่วยบริการ}'} {appointment && <>{'{วันนัด}'} {'{เวลานัด}'}</>} — ความยาว {message.length} อักขระ</p>

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
          {(appointment ? LOGS : []).map((log) => <tr key={log.time}>
            <td className="num-cell">{log.time}</td>
            <td className="name-cell"><strong>{log.target}</strong></td>
            <td className="col-right num-cell">{log.sent.toLocaleString()}</td>
            <td className="col-right num-cell">{log.failed.toLocaleString()}</td>
            <td className="col-center"><span className={`status-pill status-${log.state}`}>{stateLabel[log.state]}</span></td>
          </tr>)}
        </tbody>
      </SortableTable>
      {!appointment && <p>ยังไม่มีประวัติการส่ง</p>}
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) การส่งจริงต้องเรียก API ผ่าน main process เพราะมี access token</p></div>
  </>
}
