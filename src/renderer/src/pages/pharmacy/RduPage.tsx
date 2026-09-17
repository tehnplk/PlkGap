import { useState } from 'react'
import { SortableTable } from '../../SortableTable'
import { Icon } from '../../Icon'

export interface RduIndicator {
  code: string
  name: string
  category: 'antibiotic' | 'ncd' | 'vulnerable'
  categoryName: string
  target: number
  operator: '<=' | '>='
  numerator: number
  denominator: number
  value: number
  files: string
  description: string
  formulaA: string
  formulaB: string
  recommendation: string
}

const RDU_INDICATORS: RduIndicator[] = [
  {
    code: 'RDU-01',
    name: 'ร้อยละการใช้ยาปฏิชีวนะในโรคติดเชื้อทางเดินหายใจส่วนบนเฉียบพลัน (URI & Acute Bronchitis)',
    category: 'antibiotic',
    categoryName: 'ยาปฏิชีวนะ',
    target: 20,
    operator: '<=',
    numerator: 142,
    denominator: 890,
    value: 15.96,
    files: 'drug_opd, diagnosis_opd',
    description: 'ร้อยละของผู้ป่วยนอกที่ได้รับการวินิจฉัยโรคติดเชื้อทางเดินหายใจส่วนบน (J00-J06, J20-J21) ที่ได้รับยาปฏิชีวนะ',
    formulaA: 'จำนวนผู้ป่วยนอก URI ที่ได้รับยาปฏิชีวนะอย่างน้อย 1 รายการ',
    formulaB: 'จำนวนผู้ป่วยนอกทั้งหมดที่มารับบริการด้วยโรค URI ในช่วงเวลาเดียวกัน',
    recommendation: 'ส่งเสริมการวินิจฉัยแยกโรคติดเชื้อไวรัสและแบคทีเรีย และการให้สุขศึกษาแก่ผู้ป่วยเกี่ยวกับโรคหวัดที่หายเองได้โดยไม่ต้องใช้ยาปฏิชีวนะ',
  },
  {
    code: 'RDU-02',
    name: 'ร้อยละการใช้ยาปฏิชีวนะในโรคอุจจาระร่วงเฉียบพลัน (Acute Diarrhea)',
    category: 'antibiotic',
    categoryName: 'ยาปฏิชีวนะ',
    target: 20,
    operator: '<=',
    numerator: 78,
    denominator: 430,
    value: 18.14,
    files: 'drug_opd, diagnosis_opd',
    description: 'ร้อยละของผู้ป่วยนอกที่ได้รับการวินิจฉัยโรคอุจจาระร่วงเฉียบพลัน (A09) ที่ได้รับยาปฏิชีวนะ',
    formulaA: 'จำนวนผู้ป่วยนอกอุจจาระร่วงเฉียบพลันที่ได้รับยาปฏิชีวนะ',
    formulaB: 'จำนวนผู้ป่วยนอกทั้งหมดที่มารับบริการด้วยโรคอุจจาระร่วงเฉียบพลัน',
    recommendation: 'เน้นการรักษาภาวะขาดน้ำด้วยผงน้ำตาลเกลือแร่ (ORS) และพิจารณาให้ยาปฏิชีวนะเฉพาะรายที่มีข้อบ่งชี้ เช่น ถ่ายเป็นมูกเลือด หรือสงสัยอหิวาตกโรค',
  },
  {
    code: 'RDU-03',
    name: 'ร้อยละการใช้ยาปฏิชีวนะในบาดแผลสดจากอุบัติเหตุ (Fresh Traumatic Wound)',
    category: 'antibiotic',
    categoryName: 'ยาปฏิชีวนะ',
    target: 40,
    operator: '<=',
    numerator: 156,
    denominator: 340,
    value: 45.88,
    files: 'drug_opd, diagnosis_opd, procedure_opd',
    description: 'ร้อยละของผู้ป่วยนอกที่มารับการทำแผลสดจากอุบัติเหตุสะอาด ไม่เกิน 6 ชั่วโมง ที่ได้รับยาปฏิชีวนะ',
    formulaA: 'จำนวนผู้ป่วยแผลสดสะอาดที่ได้รับยาปฏิชีวนะ',
    formulaB: 'จำนวนผู้ป่วยแผลสดสะอาดที่มารับบริการทำแผลทั้งหมด',
    recommendation: 'บาดแผลสดสะอาดที่ได้รับการล้างแผลอย่างถูกวิธีและตัดแต่งเนื้อตาย ไม่มีความจำเป็นต้องให้ยาปฏิชีวนะป้องกันทุกราย',
  },
  {
    code: 'RDU-04',
    name: 'ร้อยละการใช้ยาปฏิชีวนะในหญิงคลอดปกติครบกำหนดทางช่องคลอด (Normal Labor)',
    category: 'antibiotic',
    categoryName: 'ยาปฏิชีวนะ',
    target: 10,
    operator: '<=',
    numerator: 6,
    denominator: 85,
    value: 7.06,
    files: 'drug_ipd, diagnosis_ipd, admission',
    description: 'ร้อยละของหญิงตั้งครรภ์คลอดปกติทางช่องคลอดที่ไม่มีภาวะแทรกซ้อนที่ได้รับยาปฏิชีวนะ',
    formulaA: 'จำนวนหญิงคลอดปกติที่ได้รับยาปฏิชีวนะ',
    formulaB: 'จำนวนหญิงคลอดปกติทางช่องคลอดทั้งหมด',
    recommendation: 'หญิงคลอดปกติที่ไม่มีถุงน้ำคร่ำแตกก่อนคลอดนานเกิน 18 ชม. หรือไม่มีไข้ ไม่จำเป็นต้องได้รับยาปฏิชีวนะแบบป้องกัน',
  },
  {
    code: 'RDU-05',
    name: 'ร้อยละของผู้ป่วยโรคไตเรื้อรังระยะ 3-5 (CKD Stage 3-5) ที่ได้รับยา NSAIDs',
    category: 'ncd',
    categoryName: 'โรคเรื้อรัง NCD',
    target: 0,
    operator: '<=',
    numerator: 8,
    denominator: 620,
    value: 1.29,
    files: 'drug_opd, chronic, diagnosis_opd',
    description: 'ร้อยละของผู้ป่วย CKD Stage 3 ขึ้นไปที่ได้รับยากลุ่ม NSAIDs ซึ่งมีพิษต่อไต',
    formulaA: 'จำนวนผู้ป่วย CKD Stage 3-5 ที่ได้รับยา NSAIDs ในช่วงงวดประเมิน',
    formulaB: 'จำนวนผู้ป่วย CKD Stage 3-5 ที่ขึ้นทะเบียนรับการรักษาทั้งหมด',
    recommendation: 'ตั้งระบบแจ้งเตือน (Alert pop-up) ในระบบ HIS ทันทีเมื่อมีการสั่งจ่ายยา NSAIDs ให้แก่ผู้ป่วยที่มีประวัติไตบกพร่อง',
  },
  {
    code: 'RDU-06',
    name: 'ร้อยละของผู้ป่วยเบาหวาน/ความดันโลหิตสูง ที่ได้รับยากลุ่ม RAS Blockers ร่วมกันซ้ำซ้อน (ACEI + ARB)',
    category: 'ncd',
    categoryName: 'โรคเรื้อรัง NCD',
    target: 0,
    operator: '<=',
    numerator: 2,
    denominator: 1450,
    value: 0.14,
    files: 'drug_opd, chronic, diagnosis_opd',
    description: 'ร้อยละของผู้ป่วย DM/HT ที่ได้รับยา ACEI และ ARB ร่วมกันในครั้งเดียวกัน ซึ่งเพิ่มความเสี่ยงต่อภาวะโพแทสเซียมในเลือดสูงและไตวายเฉียบพลัน',
    formulaA: 'จำนวนผู้ป่วย DM/HT ที่ได้รับยา ACEI ร่วมกับ ARB ซ้ำซ้อน',
    formulaB: 'จำนวนผู้ป่วย DM/HT ทั้งหมดที่ได้รับยากลุ่มลดความดันโลหิต',
    recommendation: 'ตรวจสอบรายการยาซ้ำซ้อนในห้องยาและปรับปรุงระบบคอมพิวเตอร์เตือน Drug Interaction/Duplication',
  },
  {
    code: 'RDU-07',
    name: 'ร้อยละของผู้สูงอายุ (≥ 65 ปี) ที่ได้รับยากลุ่ม Long-acting Benzodiazepines',
    category: 'vulnerable',
    categoryName: 'กลุ่มเสี่ยง/ผู้สูงอายุ',
    target: 5,
    operator: '<=',
    numerator: 46,
    denominator: 980,
    value: 4.69,
    files: 'drug_opd, person, service',
    description: 'ร้อยละของผู้สูงอายุที่ได้รับยา Diazepam, Clonazepam หรือ Chlordiazepoxide ซึ่งเพิ่มความเสี่ยงต่อการพลัดตกหกล้มและการรู้คิดบกพร่อง',
    formulaA: 'จำนวนผู้สูงอายุที่ได้รับยา Long-acting Benzodiazepines',
    formulaB: 'จำนวนผู้สูงอายุที่มารับบริการผู้ป่วยนอกทั้งหมด',
    recommendation: 'พิจารณาใช้ยานอนหลับหรือยากลายกังวลกลุ่ม Non-pharmacologic หรือยากลุ่ม Short/Intermediate-acting ในขนาดต่ำสุดที่จำเป็น',
  },
  {
    code: 'RDU-08',
    name: 'ร้อยละการสั่งใช้ยาปฏิชีวนะกลุ่มเสี่ยงสูง (Watch Group Antibiotics) ในผู้ป่วยนอก',
    category: 'antibiotic',
    categoryName: 'ยาปฏิชีวนะ',
    target: 15,
    operator: '<=',
    numerator: 88,
    denominator: 720,
    value: 12.22,
    files: 'drug_opd, diagnosis_opd',
    description: 'ร้อยละของผู้ป่วยนอกที่ได้รับยาปฏิชีวนะกลุ่ม Watch Group (เช่น Fluoroquinolones, 3rd gen Cephalosporins, Macrolides)',
    formulaA: 'จำนวนผู้ป่วยนอกที่ได้รับยาปฏิชีวนะกลุ่ม Watch Group',
    formulaB: 'จำนวนผู้ป่วยนอกทั้งหมดที่ได้รับยาปฏิชีวนะ',
    recommendation: 'ส่งเสริมการใช้ยาปฏิชีวนะกลุ่ม Access Group เป็นลำดับแรกเพื่อป้องกันการดื้อยาปฏิชีวนะในชุมชน',
  },
]

