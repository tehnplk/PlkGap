import type { PGlite } from '@electric-sql/pglite'

/**
 * Records what has already been set up, so the schema is built once — on the first run of a
 * fresh install — and every later start only reads one row per component.
 */
export async function ensureInitTable(db: PGlite) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_init (
    component text PRIMARY KEY,
    version text NOT NULL,
    table_count integer NOT NULL,
    row_count integer NOT NULL,
    initialized_at timestamptz NOT NULL DEFAULT now()
  );
  DROP TABLE IF EXISTS reference_load CASCADE;`)
}

export async function initializedVersion(db: PGlite, component: string) {
  const { rows } = await db.query<{ version: string; table_count: number; row_count: number }>(
    'SELECT version, table_count, row_count FROM schema_init WHERE component = $1', [component])
  return rows[0]
}

export async function recordInit(db: Pick<PGlite, 'query'>, component: string, version: string, tables: number, rows: number) {
  await db.query(`INSERT INTO schema_init (component, version, table_count, row_count)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (component) DO UPDATE
    SET version = EXCLUDED.version, table_count = EXCLUDED.table_count,
        row_count = EXCLUDED.row_count, initialized_at = now()`, [component, version, tables, rows])
}
