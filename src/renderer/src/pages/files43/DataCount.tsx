import { SortableTable } from '../../SortableTable'
import { useCallback, useEffect, useState } from 'react'
import type { DataCountResult } from '../../../../shared/api'

const MONTHS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.']

/** Thai fiscal year: October starts the next one. */
function currentFiscalYear() {
  const now = new Date()
  return now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0)
}

/** The busiest file, so the page shows something useful the moment it opens. */
const DEFAULT_FILE = 'service'

export function DataCount() {
  const [table, setTable] = useState(DEFAULT_FILE)
  const [files, setFiles] = useState<string[]>([])
  const [count, setCount] = useState<DataCountResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.listStandardFiles().then(setFiles).catch((reason: unknown) => setError(String(reason)))
  }, [])

  const load = useCallback(async (target: string) => {
    if (!target) { setCount(null); return }
    setBusy(true)
    const years = Array.from({ length: 5 }, (_unused, index) => currentFiscalYear() - index)
    try {
      setCount(await window.api.countByFiscalYears(target, years))
      setError('')
    } catch (reason: unknown) {
      setCount(null)
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => { void load(DEFAULT_FILE) }, [load])

  const grand = count?.years.reduce((sum, year) => sum + year.total, 0) ?? 0

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ระบบ 43 แฟ้ม</p>
        <h2>ปริมาณข้อมูล</h2>
      </div>
      {count && <span className="badge">{grand.toLocaleString('en-US')} แถว</span>}
    </div>

    <div className="field-row">
      <label htmlFor="datacount-file">เลือกแฟ้ม</label>
      <select id="datacount-file" className="mock-select" value={table}
        onChange={(event) => { setTable(event.target.value); void load(event.target.value) }}>
        {files.map((name) => <option key={name} value={name}>{name.toUpperCase()}</option>)}
      </select>
    </div>

    {error && <p className="hint-text" role="alert">{error}</p>}
    {!error && !count && <p className="hint-text">{busy ? 'กำลังนับ...' : 'กำลังเตรียมข้อมูล...'}</p>}

    {count && <>
      <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ปริมาณข้อมูลรายปีงบ">
          <thead>
            <tr>
              <th className="col-right">ปีงบ</th>
              {!count.cumulative && MONTHS.map((month) => <th key={month} className="col-right">{month}</th>)}
              <th className="col-right">รวม</th>
            </tr>
          </thead>
          <tbody>
            {count.years.map((year) => <tr key={year.fiscalYear}>
              <td className="col-right num-cell"><strong>{year.fiscalYear}</strong></td>
              {!count.cumulative && year.months.map((value, index) => <td key={MONTHS[index]} className="col-right num-cell" data-sort-value={value}>
                {value ? value.toLocaleString('en-US') : '-'}
              </td>)}
              <td className="col-right num-cell"><strong>{year.total.toLocaleString('en-US')}</strong></td>
            </tr>)}
          </tbody>
        </SortableTable>
      </div>
      <p className="hint-text">นับจากคอลัมน์ <code>{count.column}</code> ของแฟ้ม <code>{count.table}</code></p>
    </>}
  </>
}
