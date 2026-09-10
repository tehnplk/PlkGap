import { useCallback, useEffect, useState } from 'react'
import { SortableTable } from '../../SortableTable'
import { Icon } from '../../Icon'
import type { D506Item, D506Report } from '../../../../shared/api'

// ข้อมูลตัวอย่าง (Mockup) สำหรับแสดงผลเมื่อยังไม่ได้นำเข้าแฟ้ม SURVEILLANCE
const SAMPLE_DATA: D506Item[] = [
  { rank: 1, code506: '01', icd10: 'A09', name: 'อุจจาระร่วงเฉียบพลัน (Acute Diarrhea)', cases: 4820, deaths: 1, attackRate: 565.7, caseFatalityRate: 0.02, trend: 'stable' },
  { rank: 2, code506: '66', icd10: 'J09-J11', name: 'ไข้หวัดใหญ่ (Influenza)', cases: 3410, deaths: 2, attackRate: 400.2, caseFatalityRate: 0.06, trend: 'up' },
  { rank: 3, code506: '34', icd10: 'J12-J18', name: 'ปอดบวม/ปอดอักเสบ (Pneumonia)', cases: 1890, deaths: 8, attackRate: 221.8, caseFatalityRate: 0.42, trend: 'up' },
  { rank: 4, code506: '26', icd10: 'A90-A91', name: 'ไข้เลือดออก (Dengue Fever / DHF)', cases: 1250, deaths: 1, attackRate: 146.7, caseFatalityRate: 0.08, trend: 'down' },
  { rank: 5, code506: '15', icd10: 'B08.4', name: 'โรคมือเท้าปาก (Hand Foot Mouth)', cases: 980, deaths: 0, attackRate: 115.0, caseFatalityRate: 0.00, trend: 'stable' },
  { rank: 6, code506: '24', icd10: 'A05', name: 'อาหารเป็นพิษ (Food Poisoning)', cases: 840, deaths: 0, attackRate: 98.6, caseFatalityRate: 0.00, trend: 'stable' },
  { rank: 7, code506: '03', icd10: 'B01', name: 'สุกใส (Chickenpox)', cases: 620, deaths: 0, attackRate: 72.8, caseFatalityRate: 0.00, trend: 'down' },
  { rank: 8, code506: '02', icd10: 'B30', name: 'ตาแดงจากไวรัส (Viral Conjunctivitis)', cases: 490, deaths: 0, attackRate: 57.5, caseFatalityRate: 0.00, trend: 'down' },
  { rank: 9, code506: '18', icd10: 'A27', name: 'เลปโตสไปโรซิส (Leptospirosis)', cases: 210, deaths: 3, attackRate: 24.6, caseFatalityRate: 1.43, trend: 'up' },
  { rank: 10, code506: '13', icd10: 'B15-B19', name: 'ตับอักเสบจากไวรัส (Viral Hepatitis)', cases: 140, deaths: 0, attackRate: 16.4, caseFatalityRate: 0.00, trend: 'stable' },
]

const trendLabels: Record<D506Item['trend'], { label: string; className: string }> = {
  up: { label: 'ระบาดเพิ่มขึ้น', className: 'status-error' },
  stable: { label: 'เฝ้าระวังปกติ', className: 'status-warning' },
  down: { label: 'แนวโน้มลดลง', className: 'status-passed' },
}

