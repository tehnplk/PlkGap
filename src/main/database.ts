import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import type { DatabaseStatus } from '../shared/api'

export async function openDatabase(path: string) {
  const db = new PGlite(path, { extensions: { postgis } })
  try {
    await db.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
    return db
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}

export async function databaseStatus(db: PGlite, path: string): Promise<DatabaseStatus> {
  const { rows } = await db.query<Omit<DatabaseStatus, 'path'>>(`
    SELECT version() AS version, postgis_full_version() AS postgis,
      ST_AsText(ST_SetSRID(ST_MakePoint(100.2659, 16.8211), 4326)) AS geometry
  `)
  return { ...rows[0], path }
}
