import { useCallback, useEffect, useState } from 'react'
import type { ImportCheck, ImportLogEntry } from '../../../../shared/api'
import { Icon } from '../../Icon'

const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
const megabytes = (bytes: number) => (bytes / 1048576).toFixed(2)
const statusLabel: Record<string, string> = { running: 'กำลังนำเข้า', complete: 'สำเร็จ', failed: 'ล้มเหลว' }
const statusStyle: Record<string, string> = { running: 'pending', complete: 'passed', failed: 'error' }

export function Import52FilePage() {
  const [path, setPath] = useState('')
  const [percent, setPercent] = useState(0)
  const [progress, setProgress] = useState('ยังไม่ได้เลือกไฟล์')
  const [check, setCheck] = useState<ImportCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [log, setLog] = useState<ImportLogEntry[]>([])
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    window.api.listImportLog()
      .then((rows) => { setLog(rows); setError('') })
      .catch((reason: unknown) => setError(String(reason)))
  }, [])
  useEffect(reload, [reload])

  const inspect = useCallback(async (target: string) => {
    setPath(target)
    setPercent(0)
    setCheck(null)
    setChecking(true)
    setProgress('กำลังตรวจไฟล์...')
    try {
      const result = await window.api.checkImportFile(target)
      setCheck(result)
      setProgress(result.valid ? 'ไฟล์ถูกต้อง ครบ 52 แฟ้ม พร้อมนำเข้า' : 'ไฟล์นี้นำเข้าไม่ได้')
    } catch (reason: unknown) {
      setCheck(null)
      setProgress(String(reason))
    } finally {
      setChecking(false)
    }
  }, [])

  async function browse() {
    const chosen = await window.api.chooseImportFile()
    if (chosen) await inspect(chosen)
  }

  function start() {
    setPercent(0)
    setProgress('ยังไม่ได้ต่อกับตัวนำเข้าจริง')
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
      <button type="button" className="mock-button primary" disabled={!check?.valid || checking} onClick={start}>
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
            <td className="col-center">
              <span className={`status-pill status-${statusStyle[row.status] ?? 'pending'}`}>{statusLabel[row.status] ?? row.status}</span>
            </td>
            <td className="col-center">
              <button type="button" className="mock-button" onClick={() => void inspect(row.filePath)}>ตรวจสอบคุณภาพโครงสร้าง</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {error && <p className="hint-text" role="alert">{error}</p>}
    {!error && !log.length && <p className="hint-text">ยังไม่มีประวัติการนำเข้า</p>}
  </>
}
