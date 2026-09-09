import type { PGlite } from '@electric-sql/pglite'
import type { DatabaseStatus } from '../../shared/api'

export async function databaseStatus(db: PGlite, path: string): Promise<DatabaseStatus> {
  const { rows } = await db.query<Omit<DatabaseStatus, 'path'>>(`
    SELECT version() AS version, postgis_full_version() AS postgis,
      ST_AsText(ST_SetSRID(ST_MakePoint(100.2659, 16.8211), 4326)) AS geometry,
      (SELECT SUM(table_count) FROM schema_init WHERE component IN ('reference', 'structure_codes'))::int AS "referenceTables",
      (SELECT SUM(row_count) FROM schema_init WHERE component IN ('reference', 'structure_codes'))::int AS "referenceRows",
      (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN (SELECT file_name FROM c_file))::int AS "fileTables"
  `)
  return { ...rows[0], path }
}
