import { createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { ensureInitTable, initializedVersion, recordInit } from './schema-state'
import { quote } from './shared'

/** One row of the answer to `GET /tables`. */
export interface TableSummary {
  table: string
  /** `file43` for the 52 standard files, `reference` for c_*, `app` for PlkGap's own, `postgis` for the extension's. */
  kind: 'file43' | 'reference' | 'app' | 'postgis'
  /** Only filled in when counting was asked for; null otherwise. */
  rowCount: number | null
}

/**
 * Every table in the database, tagged by which group it belongs to.
 * Counting is opt-in because an exact count of the 52 files is a full scan of tables holding every
 * row ever imported, and PGlite shares the main process with the windows — so the count runs under
 * the same read-only transaction and statement timeout as an API query.
 */
export async function listTables(db: PGlite, withCounts = false): Promise<TableSummary[]> {
  const { rows } = await db.query<{ table: string; kind: TableSummary['kind'] }>(`
    SELECT t.table_name AS "table",
      CASE WHEN t.table_name IN (SELECT file_name FROM c_file) THEN 'file43'
           WHEN t.table_name LIKE 'c\_%' THEN 'reference'
           WHEN t.table_name = 'spatial_ref_sys' THEN 'postgis'
           ELSE 'app' END AS kind
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY 2, 1`)
  if (!withCounts || !rows.length) return rows.map((row) => ({ ...row, rowCount: null }))

  const counted = await db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY')
    await tx.query(`SET LOCAL statement_timeout = '15s'`)
    const union = rows.map((row, index) =>
      `SELECT $${index + 1}::text AS t, COUNT(*)::int AS n FROM ${quote(row.table)}`).join(' UNION ALL ')
    return (await tx.query<{ t: string; n: number }>(union, rows.map((row) => row.table))).rows
  })
  const found = new Map(counted.map((row) => [row.t, row.n]))
  return rows.map((row) => ({ ...row, rowCount: found.get(row.table) ?? 0 }))
}

/** One column of the answer to `GET /desc/{table}`. */
export interface ColumnDescription {
  name: string
  type: string
  nullable: boolean
  default: string | null
  /** Thai field name and note from the 43-file dictionary; empty for tables it does not cover. */
  caption: string
  description: string
}

export interface TableDescription {
  table: string
  /** The file's own entry in `c_files_desc`, empty for anything that is not one of the 52. */
  description: string
  rowCount: number
  primaryKey: string[]
  indexes: string[]
  columns: ColumnDescription[]
}

