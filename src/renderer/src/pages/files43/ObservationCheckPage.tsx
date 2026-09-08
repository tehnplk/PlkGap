import { useEffect, useRef, useState } from 'react'
import type { FailingRows, ImportLogEntry, ObservationResult, ObservationRule, ObservationRuleId } from '../../../../shared/api'
import { SortableTable } from '../../SortableTable'
import { Icon } from '../../Icon'

const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
const levels = { error: 'ผิดพลาด', warning: 'ควรตรวจสอบ' }

export function ObservationCheckPage() {
  const [log, setLog] = useState<ImportLogEntry[]>([])
  const [result, setResult] = useState<ObservationResult | null>(null)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [details, setDetails] = useState<FailingRows | null>(null)
  const [loadingRows, setLoadingRows] = useState(false)
  const [rules, setRules] = useState<ObservationRule[]>([])
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true
    window.api.listImportLog().then((rows) => { if (active) setLog(rows) })
      .catch((reason: unknown) => { if (active) setError(String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    window.api.listObservationRules().then((rows) => { if (active) setRules(rows) })
      .catch((reason: unknown) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (details && !dialog.current?.open) dialog.current?.showModal()
    if (!details && dialog.current?.open) dialog.current.close()
  }, [details])

  async function check(zipName: string) {
    setBusy(zipName)
    setError('')
    setResult(null)
    setDetails(null)
    try { setResult(await window.api.checkObservations(zipName)) }
    catch (reason: unknown) { setError(String(reason)) }
    finally { setBusy('') }
  }
  async function toggleRule(rule: ObservationRule, active: boolean) {
    setRules((current) => current.map((entry) => entry.id === rule.id ? { ...entry, active } : entry))
    setError('')
    try { await window.api.setObservationRuleActive(rule.id, active) }
    catch (reason: unknown) {
      setError(String(reason))
      setRules((current) => current.map((entry) => entry.id === rule.id ? { ...entry, active: !active } : entry))
    }
  }
  async function showRows(rule: ObservationRuleId) {
    if (!result) return
    setLoadingRows(true)
    setError('')
    try { setDetails(await window.api.observationRows(result.zipName, rule)) }
    catch (reason: unknown) { setError(String(reason)) }
    finally { setLoadingRows(false) }
  }

  return <>
    <div className="content-heading">
      <div><p className="eyebrow">ระบบ 43 แฟ้ม</p><h2>คุณภาพตามข้อสังเกต</h2></div>
    </div>
    <p className="section-title">ไฟล์ที่นำเข้าแล้ว</p>
    <div className="table-wrapper">
      <SortableTable className="data-table" aria-label="ไฟล์สำหรับตรวจตามข้อสังเกต" maxVisibleRows={5}>
        <thead><tr><th className="col-right">ลำดับ</th><th className="import-datetime">วัน-เวลานำเข้า</th><th>ชื่อไฟล์</th><th className="col-right">แถว</th><th>ตรวจสอบ</th></tr></thead>
        <tbody>{log.map((row, index) => <tr key={row.id}>
          <td className="col-right num-cell">{log.length - index}</td>
          <td className="num-cell import-datetime" data-sort-value={new Date(row.startedAt).getTime()}>{when.format(new Date(row.startedAt))}</td>
          <td><code>{row.fileName}</code></td>
          <td className="col-right num-cell">{row.rowCount.toLocaleString('en-US')}</td>
          <td><button type="button" className="mock-button primary" disabled={!!busy || loadingRows || row.status !== 'complete'} onClick={() => void check(row.fileName)}>
            <Icon name="book" size={15} />{busy === row.fileName ? 'กำลังตรวจ...' : 'ตรวจตามข้อสังเกต'}
          </button></td>
        </tr>)}</tbody>
      </SortableTable>
    </div>
    {loading && <p role="status" className="hint-text">กำลังโหลด...</p>}
    {!loading && !error && !log.length && <p className="hint-text">ยังไม่มีข้อมูลที่นำเข้า</p>}
    {error && <p role="alert" className="hint-text">{error}</p>}
    {result && <>
      <p className="section-title">ผลตรวจ — {result.zipName}</p>
      <p className="hint-text">ตรวจเมื่อ {when.format(new Date(result.checkedAt))}</p>
      <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ผลตรวจตามข้อสังเกต">
          <thead><tr><th>แฟ้ม</th><th>ข้อสังเกต</th><th className="col-right">แถวที่ตรวจ</th><th className="col-right">ไม่เข้าเกณฑ์ / ข้อมูลไม่พอ</th><th className="col-right">พบข้อสังเกต</th><th>ผล</th><th>รายละเอียด</th></tr></thead>
          <tbody>{result.findings.map((finding) => <tr key={finding.id}>
            <td><code>{finding.tableName.toUpperCase()}</code></td><td>{finding.detail}</td>
            <td className="col-right num-cell">{finding.checked.toLocaleString('en-US')}</td>
            <td className="col-right num-cell">{finding.skipped.toLocaleString('en-US')}</td>
            <td className="col-right num-cell">{finding.found.toLocaleString('en-US')}</td>
            <td><span className={`status-pill status-${finding.found ? finding.level : finding.checked ? 'passed' : 'pending'}`}>
              {finding.found ? levels[finding.level] : finding.checked ? 'ไม่พบข้อสังเกต' : 'ไม่มีข้อมูลเข้าเกณฑ์'}
            </span></td>
            <td><button type="button" className="mock-button" disabled={!finding.found || loadingRows} onClick={() => void showRows(finding.id)}>ดูแถวที่พบ</button></td>
          </tr>)}</tbody>
        </SortableTable>
      </div>
    </>}
    {rules.length > 0 && <>
      <p className="section-title">ทะเบียนข้อสังเกต</p>
      <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ทะเบียนข้อสังเกต">
          <thead><tr><th className="col-right">ลำดับ</th><th>รหัสกฎ</th><th>แฟ้ม</th><th>ข้อสังเกต</th><th>ระดับ</th><th>ใช้งาน</th></tr></thead>
          <tbody>{rules.map((rule, index) => <tr key={rule.id}>
            <td className="col-right num-cell">{index + 1}</td>
            <td><code>{rule.id}</code></td>
            <td><code>{rule.tableName.toUpperCase()}</code></td>
            <td>{rule.detail}</td>
            <td><span className={`status-pill status-${rule.level}`}>{levels[rule.level]}</span></td>
            <td><input type="checkbox" checked={rule.active} aria-label={`ใช้งาน ${rule.detail}`}
              onChange={(event) => void toggleRule(rule, event.target.checked)} /></td>
          </tr>)}</tbody>
        </SortableTable>
      </div>
    </>}
    <dialog className="large-modal" ref={dialog} onClose={() => setDetails(null)} aria-label="รายละเอียดข้อสังเกต">
      {details && <>
        <header><div><strong>{details.detail}</strong><small>แสดง {details.rows.length.toLocaleString('en-US')} จาก {details.total.toLocaleString('en-US')} แถว</small></div>
          <button type="button" className="modal-close" aria-label="ปิด" onClick={() => setDetails(null)}><Icon name="close" size={16} /></button>
        </header>
        <div className="table-wrapper">
          <SortableTable className="data-table" aria-label="แถวที่พบข้อสังเกต">
            <thead><tr>{details.columns.map((column) => <th key={column}>{column.toUpperCase()}</th>)}</tr></thead>
            <tbody>{details.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={details.columns[column]} className="num-cell">{value || <em>(ว่าง)</em>}</td>)}</tr>)}</tbody>
          </SortableTable>
        </div>
      </>}
    </dialog>
  </>
}