export function D506Page() {
  const now = new Date()
  const defaultFiscalYear = String(now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0))
  const [year, setYear] = useState(defaultFiscalYear)
  const [report, setReport] = useState<D506Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [useSample, setUseSample] = useState(true)

  const loadData = useCallback(async (selectedYear: number) => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.getD506Report(selectedYear)
      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(Number(year))
  }, [year, loadData])

  const availableYears = report?.availableYears?.length
    ? report.availableYears.map(String)
    : ['2569', '2568', '2567']

  // ตรวจสอบว่าจะแสดงผลข้อมูลจริงหรือข้อมูลตัวอย่าง
  const hasRealData = Boolean(report?.hasRealData && report.items.length > 0)
  const isShowingSample = !hasRealData && useSample
  const displayItems = hasRealData ? report!.items : isShowingSample ? SAMPLE_DATA : []

  const totalCases = hasRealData
    ? report!.totalCases
    : isShowingSample
      ? SAMPLE_DATA.reduce((sum, d) => sum + d.cases, 0)
      : 0

  const totalDeaths = hasRealData
    ? report!.totalDeaths
    : isShowingSample
      ? SAMPLE_DATA.reduce((sum, d) => sum + d.deaths, 0)
      : 0

  const population = report?.population && report.population >= 1000 ? report.population : 852000
  const overallAttackRate = hasRealData
    ? report!.overallAttackRate
    : isShowingSample
      ? Number(((totalCases / population) * 100000).toFixed(1))
      : 0

  const caseFatalityRate = hasRealData
    ? report!.overallCfr
    : isShowingSample && totalCases > 0
      ? Number(((totalDeaths / totalCases) * 100).toFixed(2))
      : 0

  const maxCases = Math.max(...displayItems.map((d) => d.cases), 1)

  async function exportExcel() {
    if (!displayItems.length) return
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(
          displayItems.map((d) => ({
            'อันดับ': d.rank,
            'รหัส 506': d.code506,
            'รหัส ICD-10': d.icd10,
            'ชื่อโรคระบาด': d.name,
            'ผู้ป่วย (ราย)': d.cases,
            'อัตราป่วยต่อแสน': d.attackRate,
            'เสียชีวิต (ราย)': d.deaths,
            'อัตราป่วยตาย (%)': d.caseFatalityRate,
            'แนวโน้ม': trendLabels[d.trend].label,
          }))
        ),
        `10อันดับ506_ปี${year}`
      )
      const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
      await window.api.saveIndicatorWorkbook(`10อันดับโรคระบาด506_ปีงบ_${year}`, bytes)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">งานระบาดวิทยาควบคุมโรค</p>
        <h2>10 อันดับโรคระบาด 506</h2>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {hasRealData && <span className="badge" style={{ background: '#e1f5fe', color: '#0277bd', borderColor: '#81d4fa' }}>
          ✓ ข้อมูลจริงจากแฟ้ม SURVEILLANCE ({report?.totalSurveillanceRows.toLocaleString()} แถว)
        </span>}
        {!hasRealData && isShowingSample && <span className="badge" style={{ background: '#fff3e0', color: '#e65100', borderColor: '#ffb74d' }}>
          ข้อมูลตัวอย่าง (Mockup)
        </span>}
        <span className="badge">ปีงบประมาณ {year} · ผู้ป่วยรวม {totalCases.toLocaleString()} ราย</span>
      </div>
    </div>
    <p>ระบบรายงานและเฝ้าระวังโรคติดต่อทางระบาดวิทยา (รง. 506) ดึงข้อมูลจริงจากแฟ้ม SURVEILLANCE ในฐานข้อมูล</p>

    <div className="toolbar-row">
      <label htmlFor="d506-year">ปีงบประมาณ</label>
      <select id="d506-year" className="mock-select" value={year} disabled={loading} onChange={(event) => setYear(event.target.value)}>
        {availableYears.map((y) => (
          <option key={y} value={y}>ปีงบประมาณ {y}</option>
        ))}
      </select>

      <button type="button" className="mock-button primary" disabled={loading} onClick={() => void loadData(Number(year))}>
        <Icon name="activity" size={15} />
        {loading ? 'กำลังประมวลผลข้อมูลจริง...' : 'ประมวลผลข้อมูลจริง'}
      </button>

      <button type="button" className="mock-button" disabled={!displayItems.length} onClick={() => void exportExcel()}>
        <Icon name="list" size={15} />
        ส่งออก Excel
      </button>

      {!hasRealData && (
        <button type="button" className="mock-button" onClick={() => setUseSample(!useSample)}>
          {useSample ? 'ซ่อนข้อมูลตัวอย่าง' : 'ดูตัวอย่างเมื่อมีข้อมูล'}
        </button>
      )}
    </div>

    {error && <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>{error}</div>}

    {!loading && !hasRealData && !isShowingSample && (
      <div style={{
        background: '#ffffff',
        border: '1px dashed #bba4d6',
        borderRadius: '10px',
        padding: '36px 24px',
        textAlign: 'center',
        margin: '16px 0 24px',
        color: '#473655',
      }}>
        <div style={{ marginBottom: '12px', color: '#7843b5' }}>
          <Icon name="activity" size={42} />
        </div>
        <h3 style={{ margin: '0 0 8px', color: '#30263f' }}>ยังไม่มีข้อมูลในแฟ้ม SURVEILLANCE สำหรับปีงบประมาณ {year}</h3>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#6d607d' }}>
          ตาราง <code>surveillance</code> ในฐานข้อมูลขณะนี้มี {report?.totalSurveillanceRows ?? 0} แถว<br />
          เมื่อนำเข้าไฟล์ 52 แฟ้มที่มีแฟ้ม SURVEILLANCE ระบบจะดึงและจัดอันดับผู้ป่วย 10 อันดับแรกให้อัตโนมัติ
        </p>
        <button type="button" className="mock-button primary" onClick={() => setUseSample(true)}>
          คลิกเพื่อดูตัวอย่างหน้าจอ (Sample Data)
        </button>
      </div>
    )}

    {(hasRealData || isShowingSample) && <>
      <div className="stat-grid">
        <div className="stat-card">
          <small>ผู้ป่วย 10 อันดับสะสม</small>
          <strong>{totalCases.toLocaleString()}</strong>
        </div>
        <div className="stat-card">
          <small>โรคอันดับที่ 1</small>
          <strong style={{ fontSize: '15px', color: '#7843b5' }}>
            {displayItems[0]?.name.split(' (')[0] ?? '-'}
          </strong>
        </div>
        <div className="stat-card">
          <small>อัตราป่วยรวม (ต่อแสน)</small>
          <strong>{overallAttackRate}</strong>
        </div>
        <div className="stat-card">
          <small>เสียชีวิต / อัตราป่วยตาย</small>
          <strong>{totalDeaths} <span style={{ fontSize: '13px', fontWeight: 'normal', color: '#6d607d' }}>({caseFatalityRate}%)</span></strong>
        </div>
      </div>

      <p className="section-title">สัดส่วนผู้ป่วย 10 อันดับแรก (เปรียบเทียบตามจำนวนราย)</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', background: '#ffffff', padding: '16px 20px', borderRadius: '8px', border: '1px solid #e7ddf2' }}>
        {displayItems.map((d) => {
          const percent = Math.max(4, Math.round((d.cases / maxCases) * 100))
          return (
            <div key={d.code506} style={{ display: 'grid', gridTemplateColumns: '240px 1fr 110px', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#30263f' }} title={d.name}>
                <b>#{d.rank}</b> {d.name.split(' (')[0]}
              </span>
              <div style={{ background: '#f0ebf8', height: '14px', borderRadius: '7px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${percent}%`,
                    height: '100%',
                    background: d.rank === 1 ? 'linear-gradient(90deg, #7843b5, #995fe0)' : d.rank <= 3 ? '#9068be' : '#b298d4',
                    borderRadius: '7px',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <span style={{ textAlign: 'right', fontWeight: 600, color: '#473655' }}>
                {d.cases.toLocaleString()} ราย
              </span>
            </div>
          )
        })}
      </div>

      <div className="table-wrapper">
        <SortableTable className="data-table" aria-label="ตาราง 10 อันดับโรคระบาด 506">
          <thead>
            <tr>
              <th className="col-center" style={{ width: '60px' }}>อันดับ</th>
              <th style={{ width: '80px' }}>รหัส 506</th>
              <th style={{ width: '100px' }}>ICD-10</th>
              <th>ชื่อโรคระบาด 506</th>
              <th className="col-right">ผู้ป่วย (ราย)</th>
              <th className="col-right">อัตราป่วย (ต่อแสน)</th>
              <th className="col-right">เสียชีวิต (ราย)</th>
              <th className="col-right">อัตราป่วยตาย (%)</th>
              <th className="col-center" style={{ width: '130px' }}>แนวโน้ม</th>
            </tr>
          </thead>
          <tbody>
            {displayItems.map((d) => {
              const trendInfo = trendLabels[d.trend] ?? trendLabels.stable
              return (
                <tr key={d.code506}>
                  <td className="col-center num-cell" data-sort-value={d.rank}>
                    <strong>#{d.rank}</strong>
                  </td>
                  <td className="code-cell"><code>{d.code506}</code></td>
                  <td className="code-cell"><code>{d.icd10}</code></td>
                  <td className="name-cell"><strong>{d.name}</strong></td>
                  <td className="col-right num-cell" data-sort-value={d.cases}>
                    {d.cases.toLocaleString()}
                  </td>
                  <td className="col-right num-cell" data-sort-value={d.attackRate}>
                    {d.attackRate}
                  </td>
                  <td className="col-right num-cell" data-sort-value={d.deaths}>
                    {d.deaths}
                  </td>
                  <td className="col-right num-cell" data-sort-value={d.caseFatalityRate}>
                    {d.caseFatalityRate}%
                  </td>
                  <td className="col-center">
                    <span className={`status-pill ${trendInfo.className}`}>{trendInfo.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </SortableTable>
      </div>
    </>}

    <div className="mock-note">
      <p>
        ดึงข้อมูลจริงจากตาราง <code>surveillance</code> โดยนับจำนวนเคส (cases) จาก <code>illdate</code> / <code>date_serv</code> ในปีงบประมาณ และคำนวณอัตราป่วยร่วมกับแฟ้ม <code>person</code>
      </p>
    </div>
  </>
}