/** Structure of one table in this database, with the Thai dictionary text where there is any. */
export async function describeTable(db: PGlite, table: string): Promise<TableDescription | null> {
  const name = table.trim().toLowerCase()
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) return null
  const { rows: present } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`, [name])
  if (!present[0]?.n) return null

  const { rows: columns } = await db.query<ColumnDescription>(`
    SELECT c.column_name AS name,
      c.data_type || COALESCE('(' || c.character_maximum_length || ')', '') AS type,
      c.is_nullable = 'YES' AS nullable, c.column_default AS "default",
      COALESCE(d.caption, '') AS caption, COALESCE(d.description, '') AS description
    FROM information_schema.columns c
    LEFT JOIN LATERAL (
      SELECT s.caption, s.description FROM c_files_schema s
      WHERE LOWER(s.table_name) = $1 AND LOWER(s.name) = c.column_name AND s.is_active = 1
      ORDER BY s.no LIMIT 1) d ON true
    WHERE c.table_schema = 'public' AND c.table_name = $1
    ORDER BY c.ordinal_position`, [name])
  const { rows: key } = await db.query<{ name: string }>(`
    SELECT a.attname AS name FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = to_regclass($1) AND i.indisprimary ORDER BY k.ord`, [name])
  const { rows: indexes } = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1
     ORDER BY indexname`, [name])
  const { rows: counted } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${quote(name)}`)
  const { rows: file } = await db.query<{ description: string }>(
    `SELECT description FROM c_files_desc WHERE LOWER(table_name) = $1 AND is_active = 1 LIMIT 1`, [name])

  return {
    table: name,
    description: file[0]?.description ?? '',
    rowCount: counted[0]?.n ?? 0,
    primaryKey: key.map((row) => row.name),
    indexes: indexes.map((row) => row.indexname),
    columns,
  }
}

/**
 * Columns `POST /sql` must never hand real values for. An entry without a table masks that column
 * name in every table it appears in; one with a table masks it there only.
 */
export const blockedApiColumns: { table?: string; column: string }[] = [
  { column: 'lname' },
  { column: 'cid' },
  { column: 'telephone' },
  { column: 'mobile' },
  { table: 'home', column: 'house' },
  { table: 'home', column: 'house_id' },
]

/** What a masked column reads as. */
export const MASK = '***'

/** The role `POST /sql` runs as: it can read the masked views and nothing else. */
export const API_ROLE = 'plkgap_api'

/** The schema holding one masked view per table, which is all that role can see. */
export const API_SCHEMA = 'api'

export const blockedIn = (table: string, column: string) =>
  blockedApiColumns.some((entry) => entry.column === column && (!entry.table || entry.table === table))

/**
 * Builds a masked mirror of every table in schema `api` and points the API role at it.
 *
 * Masking the column names a query happens to return would stop nothing: `SELECT cid AS x` renames
 * it, `length(cid)` measures it, a subquery buries it. Replacing the value inside a view masks it
 * at the source, so every one of those reads `***` instead. The role gets no privilege at all on
 * `public`, so naming the real table outright is refused rather than answered.
 * Rebuilt only when the blocked list or the shape of the tables changes.
 */
export async function createApiSchema(db: PGlite) {
  await ensureInitTable(db)
  const { rows: columns } = await db.query<{ table_name: string; column_name: string }>(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position`)
  const version = 'api@' + createHash('sha1')
    .update(JSON.stringify([blockedApiColumns, MASK, columns])).digest('hex').slice(0, 12)
  const done = await initializedVersion(db, 'api')
  // Rebuilding a reference table drops its view along with it, and the column list can come back
  // identical, so the digest alone is not proof the views are still there.
  const { rows: present } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.views WHERE table_schema = '${API_SCHEMA}'`)
  const expected = new Set(columns.map((row) => row.table_name)).size
  if (done?.version === version && present[0].n === expected) return { ...done, applied: false }

  await db.exec(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${API_ROLE}') THEN
        CREATE ROLE ${API_ROLE} NOLOGIN;
      END IF;
    END $$;
    DROP SCHEMA IF EXISTS ${API_SCHEMA} CASCADE;
    CREATE SCHEMA ${API_SCHEMA};
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${API_ROLE};
    REVOKE ALL ON SCHEMA public FROM ${API_ROLE};
    -- USAGE only: enough to resolve the PostGIS functions living in public, never to read a table.
    GRANT USAGE ON SCHEMA public TO ${API_ROLE};
    GRANT USAGE ON SCHEMA ${API_SCHEMA} TO ${API_ROLE};`)

  const tables = [...new Set(columns.map((row) => row.table_name))]
  let masked = 0
  for (const table of tables) {
    const own = columns.filter((row) => row.table_name === table)
    if (own.some((row) => blockedIn(table, row.column_name))) masked += 1
    const list = own.map((row) => blockedIn(table, row.column_name)
      ? `'${MASK}'::text AS ${quote(row.column_name)}`
      : quote(row.column_name)).join(', ')
    await db.exec(`CREATE VIEW ${API_SCHEMA}.${quote(table)} AS SELECT ${list} FROM public.${quote(table)};`)
  }
  await db.exec(`GRANT SELECT ON ALL TABLES IN SCHEMA ${API_SCHEMA} TO ${API_ROLE};`)
  await recordInit(db, 'api', version, masked, blockedApiColumns.length)
  return { version, table_count: masked, row_count: blockedApiColumns.length, applied: true }
}

export interface SqlAnswer {
  columns: string[]
  rows: Record<string, unknown>[]
  /** Rows the statement produced, which is more than `rows.length` when the answer was capped. */
  rowCount: number
  truncated: boolean
}

/**
 * Runs one statement for the local HTTP API inside a read-only transaction with a statement
 * timeout. PostgreSQL itself refuses any write, so a data-modifying CTE cannot slip past a
 * keyword check and the 52 files full of imported rows cannot be dropped or emptied from here.
 * The timeout matters because PGlite runs in the main process: a runaway query freezes the app.
 */
export async function runReadOnlySql(db: PGlite, sql: string, limit = 5000): Promise<SqlAnswer> {
  const statement = sql.trim().replace(/;+\s*$/, '')
  if (!statement) throw new Error('ต้องส่ง SQL มาด้วย')
  return db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY')
    await tx.query(`SET LOCAL statement_timeout = '15s'`)
    // Dropping to the restricted role last, so the two SETs above still run as the owner.
    // `api` ahead of `public` means an unqualified table name lands on the masked view.
    await tx.query(`SET LOCAL ROLE ${API_ROLE}`)
    await tx.query(`SET LOCAL search_path = ${API_SCHEMA}, public`)
    const result = await tx.query<Record<string, unknown>>(statement).catch((reason: unknown) => {
      throw maskedAway(reason)
    })
    return {
      columns: result.fields.map((field) => field.name),
      rows: result.rows.slice(0, limit),
      rowCount: result.rows.length,
      truncated: result.rows.length > limit,
    }
  })
}

/** Names the guardrail when a query reached past the masked views for the real table. */
export function maskedAway(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (!/permission denied/i.test(message)) return reason
  return new Error(`${message} — API นี้อ่านได้เฉพาะ schema ${API_SCHEMA} ที่ปิดบังข้อมูลส่วนบุคคลไว้แล้ว`
    + ' ให้เรียกชื่อตารางเปล่า ๆ ไม่ต้องนำหน้าด้วย public.')
}
