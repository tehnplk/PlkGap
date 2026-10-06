import { useEffect, useRef, useState } from 'react'
import type { FailingRows, ImportLogEntry, ObservationResult, ObservationRule, ObservationRuleId } from '../../../../shared/api'
import { SortableTable } from '../../SortableTable'
import { Icon } from '../../Icon'

const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

function downloadBlobFile(fileName: string, bytes: Uint8Array) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}

export function ObservationCheckPage() {
  const [log, setLog] = useState<ImportLogEntry[]>([])
  const [result, setResult] = useState<ObservationResult | null>(null)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [details, setDetails] = useState<FailingRows | null>(null)
  const [selectedRule, setSelectedRule] = useState<ObservationRuleId | ''>('')
  const [loadingRows, setLoadingRows] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [rules, setRules] = useState<ObservationRule[]>([])
  // The zip waiting on the picker, and the ticks the user has made but not confirmed yet.
  const [picking, setPicking] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const dialog = useRef<HTMLDialogElement>(null)
  const picker = useRef<HTMLDialogElement>(null)

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
  useEffect(() => {
    if (picking && !picker.current?.open) picker.current?.showModal()
    if (!picking && picker.current?.open) picker.current.close()
  }, [picking])

  // Checking is two steps: pick the rules for this zip, then run them.
  function openPicker(zipName: string) {
    setError('')
    setPicked(Object.fromEntries(rules.map((rule) => [rule.id, rule.active])))
    setPicking(zipName)
  }
  async function check() {
    const zipName = picking
    const chosen = rules.filter((rule) => picked[rule.id] !== rule.active)
    setPicking('')
    setBusy(zipName)
    setError('')
    setResult(null)
    setDetails(null)
    setExportError('')
    try {
      // The ticks are the register's own switches, so confirming keeps them for the next run too.
      for (const rule of chosen) await window.api.setObservationRuleActive(rule.id, picked[rule.id])
      setRules((current) => current.map((rule) => ({ ...rule, active: picked[rule.id] ?? rule.active })))
      setResult(await window.api.checkObservations(zipName))
    }
    catch (reason: unknown) { setError(String(reason)) }
    finally { setBusy('') }
  }
  async function showRows(rule: ObservationRuleId) {
    if (!result) return
    setSelectedRule(rule)
    setLoadingRows(true)
    setError('')
    setExportError('')
    try { setDetails(await window.api.observationRows(result.zipName, rule)) }
    catch (reason: unknown) { setError(String(reason)) }
    finally { setLoadingRows(false) }
  }

  async function exportDetailsExcel() {
    if (!result || !details || !details.rows.length) return
    setExporting(true)
    setExportError('')
    try {
      let exportRows = details.rows
      if (details.total > details.rows.length && selectedRule) {
        try {
          const allDetails = await window.api.observationRows(result.zipName, selectedRule, 0)
          if (allDetails?.rows?.length) {
            exportRows = allDetails.rows
          }
        } catch {
          exportRows = details.rows
        }
      }

      const XLSX = await import('xlsx')
      const book = XLSX.utils.book_new()
      const header = details.columns.map((col) => col.toUpperCase())
      const sheet = XLSX.utils.aoa_to_sheet([header, ...exportRows])
      const sheetName = `ข้อสังเกต_${details.tableName.toUpperCase()}`.slice(0, 31)
      XLSX.utils.book_append_sheet(book, sheet, sheetName)

      const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
      const baseZip = result.zipName.replace(/\.zip$/i, '')
      const safeRule = (selectedRule || details.tableName).toUpperCase()
      const fileName = `ข้อสังเกต_${details.tableName.toUpperCase()}_${safeRule}_${baseZip}.xlsx`

      if (typeof window.api?.saveExcelFile === 'function') {
        try {
          await window.api.saveExcelFile(fileName, bytes)
        } catch (err: unknown) {
          const msg = String(err)
          if (msg.includes('No handler registered')) {
            downloadBlobFile(fileName, bytes)
          } else {
            throw err
          }
        }
      } else {
        downloadBlobFile(fileName, bytes)
      }
    } catch (reason: unknown) {
      const msg = reason instanceof Error ? reason.message : String(reason)
      setExportError(msg)
    } finally {
      setExporting(false)
    }
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
          <td><button type="button" className="mock-button primary" disabled={!!busy || loadingRows || !rules.length || row.status !== 'complete'} onClick={() => openPicker(row.fileName)}>
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
        <SortableTable className="data-table" aria-label="ผลตรวจตามข้อสังเกต"
          defaultSort={[{ column: 0, descending: false }, { column: 1, descending: false }]}>
          <thead><tr><th>แฟ้ม</th><th>ข้อสังเกต</th><th className="col-right">แถวที่ตรวจ</th><th className="col-right">ไม่เข้าเกณฑ์ / ข้อมูลไม่พอ</th><th className="col-right">พบข้อสังเกต</th><th>ผล</th><th>รายละเอียด</th></tr></thead>
          <tbody>{result.findings.map((finding) => <tr key={finding.id}>
            <td><code>{finding.tableName.toUpperCase()}</code></td><td>{finding.detail}</td>
            <td className="col-right num-cell">{finding.checked.toLocaleString('en-US')}</td>
            <td className="col-right num-cell">{finding.skipped.toLocaleString('en-US')}</td>
            <td className="col-right num-cell">{finding.found.toLocaleString('en-US')}</td>
            <td><span className={`status-pill status-${finding.found ? 'error' : finding.checked ? 'passed' : 'pending'}`}>
              {finding.found ? 'พบข้อสังเกต' : finding.checked ? 'ไม่พบข้อสังเกต' : 'ไม่มีข้อมูลเข้าเกณฑ์'}
            </span></td>
            <td><button type="button" className="mock-button" disabled={!finding.found || loadingRows} onClick={() => void showRows(finding.id)}>ดูแถวที่พบ</button></td>
          </tr>)}</tbody>
        </SortableTable>
      </div>
    </>}
    <dialog className="large-modal" ref={picker} onClose={() => setPicking('')} aria-label="ทะเบียนข้อสังเกต">
      <header><div><strong>ทะเบียนข้อสังเกต</strong><small>{picking}</small></div>
        <button type="button" className="modal-close" aria-label="ปิด" onClick={() => setPicking('')}><Icon name="close" size={16} /></button>
      </header>
      <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ทะเบียนข้อสังเกต">
          <thead><tr><th>เลือก</th><th className="col-right">ลำดับ</th><th>รหัสกฎ</th><th>แฟ้ม</th><th>ข้อสังเกต</th></tr></thead>
          <tbody>{rules.map((rule, index) => <tr key={rule.id}>
            <td><input type="checkbox" checked={picked[rule.id] ?? false} aria-label={rule.detail}
              onChange={(event) => setPicked({ ...picked, [rule.id]: event.target.checked })} /></td>
            <td className="col-right num-cell">{index + 1}</td>
            <td><code>{rule.id}</code></td>
            <td><code>{rule.tableName.toUpperCase()}</code></td>
            <td>{rule.detail}</td>
          </tr>)}</tbody>
        </SortableTable>
      </div>
      <div className="modal-actions">
        <button type="button" className="mock-button" onClick={() => setPicked(Object.fromEntries(rules.map((rule) => [rule.id, true])))}>เลือกทั้งหมด</button>
        <button type="button" className="mock-button" onClick={() => setPicked({})}>ไม่เลือกเลย</button>
        <span className="modal-actions-gap" />
        <button type="button" className="mock-button" onClick={() => setPicking('')}>ยกเลิก</button>
        <button type="button" className="mock-button primary" disabled={!rules.some((rule) => picked[rule.id])}
          onClick={() => void check()}>เริ่มตรวจสอบ</button>
      </div>
    </dialog>
    <dialog className="large-modal" ref={dialog} onClose={() => { setDetails(null); setExportError('') }} aria-label="รายละเอียดข้อสังเกต">
      {details && <>
        <header>
          <div>
            <strong>{details.detail}</strong>
            <small>แฟ้ม {details.tableName.toUpperCase()} · แสดง {details.rows.length.toLocaleString('en-US')} จาก {details.total.toLocaleString('en-US')} แถว</small>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button type="button" className="mock-button" disabled={exporting || !details.rows.length}
              onClick={() => void exportDetailsExcel()}
              title={`Export ข้อมูลแถวที่พบข้อสังเกตของ ${details.tableName.toUpperCase()} เป็น Excel`}>
              <Icon name="excel" size={16} />
              {exporting ? 'กำลัง Export...' : 'Export Excel'}
            </button>
            <button type="button" className="modal-close" aria-label="ปิด" title="ปิด" onClick={() => { setDetails(null); setExportError('') }}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </header>
        {exportError && <div style={{ padding: '8px 18px', background: '#fce8e8', color: '#a83030', fontSize: '11px', borderBottom: '1px solid var(--line)' }} role="alert">
          {exportError}
        </div>}
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
