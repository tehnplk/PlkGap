import { useEffect, useRef, useState } from 'react'
import { SortableTable } from '../../SortableTable'
import { Icon } from '../../Icon'
import type { IndicatorReport, IndicatorResult } from '../../../../shared/api'

export function IndicatorTemplatePage() {
  const now = new Date()
  const fiscalYear = now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0)
  const [period, setPeriod] = useState(`${fiscalYear}-Q${Math.floor(((now.getMonth() + 3) % 12) / 3) + 1}`)
  const [report, setReport] = useState<IndicatorReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [onlyBelow, setOnlyBelow] = useState(false)
  const [selected, setSelected] = useState<IndicatorResult | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  useEffect(() => {
    if (selected) dialog.current?.showModal()
    else dialog.current?.close()
  }, [selected])
  async function process() {
    const id = ++request.current
    setBusy(true); setError(''); setReport(null); setSelected(null)
    try {
      const next = await window.api.processIndicators(period)
      if (id === request.current) setReport(next)
    } catch (reason) {
      if (id === request.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (id === request.current) setBusy(false) }
  }
  async function exportExcel() {
    if (!report) return
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.indicators.map(item => ({
        'งวด': report.period, 'เริ่มงวด': report.start, 'สิ้นสุดงวด (ไม่รวม)': report.end,
        'ประมวลผลเมื่อ': report.processedAt, 'รหัส': item.code, 'ตัวชี้วัด': item.name,
        'ผู้รับผิดชอบ': item.owner, 'เป้าหมายเทมเพลต (%)': item.target,
        'A': item.numerator, 'B': item.denominator, 'ผลงาน (%)': item.value,
        'สถานะ': item.unavailable ?? (item.value === null ? 'ไม่มีข้อมูลในงวด' : item.value >= item.target ? 'ผ่าน' : 'ต่ำกว่าเป้า'),
        'สูตร': item.rule,
      }))), 'ตัวชี้วัด')
      const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
      await window.api.saveIndicatorWorkbook(report.period, Array.from(bytes))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const all = report?.indicators ?? []
  const rows = all.filter(item => !onlyBelow || (item.value !== null && item.value < item.target))
  const evaluated = all.filter(item => item.value !== null)
  const passed = evaluated.filter(item => item.value! >= item.target).length
  return <>
    <div className="content-heading"><div><p className="eyebrow">ระบบวิเคราะห์ข้อมูล</p><h2>เทมเพลตตัวชี้วัด</h2></div>
      <span className="badge">ผ่านเกณฑ์ {passed}/{evaluated.length}</span></div>
    <p>คำนวณจากข้อมูลนำเข้าทุก ZIP เฉพาะไตรมาสที่เลือก ตามสูตรด้านล่าง เป้าหมายเป็นค่าของเทมเพลต ไม่ใช่ผลรับรองตามนิยาม HDC รายปี</p>
    <div className="toolbar-row">
      <label htmlFor="kpi-period">งวดข้อมูล</label>
      <select id="kpi-period" className="mock-select" value={period} disabled={busy} onChange={event => {
        request.current++; setPeriod(event.target.value); setReport(null); setSelected(null); setError('')
      }}>
        {Array.from({ length: 11 }, (_, i) => fiscalYear - i).flatMap(year => [1, 2, 3, 4].map(q =>
          <option key={`${year}-Q${q}`} value={`${year}-Q${q}`}>ปีงบ {year} ไตรมาส {q}</option>))}
      </select>
      <button type="button" className="mock-button primary" disabled={busy} onClick={() => void process()}><Icon name="gauge" size={15} />{busy ? 'กำลังประมวลผล…' : 'ประมวลผลตัวชี้วัด'}</button>
      <button type="button" className="mock-button" disabled={!report || busy} onClick={() => void exportExcel()}>ส่งออก Excel</button>
      <label className="mock-check" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={onlyBelow} onChange={event => setOnlyBelow(event.target.checked)} />แสดงเฉพาะที่ต่ำกว่าเป้า</label>
    </div>
    {error && <p role="alert">{error}</p>}
    {!report && <p role="status">{busy ? 'กำลังอ่านข้อมูลและคำนวณตัวชี้วัด…' : 'เลือกงวดแล้วกดประมวลผลตัวชี้วัด'}</p>}
    {report && <>
      <p>งวด {report.period} · ประมวลผล {new Date(report.processedAt).toLocaleString('th-TH')}</p>
      <div className="table-wrapper"><SortableTable className="data-table" aria-label="ตารางตัวชี้วัด">
        <thead><tr><th>รหัส</th><th>ชื่อตัวชี้วัด</th><th>ผู้รับผิดชอบ</th><th>เป้าหมาย</th><th>A</th><th>B</th><th>ผลงาน</th><th>ความคืบหน้า</th><th>ส่วนขาด</th></tr></thead>
        <tbody>{rows.map(item => <tr key={item.code}>
          <td className="code-cell"><code>{item.code}</code></td><td className="name-cell"><strong>{item.name}</strong></td><td>{item.owner}</td>
          <td data-sort-value={item.target}>{item.target}%</td><td data-sort-value={item.numerator}>{item.unavailable ? '—' : item.numerator.toLocaleString()}</td>
          <td data-sort-value={item.denominator}>{item.unavailable ? '—' : item.denominator.toLocaleString()}</td>
          <td data-sort-value={item.value ?? -1}>{item.value === null ? item.unavailable ? 'ยังคำนวณไม่ได้' : 'ไม่มีข้อมูลในงวด' : `${item.value.toFixed(1)}%`}</td>
          <td data-sort-value={item.value ?? -1} style={{ minWidth: 140 }}>{item.value !== null && <div className="progress"><span className={item.value >= item.target ? '' : 'below'} style={{ width: `${Math.min(100, item.value / item.target * 100)}%` }} /></div>}</td>
          <td data-sort-value={item.gapCount}><button type="button" className="mock-button" disabled={!item.gapCount} onClick={() => setSelected(item)}>แสดงส่วนขาด ({item.gapCount.toLocaleString()})</button></td>
        </tr>)}</tbody>
      </SortableTable>{!rows.length && <p>ไม่มีตัวชี้วัดที่ต่ำกว่าเป้า</p>}</div>
      <details><summary>สูตรคำนวณและข้อจำกัด</summary><p>A / B × 100; B = 0 ไม่คำนวณร้อยละ ข้อมูลอาจไม่ครบและบุคคลเดียวกันต่างหน่วยบริการนับแยกกัน ไม่อนุมานผลทางคลินิกจากข้อมูลที่ขาด</p>
        {all.map(item => <p key={item.code}><strong>{item.code}</strong> — {item.rule}{item.unavailable && <> · {item.unavailable}</>}</p>)}
      </details>
    </>}
    <dialog className="large-modal" ref={dialog} onClose={() => setSelected(null)} aria-label="แสดงส่วนขาด">
      {selected && <><header><div><strong>แสดงส่วนขาด — {selected.code} {selected.name}</strong><small>แสดง {selected.gaps.length.toLocaleString()} จาก {selected.gapCount.toLocaleString()} รายการ (สูงสุด 500) · {report?.period}</small></div>
        <button type="button" className="modal-close" aria-label="ปิด" onClick={() => setSelected(null)}><Icon name="close" size={16} /></button></header>
        <div className="table-wrapper"><SortableTable key={selected.code} className="data-table" aria-label="รายชื่อส่วนขาด">
          <thead><tr><th>HOSPCODE</th><th>PID</th><th>CID</th><th>ชื่อ-สกุล</th><th>รายละเอียดส่วนขาด</th></tr></thead>
          <tbody>{selected.gaps.map((person, i) => <tr key={`${person.hospcode}-${person.pid}-${i}`}><td>{person.hospcode}</td><td>{person.pid}</td><td>{person.cid || '—'}</td><td>{person.fullname}</td><td>{person.detail}</td></tr>)}</tbody>
        </SortableTable></div></>}
    </dialog>
  </>
}
