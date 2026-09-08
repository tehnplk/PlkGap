import { useState } from 'react'
import { Icon } from '../../Icon'

export function ServiceUnitPage() {
  const [unit, setUnit] = useState({
    hcode: '10726',
    name: 'โรงพยาบาลส่งเสริมสุขภาพตำบลบ้านคลองเตย',
    type: 'รพ.สต.',
    province: 'พิษณุโลก',
    district: 'เมืองพิษณุโลก',
    subdistrict: 'ในเมือง',
    phone: '055-000000',
    email: 'plkgap@example.go.th',
  })
  function set(key: keyof typeof unit, value: string) { setUnit((current) => ({ ...current, [key]: value })) }

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">ตั้งค่า</p>
        <h2>ตั้งค่าหน่วยบริการ</h2>
      </div>
      <span className="badge">รหัสหน่วยบริการ {unit.hcode}</span>
    </div>
    <p>ข้อมูลพื้นฐานของหน่วยบริการ ใช้เป็นค่าตั้งต้นของทุกรายงานและทุกการเชื่อมต่อระบบภายนอก</p>

    <div className="form-grid">
      <label htmlFor="unit-hcode">รหัสหน่วยบริการ (HCODE)</label>
      <input id="unit-hcode" className="mock-input" value={unit.hcode} onChange={(event) => set('hcode', event.target.value)} />
      <label htmlFor="unit-name">ชื่อหน่วยบริการ</label>
      <input id="unit-name" className="mock-input" value={unit.name} onChange={(event) => set('name', event.target.value)} />
      <label htmlFor="unit-type">ประเภทหน่วยบริการ</label>
      <select id="unit-type" className="mock-select" value={unit.type} onChange={(event) => set('type', event.target.value)}>
        <option>รพ.สต.</option>
        <option>โรงพยาบาลชุมชน</option>
        <option>โรงพยาบาลทั่วไป</option>
        <option>ศูนย์บริการสาธารณสุข</option>
      </select>
      <label htmlFor="unit-province">จังหวัด</label>
      <input id="unit-province" className="mock-input" value={unit.province} onChange={(event) => set('province', event.target.value)} />
      <label htmlFor="unit-district">อำเภอ</label>
      <input id="unit-district" className="mock-input" value={unit.district} onChange={(event) => set('district', event.target.value)} />
      <label htmlFor="unit-subdistrict">ตำบล</label>
      <input id="unit-subdistrict" className="mock-input" value={unit.subdistrict} onChange={(event) => set('subdistrict', event.target.value)} />
      <label htmlFor="unit-phone">โทรศัพท์</label>
      <input id="unit-phone" className="mock-input" value={unit.phone} onChange={(event) => set('phone', event.target.value)} />
      <label htmlFor="unit-email">อีเมล</label>
      <input id="unit-email" className="mock-input" value={unit.email} onChange={(event) => set('email', event.target.value)} />
    </div>

    <div className="toolbar-row">
      <button type="button" className="mock-button primary"><Icon name="hospital" size={15} />บันทึกการตั้งค่า</button>
      <button type="button" className="mock-button">คืนค่าเดิม</button>
    </div>
    <div className="mock-note"><p>ข้อมูลตัวอย่าง (mockup) ยังไม่ได้บันทึกลงฐานข้อมูลจริง</p></div>
  </>
}
