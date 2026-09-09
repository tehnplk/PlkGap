import type { PGlite } from '@electric-sql/pglite'

/** Village choices include facility and administrative codes to avoid merging equal village numbers. */
export async function listMessageVillages(db: PGlite): Promise<{ id: string; label: string }[]> {
  const { rows } = await db.query<{ id: string; label: string }>(`
    SELECT DISTINCT concat_ws('|', h.hospcode, h.changwat, h.ampur, h.tambon, h.village) AS id,
      'หมู่ที่ ' || h.village || ' · ต.' || COALESCE(t.name_th, h.tambon) ||
      ' อ.' || COALESCE(a.name_th, h.ampur) || ' · ' || h.hospcode AS label
    FROM home h
    LEFT JOIN c_subdistrict t ON t.changwat = h.changwat AND t.ampur = h.ampur AND t.tambon = h.tambon
    LEFT JOIN c_district a ON a.changwat = h.changwat AND a.ampur = h.ampur
    WHERE btrim(h.village) <> '' ORDER BY id`)
  return rows
}
