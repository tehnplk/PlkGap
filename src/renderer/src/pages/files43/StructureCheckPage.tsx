import { SortableTable } from '../../SortableTable'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { FailingRows, ImportLogEntry, StructureCheckResult, StructureFinding } from '../../../../shared/api'
import { Icon } from '../../Icon'

const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
const megabytes = (bytes: number) => (bytes / 1048576).toFixed(2)
const levelLabel: Record<string, string> = { error: 'ไม่ผ่าน', warning: 'ควรแก้ไข' }

export function StructureCheckPage() {
  const [log, setLog] = useState<ImportLogEntry[]>([])
  const [structure, setStructure] = useState<StructureCheckResult | null>(null)
  const [checkingZip, setCheckingZip] = useState('')
  const [level, setLevel] = useState<'all' | 'error' | 'warning'>('all')
  const [file, setFile] = useState('all')
  const [failing, setFailing] = useState<FailingRows | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const failingDialog = useRef<HTMLDialogElement>(null)

  const reload = useCallback(() => {
    window.api.listImportLog()
      .then((rows) => { setLog(rows); setError('') })
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  useEffect(reload, [reload])
  useEffect(() => {
    const dialog = failingDialog.current
    if (!dialog) return
    if (failing && !dialog.open) { setOffset({ x: 0, y: 0 }); dialog.showModal() }
    if (!failing && dialog.open) dialog.close()
  }, [failing])

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

  async function checkZip(zipName: string) {
    setCheckingZip(zipName)
    setStructure(null)
    setFailing(null)
    setLevel('all')
    setFile('all')
    setError('')
    try {
      setStructure(await window.api.checkStructure(zipName))
    } catch (reason: unknown) {
      setError(String(reason))
    } finally {
      setCheckingZip('')
    }
  }

  async function showFailing(finding: StructureFinding) {
    if (!structure) return
    setFailing(null)
    try {
      setFailing(await window.api.failingRows(structure.zipName, finding.tableName, finding.columnName, finding.rule))
    } catch (reason: unknown) {
      setError(String(reason))
    }
  }

  const issueFiles = [...new Set(structure?.findings.map((finding) => finding.tableName) ?? [])]
    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' }))
  const findings = structure?.findings.filter((finding) =>
    (level === 'all' || finding.level === level) && (file === 'all' || finding.tableName === file)) ?? []
  const errors = structure?.findings.filter((finding) => finding.level === 'error').length ?? 0
  const warnings = structure?.findings.filter((finding) => finding.level === 'warning').length ?? 0

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบ 43 แฟ้ม</p>
        <h2>ตรวจตามโครงสร้าง</h2>
      </div>
      {structure && <span className={`badge ${structure.findings.length ? 'error' : ''}`}>
        {structure.findings.length ? `พบ ${structure.findings.length} รายการ` : 'ผ่านทุกเกณฑ์'}
      </span>}
    </div>
    <p>เลือกไฟล์ที่นำเข้าแล้วเพื่อตรวจชนิดข้อมูล ความยาว รูปแบบวันที่ และคีย์ซ้ำ ตามพจนานุกรมข้อมูล 43 แฟ้ม</p>

    <p className="section-title">ไฟล์ที่นำเข้าแล้ว</p>
    <div className="table-wrapper">
      <SortableTable className="data-table" aria-label="ไฟล์สำหรับตรวจตามโครงสร้าง" maxVisibleRows={5}>
        <thead><tr><th className="col-right">ลำดับ</th><th className="import-datetime">วัน-เวลานำเข้า</th><th>ชื่อไฟล์</th><th className="col-right">File Size (MB)</th><th className="col-right">แถว</th><th className="col-center">ตรวจสอบ</th></tr></thead>
        <tbody>
          {log.map((row, index) => <tr key={row.id}>
            <td className="col-right num-cell">{log.length - index}</td>
            <td className="num-cell import-datetime" data-sort-value={new Date(row.startedAt).getTime()}>{when.format(new Date(row.startedAt))}</td>
            <td className="code-cell"><code>{row.fileName}</code></td>
            <td className="col-right num-cell">{megabytes(row.fileSize)}</td>
            <td className="col-right num-cell">{row.rowCount.toLocaleString('en-US')}</td>
            <td className="col-center">
              <button type="button" className="mock-button primary" disabled={row.status !== 'complete' || !!checkingZip}
                onClick={() => void checkZip(row.fileName)}>
                <Icon name="structure" size={15} />
                {checkingZip === row.fileName ? 'กำลังตรวจ...' : 'ตรวจตามโครงสร้าง'}
              </button>
            </td>
          </tr>)}
        </tbody>
      </SortableTable>
    </div>
    {error && <p className="hint-text" role="alert">{error}</p>}
    {!error && !log.length && <p className="hint-text">ยังไม่มีข้อมูลที่นำเข้า</p>}

    {structure && <>
      <div className="toolbar-row">
        <p className="section-title">ผลตรวจ — {structure.zipName}</p>
        <label htmlFor="structure-level" style={{ marginLeft: 'auto' }}>กรองระดับ</label>
        <select id="structure-level" className="mock-select" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
          <option value="all">ทั้งหมด</option>
          <option value="error">ไม่ผ่าน</option>
          <option value="warning">ควรแก้ไข</option>
        </select>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><small>กฎที่ตรวจ</small><strong>{structure.rules.toLocaleString('en-US')}</strong></div>
        <div className="stat-card"><small>แถวที่ตรวจ</small><strong>{structure.rows.toLocaleString('en-US')}</strong></div>
        <div className="stat-card"><small>ไม่ผ่าน</small><strong>{errors}</strong></div>
        <div className="stat-card"><small>ควรแก้ไข</small><strong>{warnings}</strong></div>
      </div>

      {!!issueFiles.length && <div className="toolbar-row">
        <label htmlFor="structure-file">กรองแฟ้ม</label>
        <select id="structure-file" className="mock-select" value={file} onChange={(event) => setFile(event.target.value)}>
          <option value="all">ทั้งหมด</option>
          {issueFiles.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}
        </select>
      </div>}

      {!!structure.findings.length && <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ผลตรวจตามโครงสร้าง"
          defaultSort={[{ column: 0, descending: false }, { column: 1, descending: false }]}>
          <thead><tr><th>แฟ้ม</th><th>ฟิลด์</th><th>รายละเอียด</th><th>เกณฑ์</th><th className="col-right">จำนวนแถว</th><th className="col-right">ไม่ผ่าน</th><th className="col-right">ร้อยละ</th><th className="col-center">ระดับ</th><th className="col-center"></th></tr></thead>
          <tbody>
            {findings.map((finding) => <tr key={`${finding.tableName}-${finding.columnName}-${finding.rule}`}>
              <td className="code-cell"><code>{finding.tableName.toUpperCase()}</code></td>
              <td className="name-cell"><strong>{finding.columnName.toUpperCase()}</strong></td>
              <td className="field-description">{finding.fieldDescription || '-'}</td>
              <td>{finding.detail}</td>
              <td className="col-right num-cell">{finding.tableRows.toLocaleString('en-US')}</td>
              <td className="col-right num-cell">{finding.found.toLocaleString('en-US')}</td>
              <td className="col-right num-cell">{finding.tableRows ? ((finding.found / finding.tableRows) * 100).toFixed(2) : '-'}</td>
              <td className="col-center"><span className={`status-pill status-${finding.level}`}>{levelLabel[finding.level] ?? finding.level}</span></td>
              <td className="col-center"><button type="button" className="mock-button" onClick={() => void showFailing(finding)}>ดูแถวที่ไม่ผ่าน</button></td>
            </tr>)}
          </tbody>
        </SortableTable>
      </div>}
      {!structure.findings.length && <p className="hint-text">ข้อมูลผ่านทุกเกณฑ์ตามโครงสร้าง</p>}
      {!!structure.findings.length && !findings.length && <p className="hint-text">ไม่พบรายการตามตัวกรองที่เลือก</p>}
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
          <SortableTable className="data-table" aria-label="แถวที่ไม่ผ่านเงื่อนไข">
            <thead><tr>{failing.columns.map((name) => <th key={name}>{name.toUpperCase()}</th>)}</tr></thead>
            <tbody>
              {failing.rows.map((row, index) => <tr key={index}>
                {row.map((value, column) => <td key={failing.columns[column]} className="num-cell">{value === '' ? <em>(ว่าง)</em> : value}</td>)}
              </tr>)}
            </tbody>
          </SortableTable>
        </div>
      </>}
    </dialog>
  </>
}
