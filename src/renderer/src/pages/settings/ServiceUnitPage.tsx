import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Hospital } from '../../../../shared/api'
import { Icon } from '../../Icon'

const STORAGE_KEY = 'plkgap:service-unit'

export function ServiceUnitPage() {
  const [hoscode, setHoscode] = useState('')
  const [unit, setUnit] = useState<Hospital | null>(null)
  const [message, setMessage] = useState('กรอกรหัสหน่วยบริการ (HCODE) แล้วกดค้นหา')
  const [searching, setSearching] = useState(false)
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Hospital
        if (parsed?.hospcode) {
          setUnit(parsed)
          setHoscode(parsed.hospcode)
          setSavedCode(parsed.hospcode)
          setMessage('หน่วยบริการปัจจุบันที่บันทึกไว้ในเครื่องนี้')
        }
      }
    } catch {
      // Ignore parse error
    }
  }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    setNotice(null)
    const code = hoscode.trim()
    if (!code) {
      setUnit(null)
      setMessage('กรุณากรอกรหัสหน่วยบริการก่อน')
      return
    }
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

  function handleSave() {
    if (!unit) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unit))
      setSavedCode(unit.hospcode)
      setNotice(`บันทึกหน่วยบริการ ${unit.hospname || unit.hospcode} (${unit.hospcode}) เป็นหน่วยบริการของเครื่องนี้เรียบร้อยแล้ว`)
    } catch (err) {
      setMessage(`ไม่สามารถบันทึกได้: ${String(err)}`)
    }
  }

  return (
    <>
      <div className="content-heading">
        <div>
          <p className="eyebrow">ตั้งค่า</p>
          <h2>ตั้งค่าหน่วยบริการ</h2>
        </div>
        {unit && (
          <span className={`badge ${savedCode === unit.hospcode ? 'status-passed' : ''}`}>
            {savedCode === unit.hospcode ? '✓ ' : ''}รหัสหน่วยบริการ {unit.hospcode}
          </span>
        )}
      </div>

      <form className="field-row" onSubmit={search}>
        <label htmlFor="unit-hoscode">รหัสหน่วยบริการ (HCODE)</label>
        <input
          id="unit-hoscode"
          className="mock-input"
          value={hoscode}
          maxLength={10}
          placeholder="เช่น 07476"
          onChange={(event) => {
            setHoscode(event.target.value)
            setNotice(null)
          }}
        />
        <button type="submit" className="mock-button primary" disabled={searching}>
          <Icon name="hospital" size={15} />
          {searching ? 'กำลังค้นหา...' : 'ค้นหา'}
        </button>
      </form>

      {notice && (
        <div
          role="status"
          style={{
            margin: '12px 0',
            padding: '10px 14px',
            background: '#e6f7ec',
            color: '#187740',
            borderRadius: '6px',
            border: '1px solid #b7ebd0',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          ✓ {notice}
        </div>
      )}

      {message && !notice && <p className="hint-text" role="status">{message}</p>}

      {unit && (
        <>
          <dl className="detail-grid">
            <dt>ชื่อหน่วยบริการ</dt>
            <dd>{unit.hospname || '-'}</dd>
            <dt>ชื่อย่อ</dt>
            <dd>{unit.hospnameShort || '-'}</dd>
            <dt>ประเภทหน่วยบริการ</dt>
            <dd>
              {unit.hostypeName || '-'} {unit.hostype && <code>{unit.hostype}</code>}
            </dd>
            <dt>หมู่ที่</dt>
            <dd>{unit.mu || '-'}</dd>
            <dt>ตำบล</dt>
            <dd>{unit.tambon || '-'}</dd>
            <dt>อำเภอ</dt>
            <dd>{unit.ampur || '-'}</dd>
            <dt>จังหวัด</dt>
            <dd>{unit.changwat || '-'}</dd>
          </dl>
          <div className="toolbar-row" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="mock-button primary"
              onClick={handleSave}
            >
              <Icon name="hospital" size={14} />
              {savedCode === unit.hospcode ? 'บันทึกแล้ว (คลิกเพื่อบันทึกซ้ำ)' : 'บันทึกเป็นหน่วยบริการของเครื่องนี้'}
            </button>
            {savedCode === unit.hospcode && (
              <span className="status-pill status-passed" style={{ padding: '4px 10px', fontSize: '11px' }}>
                ✓ บันทึกเป็นหน่วยบริการประจำเครื่องนี้แล้ว
              </span>
            )}
          </div>
        </>
      )}
    </>
  )
}
