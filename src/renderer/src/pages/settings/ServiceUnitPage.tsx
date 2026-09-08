import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Hospital } from '../../../../shared/api'
import { Icon } from '../../Icon'

export function ServiceUnitPage() {
  const [hoscode, setHoscode] = useState('')
  const [unit, setUnit] = useState<Hospital | null>(null)
  const [message, setMessage] = useState('กรอกรหัสหน่วยบริการ (HCODE) แล้วกดค้นหา')
  const [searching, setSearching] = useState(false)

  async function search(event: FormEvent) {
    event.preventDefault()
    const code = hoscode.trim()
    if (!code) { setUnit(null); setMessage('กรุณากรอกรหัสหน่วยบริการก่อน'); return }
    setSearching(true)
    try {
      const found = await window.api.findHospital(code)
      setUnit(found)
      setMessage(found ? '' : `ไม่พบหน่วยบริการรหัส ${code} ในตาราง c_hospital`)
    } catch (reason: unknown) {
      setUnit(null)
      setMessage(String(reason))
    } finally {
      setSearching(false)
    }
  }

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ตั้งค่า</p>
        <h2>ตั้งค่าหน่วยบริการ</h2>
      </div>
      {unit && <span className="badge">รหัสหน่วยบริการ {unit.hospcode}</span>}
    </div>
    <form className="field-row" onSubmit={search}>
      <label htmlFor="unit-hoscode">รหัสหน่วยบริการ (HCODE)</label>
      <input id="unit-hoscode" className="mock-input" value={hoscode} maxLength={10} placeholder="เช่น 07476"
        onChange={(event) => setHoscode(event.target.value)} />
      <button type="submit" className="mock-button primary" disabled={searching}>
        <Icon name="hospital" size={15} />{searching ? 'กำลังค้นหา...' : 'ค้นหา'}
      </button>
    </form>

    {message && <p className="hint-text" role="status">{message}</p>}

    {unit && <>
      <dl className="detail-grid">
        <dt>ชื่อหน่วยบริการ</dt><dd>{unit.hospname || '-'}</dd>
        <dt>ชื่อย่อ</dt><dd>{unit.hospnameShort || '-'}</dd>
        <dt>ประเภทหน่วยบริการ</dt><dd>{unit.hostypeName || '-'} {unit.hostype && <code>{unit.hostype}</code>}</dd>
        <dt>หมู่ที่</dt><dd>{unit.mu || '-'}</dd>
        <dt>ตำบล</dt><dd>{unit.tambon || '-'}</dd>
        <dt>อำเภอ</dt><dd>{unit.ampur || '-'}</dd>
        <dt>จังหวัด</dt><dd>{unit.changwat || '-'}</dd>
      </dl>
      <div className="toolbar-row">
        <button type="button" className="mock-button primary">บันทึกเป็นหน่วยบริการของเครื่องนี้</button>
      </div>
    </>}
  </>
}
