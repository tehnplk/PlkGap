import { SortableTable } from '../../SortableTable'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { FailingRows, ImportLogEntry, ReferenceCodeList, StructureCheckResult, StructureFinding } from '../../../../shared/api'
import { Icon } from '../../Icon'

const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
const megabytes = (bytes: number) => (bytes / 1048576).toFixed(2)

/** One row of the result grid: every rule that failed on the same field, counted together. */
interface FieldSummary {
  tableName: string
  columnName: string
  fieldDescription: string
  reference?: string
  tableRows: number
  failed: number
}

/**
 * Rules are mutually exclusive per value — a value is reported by the first rule it breaks — so
 * the failing rows of one field add up without counting a row twice.
 */
function summarize(findings: StructureFinding[]): FieldSummary[] {
  const fields = new Map<string, FieldSummary>()
  for (const finding of findings) {
    const key = `${finding.tableName}.${finding.columnName}`
    const field = fields.get(key)
    if (!field) {
      fields.set(key, { tableName: finding.tableName, columnName: finding.columnName,
        fieldDescription: finding.fieldDescription, reference: finding.reference,
        tableRows: finding.tableRows, failed: finding.found })
      continue
    }
    field.failed += finding.found
    field.reference ??= finding.reference
  }
  return [...fields.values()]
}

export function StructureCheckPage() {
  const [log, setLog] = useState<ImportLogEntry[]>([])
  const [structure, setStructure] = useState<StructureCheckResult | null>(null)
  const [checkingZip, setCheckingZip] = useState('')
  const [level, setLevel] = useState<'all' | 'error' | 'warning'>('all')
  const [file, setFile] = useState('all')
  const [failing, setFailing] = useState<FailingRows | null>(null)
  const [codes, setCodes] = useState<ReferenceCodeList | null>(null)
  const [codesField, setCodesField] = useState('')
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [codesOffset, setCodesOffset] = useState({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const failingDialog = useRef<HTMLDialogElement>(null)
  const codesDialog = useRef<HTMLDialogElement>(null)

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
  useEffect(() => {
    const dialog = codesDialog.current
    if (!dialog) return
    if (codes && !dialog.open) { setCodesOffset({ x: 0, y: 0 }); dialog.showModal() }
    if (!codes && dialog.open) dialog.close()
  }, [codes])

  function moveModal(event: PointerEvent<HTMLElement>, move = setOffset, from = offset) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX - from.x
    const startY = event.clientY - from.y
    const onMove = (next: globalThis.PointerEvent) => move({ x: next.clientX - startX, y: next.clientY - startY })
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
    setCodes(null)
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

  async function showFailing(field: FieldSummary) {
    if (!structure) return
    setFailing(null)
    try {
      setFailing(await window.api.failingRows(structure.zipName, field.tableName, field.columnName))
    } catch (reason: unknown) {
      setError(String(reason))
    }
  }

  async function showCodes(field: FieldSummary) {
    if (!field.reference) return
    setCodes(null)
    setCodesField(`${field.tableName.toUpperCase()}.${field.columnName.toUpperCase()}`)
    try {
      setCodes(await window.api.referenceCodes(field.reference))
    } catch (reason: unknown) {
      setError(String(reason))
    }
  }

  const issueFiles = [...new Set(structure?.findings.map((finding) => finding.tableName) ?? [])]
    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' }))
  const findings = structure?.findings.filter((finding) =>
    (level === 'all' || finding.level === level) && (file === 'all' || finding.tableName === file)) ?? []
  const fields = summarize(findings)
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
          <thead><tr><th>แฟ้ม</th><th>ฟิลด์</th><th>รายละเอียด</th><th className="col-right">จำนวนแถว</th><th className="col-right">ผ่าน</th><th className="col-right">ร้อยละ</th><th className="col-right">ไม่ผ่าน</th></tr></thead>
          <tbody>
            {fields.map((field) => <tr key={`${field.tableName}-${field.columnName}`}>
              <td className="code-cell"><code>{field.tableName.toUpperCase()}</code></td>
              <td className="name-cell">{field.reference
                ? <button type="button" className="link-button" title={`ดูรหัสที่ใช้ได้จาก ${field.reference}`}
                    onClick={() => void showCodes(field)}><strong>{field.columnName.toUpperCase()}</strong></button>
                : <strong>{field.columnName.toUpperCase()}</strong>}</td>
              <td className="field-description">{field.fieldDescription || '-'}</td>
              <td className="col-right num-cell">{field.tableRows.toLocaleString('en-US')}</td>
              <td className="col-right num-cell">{(field.tableRows - field.failed).toLocaleString('en-US')}</td>
              <td className="col-right num-cell">{field.tableRows ? (((field.tableRows - field.failed) / field.tableRows) * 100).toFixed(2) : '-'}</td>
              <td className="col-right num-cell"><button type="button" className="link-button"
                title={`ดูแถวที่ไม่ผ่านของ ${field.tableName.toUpperCase()}.${field.columnName.toUpperCase()}`}
                onClick={() => void showFailing(field)}><strong>{field.failed.toLocaleString('en-US')}</strong></button></td>
            </tr>)}
          </tbody>
        </SortableTable>
      </div>}
      {!structure.findings.length && <p className="hint-text">ข้อมูลผ่านทุกเกณฑ์ตามโครงสร้าง</p>}
      {!!structure.findings.length && !findings.length && <p className="hint-text">ไม่พบรายการตามตัวกรองที่เลือก</p>}
    </>}

    <dialog className="large-modal" aria-label="รหัสมาตรฐานของฟิลด์" ref={codesDialog} onClose={() => setCodes(null)}
      style={{ translate: `${codesOffset.x}px ${codesOffset.y}px` }}
      onClick={(event) => { if (event.target === codesDialog.current) setCodes(null) }}>
      {codes && <>
        <header onPointerDown={(event) => moveModal(event, setCodesOffset, codesOffset)}>
          <div>
            <strong>รหัสที่ใช้ได้ — {codesField}</strong>
            <small><code>{codes.table}</code> · {codes.rows.length.toLocaleString('en-US')} รหัส</small>
          </div>
          <button type="button" className="modal-close" aria-label="ปิด" title="ปิด" onClick={() => setCodes(null)}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="table-wrapper">
          <SortableTable className="data-table" aria-label={`รหัสมาตรฐานใน ${codes.table}`}>
            <thead><tr>{codes.columns.map((name) => <th key={name}>{name.toUpperCase()}</th>)}</tr></thead>
            <tbody>
              {codes.rows.map((row) => <tr key={row[0]}>
                {row.map((value, column) => <td key={codes.columns[column]}
                  className={column === 0 ? 'code-cell' : ''}>{column === 0 ? <code>{value}</code> : value}</td>)}
              </tr>)}
            </tbody>
          </SortableTable>
        </div>
      </>}
    </dialog>

    <dialog className="large-modal" aria-label="แถวที่ไม่ผ่านเกณฑ์" ref={failingDialog} onClose={() => setFailing(null)}
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
                {row.map((value, column) => <td key={failing.columns[column]}
                  className={column === failing.columns.length - 1 ? '' : 'num-cell'}>{value === '' ? <em>(ว่าง)</em> : value}</td>)}
              </tr>)}
            </tbody>
          </SortableTable>
        </div>
      </>}
    </dialog>
  </>
}