export function RduPage() {
  const [year, setYear] = useState('2569')
  const [category, setCategory] = useState<'all' | 'antibiotic' | 'ncd' | 'vulnerable'>('all')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [selected, setSelected] = useState<RduIndicator | null>(null)

  const isPassed = (item: RduIndicator) =>
    item.operator === '<=' ? item.value <= item.target : item.value >= item.target

  const filtered = RDU_INDICATORS.filter((item) => {
    if (category !== 'all' && item.category !== category) return false
    if (onlyFailed && isPassed(item)) return false
    return true
  })

  const totalCount = RDU_INDICATORS.length
  const passedCount = RDU_INDICATORS.filter(isPassed).length
  const failedCount = totalCount - passedCount
  const passRate = Math.round((passedCount / totalCount) * 100)

  return (
    <>
      <div className="content-heading">
        <div>
          <p className="eyebrow">ระบบเภสัชกรรม</p>
          <h2>RDU (การใช้ยาอย่างสมเหตุผล)</h2>
        </div>
        <span className={`badge ${failedCount > 0 ? '' : 'status-passed'}`}>
          ผ่านเกณฑ์ {passedCount}/{totalCount} ตัวชี้วัด ({passRate}%)
        </span>
      </div>
      <p>
        ติดตามและประเมินผลการดำเนินงานตามเกณฑ์การใช้ยาอย่างสมเหตุผล (Rational Drug Use) ประจำปีงบประมาณ
        เชื่อมโยงข้อมูลจากแฟ้มเวชระเบียนผู้ป่วยนอกและบริการจ่ายยา (แฟ้ม drug_opd, diagnosis_opd, chronic)
      </p>

      <div className="stat-grid">
        <div className="stat-card">
          <small>ตัวชี้วัดทั้งหมด</small>
          <strong>{totalCount} ตัวชี้วัด</strong>
        </div>
        <div className="stat-card">
          <small>ผ่านเกณฑ์เป้าหมาย</small>
          <strong style={{ color: 'var(--theme-accent-color, #278344)' }}>{passedCount} รายการ</strong>
        </div>
        <div className="stat-card">
          <small>ไม่ผ่าน / ต้องปรับปรุง</small>
          <strong style={{ color: failedCount > 0 ? '#a83030' : 'inherit' }}>{failedCount} รายการ</strong>
        </div>
        <div className="stat-card">
          <small>อัตราผ่านเกณฑ์เฉลี่ย</small>
          <strong>{passRate}%</strong>
          <div className="progress">
            <span style={{ width: `${passRate}%` }} />
          </div>
        </div>
      </div>

      <div className="toolbar-row">
        <label htmlFor="rdu-year">ปีงบประมาณ</label>
        <select
          id="rdu-year"
          className="mock-select"
          value={year}
          onChange={(event) => setYear(event.target.value)}
        >
          <option value="2569">ปีงบประมาณ 2569</option>
          <option value="2568">ปีงบประมาณ 2568</option>
          <option value="2567">ปีงบประมาณ 2567</option>
        </select>

        <label htmlFor="rdu-category">กลุ่มตัวชี้วัด</label>
        <select
          id="rdu-category"
          className="mock-select"
          value={category}
          onChange={(event) => setCategory(event.target.value as typeof category)}
        >
          <option value="all">ทุกกลุ่มตัวชี้วัด</option>
          <option value="antibiotic">ยาปฏิชีวนะ (Antibiotics)</option>
          <option value="ncd">โรคเรื้อรัง (NCDs)</option>
          <option value="vulnerable">กลุ่มเสี่ยง / ผู้สูงอายุ</option>
        </select>

        <label className="mock-check" style={{ cursor: 'pointer', marginLeft: 8 }}>
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(event) => setOnlyFailed(event.target.checked)}
          />
          แสดงเฉพาะที่ไม่ผ่านเกณฑ์
        </label>
      </div>

      <p className="section-title">รายการตัวชี้วัด RDU ประจำปีงบประมาณ {year}</p>

      <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ตารางตัวชี้วัด RDU" maxVisibleRows={12}>
          <thead>
            <tr>
              <th className="col-center">รหัส</th>
              <th>ชื่อตัวชี้วัด</th>
              <th>กลุ่ม</th>
              <th className="col-right">เป้าหมาย</th>
              <th className="col-right">ตัวตั้ง (A)</th>
              <th className="col-right">ตัวหาร (B)</th>
              <th className="col-right">ผลงาน (%)</th>
              <th className="col-center">สถานะ</th>
              <th className="col-center">รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const passed = isPassed(item)
              return (
                <tr key={item.code}>
                  <td className="code-cell col-center">
                    <code>{item.code}</code>
                  </td>
                  <td className="name-cell">
                    <strong>{item.name}</strong>
                  </td>
                  <td>{item.categoryName}</td>
                  <td className="col-right num-cell" data-sort-value={item.target}>
                    {item.operator} {item.target}%
                  </td>
                  <td className="col-right num-cell" data-sort-value={item.numerator}>
                    {item.numerator.toLocaleString('en-US')}
                  </td>
                  <td className="col-right num-cell" data-sort-value={item.denominator}>
                    {item.denominator.toLocaleString('en-US')}
                  </td>
                  <td className="col-right num-cell" data-sort-value={item.value}>
                    <strong>{item.value.toFixed(2)}%</strong>
                  </td>
                  <td className="col-center">
                    <span className={`status-pill ${passed ? 'status-passed' : 'status-error'}`}>
                      {passed ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์'}
                    </span>
                  </td>
                  <td className="col-center">
                    <button
                      type="button"
                      className="mock-button"
                      onClick={() => setSelected(item)}
                      aria-label={`ดูรายละเอียด ${item.code}`}
                    >
                      <Icon name="list" size={13} />
                      สูตรคำนวณ
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </SortableTable>
      </div>

      {!filtered.length && (
        <p className="hint-text" style={{ marginTop: 12 }}>
          ไม่พบรายการตัวชี้วัดตามเงื่อนไขที่เลือก
        </p>
      )}

      {selected && (
        <dialog className="large-modal" open aria-label={`รายละเอียด ${selected.code}`}>
          <header>
            <div>
              <strong>
                {selected.code}: {selected.name}
              </strong>
              <small>เป้าหมายเกณฑ์: {selected.operator} {selected.target}% · แฟ้มข้อมูล: {selected.files}</small>
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={() => setSelected(null)}
              aria-label="ปิด"
            >
              <Icon name="close" size={16} />
            </button>
          </header>

          <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--theme-text, #30263f)' }}>
              {selected.description}
            </p>

            <dl className="detail-grid">
              <dt>สูตรตัวตั้ง (Numerator A)</dt>
              <dd>{selected.formulaA}</dd>

              <dt>สูตรตัวหาร (Denominator B)</dt>
              <dd>{selected.formulaB}</dd>

              <dt>แฟ้มข้อมูล 43 แฟ้ม</dt>
              <dd>
                <code>{selected.files}</code>
              </dd>

              <dt>ผลงานปัจจุบัน</dt>
              <dd>
                <strong>
                  {selected.numerator.toLocaleString('en-US')} / {selected.denominator.toLocaleString('en-US')} (
                  {selected.value.toFixed(2)}%)
                </strong>
                <span
                  className={`status-pill ${isPassed(selected) ? 'status-passed' : 'status-error'}`}
                  style={{ marginLeft: 8 }}
                >
                  {isPassed(selected) ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์'}
                </span>
              </dd>

              <dt>คำแนะนำทางเภสัชกรรม (RDU Advice)</dt>
              <dd style={{ color: 'var(--theme-text, #30263f)' }}>{selected.recommendation}</dd>
            </dl>
          </div>

          <div className="modal-actions">
            <div className="modal-actions-gap" />
            <button type="button" className="mock-button primary" onClick={() => setSelected(null)}>
              ปิดหน้าต่าง
            </button>
          </div>
        </dialog>
      )}
    </>
  )
}
