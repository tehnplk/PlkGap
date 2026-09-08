import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { FailingRows, ImportCheck, ImportLogEntry, StructureCheckResult, StructureFinding } from '../../../../shared/api'
import { Icon } from '../../Icon'

const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
const megabytes = (bytes: number) => (bytes / 1048576).toFixed(2)
const statusLabel: Record<string, string> = { running: 'กำลังนำเข้า', complete: 'สำเร็จ', failed: 'ล้มเหลว' }
const statusStyle: Record<string, string> = { running: 'pending', complete: 'passed', failed: 'error' }

export function Import52Files() {
  const [path, setPath] = useState('')
  const [percent, setPercent] = useState(0)
  const [progress, setProgress] = useState('ยังไม่ได้เลือกไฟล์')
  const [check, setCheck] = useState<ImportCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<ImportLogEntry[]>([])
  const [structure, setStructure] = useState<StructureCheckResult | null>(null)
  const [checkingZip, setCheckingZip] = useState('')
  const [failing, setFailing] = useState<FailingRows | null>(null)
  const failingDialog = useRef<HTMLDialogElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    window.api.listImportLog()
      .then((rows) => { setLog(rows); setError('') })
      .catch((reason: unknown) => setError(String(reason)))
  }, [])
  useEffect(reload, [reload])
  useEffect(() => window.api.onImportProgress((update) => {
    setPercent(update.percent)
    setProgress(`กำลังนำเข้า ${update.file} — ${update.rowCount.toLocaleString('en-US')} แถว`)
  }), [])

  // The failing rows get the whole app window: a native modal, so Esc and focus trapping come free.
  useEffect(() => {
    const dialog = failingDialog.current
    if (!dialog) return
    if (failing && !dialog.open) { setOffset({ x: 0, y: 0 }); dialog.showModal() }
    if (!failing && dialog.open) dialog.close()
  }, [failing])

  /** Drag the modal by its header, the same way a child window moves. */
  function moveModal(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX - offset.x
    const startY = event.clientY - offset.y
    const onMove = (next: globalThis.PointerEvent) => setOffset({ x: next.clientX - startX, y: next.clientY - startY })
    const stop = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', stop)
      target.removeEventListener('pointercancel', stop)
      target.removeEventListener('lostpointercapture', stop)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', stop)
    target.addEventListener('pointercancel', stop)
    target.addEventListener('lostpointercapture', stop)
  }

  const inspect = useCallback(async (target: string) => {
    setPath(target)
    setPercent(0)
    setCheck(null)
    setBusy(true)
    setProgress('กำลังตรวจไฟล์...')
    try {
      const result = await window.api.checkImportFile(target)
      setCheck(result)
      setProgress(result.valid ? 'ไฟล์ถูกต้อง ครบ 52 แฟ้ม พร้อมนำเข้า' : 'ไฟล์นี้นำเข้าไม่ได้')
    } catch (reason: unknown) {
      setCheck(null)
      setProgress(String(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  async function showFailing(finding: StructureFinding) {
    if (!structure) return
    setFailing(null)
    try {
      setFailing(await window.api.failingRows(structure.zipName, finding.tableName, finding.columnName, finding.rule))
    } catch (reason: unknown) {
      setError(String(reason))
    }
  }

  // Checked by zip name, so re-importing the same file does not hide the rows it first brought in.
  async function checkZip(zipName: string) {
    setCheckingZip(zipName)
    setStructure(null)
    setFailing(null)
    try {
      setStructure(await window.api.checkStructure(zipName))
    } catch (reason: unknown) {
      setError(String(reason))
    } finally {
      setCheckingZip('')
    }
  }

  async function browse() {
    const chosen = await window.api.chooseImportFile()
    if (chosen) await inspect(chosen)
  }

  async function start() {
    setBusy(true)
    setPercent(0)
    setProgress('เริ่มนำเข้า...')
    try {
      const result = await window.api.runImport(path)
      setPercent(100)
      setProgress(`นำเข้าสำเร็จ ${result.files} แฟ้ม ${result.rowCount.toLocaleString('en-US')} แถว`)
      // Done with this file: clear the picker so the next import starts from a blank field.
      setPath('')
      setCheck(null)
    } catch (reason: unknown) {
      setProgress(String(reason))
    } finally {
      setBusy(false)
      reload()
    }
  }

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบ 43 แฟ้ม</p>
        <h2>นำเข้าข้อมูล</h2>
      </div>
      <span className={`badge ${error ? 'error' : ''}`}>{error ? 'อ่านประวัติไม่ได้' : `${log.length} รอบ`}</span>
    </div>

    <div className="field-row">
      <label htmlFor="import-path">เลือกไฟล์</label>
      <input id="import-path" className="mock-input" style={{ flex: 1, minWidth: 240 }} value={path}
        placeholder="เลือกไฟล์ .zip" onChange={(event) => setPath(event.target.value)}
        onBlur={(event) => { if (event.target.value.trim()) void inspect(event.target.value.trim()) }} />
      <button type="button" className="mock-button browse-button" onClick={browse} aria-label="เรียกดูไฟล์">...</button>
      <button type="button" className="mock-button primary" disabled={!check?.valid || busy} onClick={start}>
        <Icon name="upload" size={15} />นำเข้า
      </button>
    </div>

    <div className="import-progress">
      <div className="progress"><span style={{ width: `${percent}%` }} /></div>
      <p className="hint-text" role="status">{progress}</p>
      {check && !check.valid && <ul className="check-problems">
        {check.error && <li>{check.error}</li>}
        {!!check.unexpected.length && <li>
          มีไฟล์ที่ไม่ใช่ 52 แฟ้มมาตรฐาน {check.unexpected.length} รายการ: {check.unexpected.slice(0, 5).join(', ')}
          {check.unexpected.length > 5 && ` และอีก ${check.unexpected.length - 5} รายการ`}
        </li>}
        {!!check.missing.length && !check.error && <li>
          ขาด {check.missing.length} แฟ้ม: {check.missing.slice(0, 8).join(', ').toUpperCase()}
          {check.missing.length > 8 && ` และอีก ${check.missing.length - 8} แฟ้ม`}
        </li>}
      </ul>}
      {check?.valid && <p className="hint-text">พบ {check.found.length} แฟ้ม จากทั้งหมด {check.entries} รายการในไฟล์</p>}
    </div>

    <p className="section-title">ประวัติการนำเข้า</p>

    <div className="table-wrapper">
      <table className="data-table" aria-label="ประวัติการนำเข้า">
        <thead>
          <tr>
            <th className="col-right">#</th>
            <th>วัน-เวลานำเข้า</th>
            <th>ชื่อไฟล์</th>
            <th className="col-right">File Size (MB)</th>
            <th className="col-right">แถว</th>
            <th className="col-center">สถานะ</th>
            <th className="col-center">คุณภาพโครงสร้าง</th>
          </tr>
        </thead>
        <tbody>
          {log.map((row, index) => <tr key={row.id}>
            <td className="col-right num-cell">{index + 1}</td>
            <td className="num-cell">{when.format(new Date(row.startedAt))}</td>
            <td className="code-cell"><code>{row.fileName}</code></td>
            <td className="col-right num-cell">{megabytes(row.fileSize)}</td>
            <td className="col-right num-cell">{row.rowCount.toLocaleString('en-US')}</td>
            <td className="col-center">
              <span className={`status-pill status-${statusStyle[row.status] ?? 'pending'}`}>{statusLabel[row.status] ?? row.status}</span>
            </td>
            <td className="col-center">
              <button type="button" className="mock-button" disabled={checkingZip === row.fileName}
                onClick={() => void checkZip(row.fileName)}>
                {checkingZip === row.fileName ? 'กำลังตรวจ...' : 'ตรวจสอบคุณภาพโครงสร้าง'}
              </button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {error && <p className="hint-text" role="alert">{error}</p>}
    {!error && !log.length && <p className="hint-text">ยังไม่มีประวัติการนำเข้า</p>}

    {structure && <>
      <div className="toolbar-row">
        <p className="section-title">ผลตรวจคุณภาพโครงสร้าง — {structure.zipName}</p>
        <span className={`badge ${structure.findings.length ? 'error' : ''}`} style={{ marginLeft: 'auto' }}>
          {structure.findings.length ? `พบ ${structure.findings.length} รายการ` : 'ผ่านทุกเกณฑ์'}
        </span>
      </div>
      <p className="hint-text">
        ตรวจ {structure.rows.toLocaleString('en-US')} แถว ด้วย {structure.rules.toLocaleString('en-US')} เกณฑ์
        จากพจนานุกรมข้อมูล <code>c_files_schema</code>
      </p>
      {!!structure.findings.length && <div className="table-wrapper">
        <table className="data-table" aria-label="ผลตรวจคุณภาพโครงสร้าง">
          <thead>
            <tr>
              <th>แฟ้ม</th>
              <th>ฟิลด์</th>
              <th>เกณฑ์</th>
              <th className="col-right">จำนวนแถว</th>
              <th className="col-right">ไม่ผ่านเงื่อนไข</th>
              <th className="col-right">ร้อยละ</th>
              <th className="col-center">ระดับ</th>
              <th className="col-center"></th>
            </tr>
          </thead>
          <tbody>
            {structure.findings.map((finding) => <tr key={`${finding.tableName}-${finding.columnName}-${finding.rule}`}>
              <td className="code-cell"><code>{finding.tableName.toUpperCase()}</code></td>
              <td className="name-cell"><strong>{finding.columnName.toUpperCase()}</strong></td>
              <td>{finding.detail}</td>
              <td className="col-right num-cell">{finding.tableRows.toLocaleString('en-US')}</td>
              <td className="col-right num-cell">{finding.found.toLocaleString('en-US')}</td>
              <td className="col-right num-cell">
                {finding.tableRows ? ((finding.found / finding.tableRows) * 100).toFixed(2) : '-'}
              </td>
              <td className="col-center">
                <span className={`status-pill status-${finding.level}`}>{finding.level === 'error' ? 'ไม่ผ่าน' : 'ควรแก้ไข'}</span>
              </td>
              <td className="col-center">
                <button type="button" className="mock-button" onClick={() => void showFailing(finding)}>ดูแถวที่ไม่ผ่าน</button>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>}

    </>}

    <dialog className="large-modal" ref={failingDialog} onClose={() => setFailing(null)}
      style={{ translate: `${offset.x}px ${offset.y}px` }}
      onClick={(event) => { if (event.target === failingDialog.current) setFailing(null) }}>
      {failing && <>
        <header onPointerDown={moveModal}>
          <div>
            <strong>แถวที่ไม่ผ่าน — {failing.tableName.toUpperCase()}.{failing.columnName.toUpperCase()}</strong>
            <small>{failing.detail} · แสดง {failing.rows.length.toLocaleString('en-US')} จาก {failing.total.toLocaleString('en-US')} แถว</small>
          </div>
          <button type="button" className="modal-close" aria-label="ปิด" title="ปิด" onClick={() => setFailing(null)}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="table-wrapper">
          <table className="data-table" aria-label="แถวที่ไม่ผ่านเงื่อนไข">
            <thead>
              <tr>{failing.columns.map((name) => <th key={name}>{name.toUpperCase()}</th>)}</tr>
            </thead>
            <tbody>
              {failing.rows.map((row, index) => <tr key={index}>
                {row.map((value, column) => <td key={failing.columns[column]} className="num-cell">
                  {value === '' ? <em>(ว่าง)</em> : value}
                </td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}
    </dialog>
  </>
}
