import { Icon } from '../../Icon'

interface Developer { name: string; position: string; organization: string }

const DEVELOPERS: Developer[] = [
  { name: 'นายสาธร สมบูรณ์', position: 'นักสาธารณสุขชำนาญการ', organization: 'สำนักงานสาธารณสุขจังหวัดพิษณุโลก' },
  { name: 'นายอุเทน จาดยางโทน', position: 'นักสาธารณสุขชำนาญการ', organization: 'สำนักงานสาธารณสุขจังหวัดพิษณุโลก' },
]

export function DevelopersPage() {
  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">เกี่ยวกับ</p>
        <h2>ผู้พัฒนา</h2>
      </div>
      <span className="badge">PlkGap</span>
    </div>
    <p>คณะผู้พัฒนาโปรแกรม PlkGap สำหรับงานตรวจสอบและวิเคราะห์ข้อมูล 43 แฟ้ม</p>

    <ol className="person-list">
      {DEVELOPERS.map((developer) => <li className="person-card" key={developer.name}>
        <span className="person-avatar"><Icon name="users" size={20} /></span>
        <span>
          <strong>{developer.name}</strong>
          <small>{developer.position}</small>
          <small>{developer.organization}</small>
        </span>
      </li>)}
    </ol>
  </>
}
