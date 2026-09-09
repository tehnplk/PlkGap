import type { PGlite } from '@electric-sql/pglite'
import { ensureInitTable, initializedVersion, recordInit } from './schema-state'

/** Bump when a table below changes shape, so the new DDL runs once on the next start. */
export const APP_SCHEMA_VERSION = 'app@5'

/**
 * PlkGap's own system tables (`observ_check`, alongside the `schema_init` register) and log tables
 * (`import52files_log`, `structure_check_log`), as opposed to the code lists and the 52 files.
 * `import52files_log` accumulates one row per import run, so this is additive only — never dropped.
 */
export async function createAppTables(db: PGlite) {
  await ensureInitTable(db)
  const done = await initializedVersion(db, 'app')
  if (done?.version === APP_SCHEMA_VERSION) return { ...done, applied: false }

  await db.exec(`CREATE TABLE IF NOT EXISTS import52files_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_size bigint NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running',
    progress_percent integer NOT NULL DEFAULT 0,
    row_count integer NOT NULL DEFAULT 0,
    message text NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_import52files_log_started ON import52files_log (started_at DESC);

  -- Purely derived from the imported rows, so unlike the import history it can be rebuilt.
  DROP TABLE IF EXISTS structure_check_log CASCADE;
  CREATE TABLE structure_check_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zip_name text NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now(),
    table_name text NOT NULL,
    column_name text NOT NULL,
    rule text NOT NULL,
    detail text NOT NULL DEFAULT '',
    found integer NOT NULL DEFAULT 0,
    level text NOT NULL DEFAULT 'error',
    table_rows integer NOT NULL DEFAULT 0,
    row_count integer NOT NULL DEFAULT 0,
    rule_count integer NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_structure_check_log_zip ON structure_check_log (zip_name, table_name);

  -- The register of observation rules. Rows are seeded from observationRules() by
  -- syncObservationRules(); the SQL of a rule stays in code, only its wording, order and the
  -- on/off switch live here, so is_active is the one column the seeding never overwrites.
  CREATE TABLE IF NOT EXISTS observ_check (
    rule_id text PRIMARY KEY,
    table_name text NOT NULL,
    detail text NOT NULL,
    level text NOT NULL DEFAULT 'error',
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true
  );`)
  await recordInit(db, 'app', APP_SCHEMA_VERSION, 3, 0)
  return { version: APP_SCHEMA_VERSION, table_count: 3, row_count: 0, applied: true }
}
