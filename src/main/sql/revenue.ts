import type { PGlite } from '@electric-sql/pglite'
import type { RevenueItem, RevenueReport } from '../../shared/api'

export const STANDARD_FUNDS = [
  'ผู้ป่วยนอก (OP) สปสช.',
  'ผู้ป่วยใน (IP) สปสช.',
  'ส่งเสริมป้องกันโรค (PP)',
  'ประกันสังคม',
  'กรมบัญชีกลาง (เบิกจ่ายตรง)',
  'ชำระเงินเอง',
] as const

interface FundSummaryRow {
  fund: string
  claimed: number
  approved: number
}

function parseYearMonth(monthStr: string): { ym6: string; displayMonth: string } {
  const clean = monthStr.replace(/[^0-9]/g, '')
  if (clean.length >= 6) {
    const y = parseInt(clean.slice(0, 4), 10)
    const m = clean.slice(4, 6)
    if (y > 2500) {
      const christianYear = y - 543
      return {
        ym6: `${christianYear}${m}`,
        displayMonth: `${y}-${m}`,
      }
    } else {
      const thaiYear = y + 543
      return {
        ym6: `${y}${m}`,
        displayMonth: `${thaiYear}-${m}`,
      }
    }
  }

  const now = new Date()
  const cYear = now.getFullYear()
  const tYear = cYear + 543
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return {
    ym6: `${cYear}${m}`,
    displayMonth: `${tYear}-${m}`,
  }
}

/**
 * Queries revenue data aggregated from `charge_opd` and `charge_ipd` 43-file tables
 * for a specific month (YYYY-MM). If no data exists, fields are returned as null.
 */
export async function getRevenueReport(db: PGlite, month: string): Promise<RevenueReport> {
  const { ym6, displayMonth } = parseYearMonth(month)

  // 1. Find all available months in charge_opd and charge_ipd
  const { rows: monthRows } = await db.query<{ ym: string }>(`
    SELECT DISTINCT SUBSTRING(d, 1, 6) AS ym
    FROM (
      SELECT date_serv AS d FROM charge_opd WHERE date_serv ~ '^[0-9]{6}'
      UNION ALL
      SELECT LEFT(datetime_admit, 6) AS d FROM charge_ipd WHERE datetime_admit ~ '^[0-9]{6}'
    ) sub
    ORDER BY ym DESC
  `)

  const dbMonths = monthRows
    .map((r) => {
      const year = parseInt(r.ym.slice(0, 4), 10)
      const m = r.ym.slice(4, 6)
      const thaiYear = year > 2500 ? year : year + 543
      return `${thaiYear}-${m}`
    })
    .filter((m) => m.length === 7)

  // Default fallback months if no data in db
  const defaultMonths = ['2569-08', '2569-07', '2569-06']
  const availableMonths = Array.from(new Set([displayMonth, ...dbMonths, ...defaultMonths])).sort((a, b) =>
    b.localeCompare(a)
  )

  // 2. Query revenue grouped by fund for the target month
  const { rows: queryRows } = await db.query<FundSummaryRow>(`
    WITH opd AS (
      SELECT
        CASE
          WHEN instype LIKE '4%' OR instype LIKE '5%' THEN 'ประกันสังคม'
          WHEN instype LIKE '1%' OR instype LIKE '2%' OR instype LIKE '3%' THEN 'กรมบัญชีกลาง (เบิกจ่ายตรง)'
          WHEN instype LIKE '7%' OR instype LIKE '8%' OR instype LIKE '9%' THEN 'ชำระเงินเอง'
          WHEN chargeitem IN ('14', '15', '16') THEN 'ส่งเสริมป้องกันโรค (PP)'
          ELSE 'ผู้ป่วยนอก (OP) สปสช.'
        END AS fund,
        COALESCE(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric, 0) AS price,
        COALESCE(NULLIF(regexp_replace(payprice, '[^0-9.]', '', 'g'), '')::numeric, 0) AS payprice
      FROM charge_opd
      WHERE SUBSTRING(date_serv, 1, 6) = $1
    ),
    ipd AS (
      SELECT
        CASE
          WHEN instype LIKE '4%' OR instype LIKE '5%' THEN 'ประกันสังคม'
          WHEN instype LIKE '1%' OR instype LIKE '2%' OR instype LIKE '3%' THEN 'กรมบัญชีกลาง (เบิกจ่ายตรง)'
          WHEN instype LIKE '7%' OR instype LIKE '8%' OR instype LIKE '9%' THEN 'ชำระเงินเอง'
          ELSE 'ผู้ป่วยใน (IP) สปสช.'
        END AS fund,
        COALESCE(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric, 0) AS price,
        COALESCE(NULLIF(regexp_replace(payprice, '[^0-9.]', '', 'g'), '')::numeric, 0) AS payprice
      FROM charge_ipd
      WHERE SUBSTRING(datetime_admit, 1, 6) = $1
    ),
    all_charges AS (
      SELECT * FROM opd
      UNION ALL
      SELECT * FROM ipd
    )
    SELECT
      fund,
      ROUND(SUM(price))::bigint AS claimed,
      ROUND(SUM(payprice))::bigint AS approved
    FROM all_charges
    GROUP BY fund
  `, [ym6])

  const fundMap = new Map<string, FundSummaryRow>()
  for (const row of queryRows) {
    fundMap.set(row.fund, {
      fund: row.fund,
      claimed: Number(row.claimed),
      approved: Number(row.approved),
    })
  }

  const hasRealData = queryRows.length > 0 && queryRows.some((r) => Number(r.claimed) > 0 || Number(r.approved) > 0)

  if (!hasRealData) {
    // Return blank data for all standard funds
    const items: RevenueItem[] = STANDARD_FUNDS.map((fund) => ({
      fund,
      claimed: null,
      approved: null,
      rejected: null,
      state: null,
    }))

    return {
      month: displayMonth,
      availableMonths,
      hasRealData: false,
      totalClaimed: null,
      totalApproved: null,
      totalRejected: null,
      passRate: null,
      items,
    }
  }

  let totalClaimed = 0
  let totalApproved = 0

  const items: RevenueItem[] = STANDARD_FUNDS.map((fund) => {
    const data = fundMap.get(fund)
    if (!data || (data.claimed === 0 && data.approved === 0)) {
      return {
        fund,
        claimed: null,
        approved: null,
        rejected: null,
        state: null,
      }
    }

    const claimed = data.claimed
    const approved = data.approved
    const rejected = Math.max(0, claimed - approved)
    totalClaimed += claimed
    totalApproved += approved

    let state: RevenueItem['state'] = 'passed'
    if (approved === 0 && claimed > 0) {
      state = 'pending'
    } else if (rejected > 0) {
      state = 'warning'
    }

    return {
      fund,
      claimed,
      approved,
      rejected,
      state,
    }
  })

  const totalRejected = Math.max(0, totalClaimed - totalApproved)
  const passRate = totalClaimed > 0 ? Math.round((totalApproved / totalClaimed) * 100) : 0

  return {
    month: displayMonth,
    availableMonths,
    hasRealData: true,
    totalClaimed,
    totalApproved,
    totalRejected,
    passRate,
    items,
  }
}
