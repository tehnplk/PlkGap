import type { PGlite } from '@electric-sql/pglite'
import type { BoundaryCollection, BoundaryLevel, Household } from '../../shared/api'
import geographyData from '../reference/geography.json'
import boundaryData from '../reference/boundaries.json'
import type { BoundaryData, GeographyData } from './types'
import { ensureInitTable, initializedVersion, recordInit } from './schema-state'
import { quote, versionOf } from './shared'

/** Outlines of one administrative level, as GeoJSON that Leaflet can draw directly. */
export async function listBoundaries(db: PGlite, level: BoundaryLevel): Promise<BoundaryCollection> {
  const table = { province: 'c_province', district: 'c_district', subdistrict: 'c_subdistrict' }[level]
  if (!table) throw new Error(`ไม่รู้จักระดับ ${level}`)
  const code = level === 'province' ? 'changwat'
    : level === 'district' ? "changwat || ampur"
    : "changwat || ampur || tambon"
  const { rows } = await db.query<{ collection: BoundaryCollection }>(`
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(json_build_object(
        'type', 'Feature',
        'properties', json_build_object('name', name_th, 'code', ${code}),
        'geometry', ST_AsGeoJSON(geom)::json)), '[]'::json)
    ) AS collection
    FROM ${quote(table)} WHERE geom IS NOT NULL`)
  return rows[0].collection
}

/**
 * Households that carry a usable coordinate. HOME stores latitude/longitude as text, so anything
 * that is not a number inside Thailand's bounding box is dropped rather than plotted in the sea.
 */
export async function listHouseholds(db: PGlite, limit = 50000): Promise<Household[]> {
  // HOME stores area codes, not names, so the geography lookup supplies them.
  const { rows } = await db.query<Household>(`
    SELECT h.hospcode, h.hid, h.house, h.village,
      COALESCE(t.name_th, '') AS "tambonName", COALESCE(a.name_th, '') AS "ampurName",
      h.latitude::float8 AS latitude, h.longitude::float8 AS longitude
    FROM home h
    LEFT JOIN c_subdistrict t ON t.changwat = h.changwat AND t.ampur = h.ampur AND t.tambon = h.tambon
    LEFT JOIN c_district a ON a.changwat = h.changwat AND a.ampur = h.ampur
    WHERE h.latitude ~ '^[0-9]+([.][0-9]+)?$' AND h.longitude ~ '^[0-9]+([.][0-9]+)?$'
      AND h.latitude::float8 BETWEEN 5 AND 21 AND h.longitude::float8 BETWEEN 96 AND 106
    LIMIT $1`, [limit])
  return rows
}

/**
 * The province/district/subdistrict lookup, keyed the way the 43 files code an address:
 * CHANGWAT + AMPUR + TAMBON. Data comes from `reference/geography.json`
 * (see `scripts/pull-geography.mjs`); like the c_* tables it is upstream-only, so a newer file
 * replaces the whole set.
 */
export async function loadGeographyTables(db: PGlite, data: GeographyData = geographyData as GeographyData,
  boundaries: BoundaryData = boundaryData as BoundaryData) {
  await ensureInitTable(db)
  const version = `${versionOf(data)}+${boundaries.pulledAt}`
  const done = await initializedVersion(db, 'geography')
  if (done?.version === version) return { ...done, applied: false }

  await db.exec(`DROP TABLE IF EXISTS c_province CASCADE; DROP TABLE IF EXISTS c_district CASCADE;
    DROP TABLE IF EXISTS c_subdistrict CASCADE;
    CREATE TABLE c_province (changwat varchar(2) PRIMARY KEY, name_th text NOT NULL, name_en text NOT NULL);
    CREATE TABLE c_district (changwat varchar(2) NOT NULL, ampur varchar(2) NOT NULL, code varchar(4) NOT NULL,
      name_th text NOT NULL, name_en text NOT NULL, postal_code varchar(5) NOT NULL DEFAULT '',
      PRIMARY KEY (changwat, ampur));
    CREATE TABLE c_subdistrict (changwat varchar(2) NOT NULL, ampur varchar(2) NOT NULL, tambon varchar(2) NOT NULL,
      code varchar(6) NOT NULL, name_th text NOT NULL, name_en text NOT NULL,
      postal_code varchar(5) NOT NULL DEFAULT '', PRIMARY KEY (changwat, ampur, tambon));
    ALTER TABLE c_province ADD COLUMN geom geometry(MultiPolygon, 4326);
    ALTER TABLE c_district ADD COLUMN geom geometry(MultiPolygon, 4326);
    ALTER TABLE c_subdistrict ADD COLUMN geom geometry(MultiPolygon, 4326);`)

  const insert = async (sql: string, rows: unknown[][], columns: number) => {
    const perBatch = Math.max(1, Math.floor(5000 / columns))
    for (let index = 0; index < rows.length; index += perBatch) {
      const batch = rows.slice(index, index + perBatch)
      const values: unknown[] = []
      const placeholders = batch.map((row) => {
        const slots = row.map((value) => { values.push(value); return `$${values.length}` })
        return `(${slots.join(', ')})`
      })
      await db.query(`${sql} ${placeholders.join(', ')}`, values)
    }
  }
  await insert('INSERT INTO c_province (changwat, name_th, name_en) VALUES',
    data.provinces.map((row) => [row.changwat, row.nameTh, row.nameEn]), 3)
  await insert('INSERT INTO c_district (changwat, ampur, code, name_th, name_en, postal_code) VALUES',
    data.districts.map((row) => [row.changwat, row.ampur, row.code, row.nameTh, row.nameEn, row.postalCode]), 6)
  await insert('INSERT INTO c_subdistrict (changwat, ampur, tambon, code, name_th, name_en, postal_code) VALUES',
    data.subdistricts.map((row) => [row.changwat, row.ampur, row.tambon, row.code, row.nameTh, row.nameEn, row.postalCode]), 7)

  // Boundaries cover one province, so they are matched onto the country-wide name rows rather
  // than loaded as tables of their own.
  const shape = async (sql: string, rows: { geom: unknown }[], keys: (row: never) => unknown[]) => {
    for (const row of rows) {
      await db.query(sql, [...keys(row as never), JSON.stringify(row.geom)])
    }
    return rows.length
  }
  const shaped = await shape(
    'UPDATE c_province SET geom = ST_Multi(ST_GeomFromGeoJSON($2)) WHERE changwat = $1',
    boundaries.provinces, (row: { changwat: string }) => [row.changwat])
    + await shape('UPDATE c_district SET geom = ST_Multi(ST_GeomFromGeoJSON($3)) WHERE changwat = $1 AND ampur = $2',
      boundaries.districts, (row: { changwat: string; ampur: string }) => [row.changwat, row.ampur])
    + await shape(`UPDATE c_subdistrict SET geom = ST_Multi(ST_GeomFromGeoJSON($4))
        WHERE changwat = $1 AND ampur = $2 AND tambon = $3`,
      boundaries.subdistricts,
      (row: { changwat: string; ampur: string; tambon: string }) => [row.changwat, row.ampur, row.tambon])
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_c_province_geom ON c_province USING GIST (geom);
    CREATE INDEX IF NOT EXISTS idx_c_district_geom ON c_district USING GIST (geom);
    CREATE INDEX IF NOT EXISTS idx_c_subdistrict_geom ON c_subdistrict USING GIST (geom);`)

  const total = data.provinces.length + data.districts.length + data.subdistricts.length
  await recordInit(db, 'geography', version, 3, total)
  return { version, table_count: 3, row_count: total, shaped, applied: true }
}
