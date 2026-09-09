import type { PGlite } from '@electric-sql/pglite'
import structureCodes from '../reference/structure-codes.json'
import type { ReferenceData, FileStructure, SchemaPhase } from './types'
import { ensureInitTable } from './schema-state'
import { loadGeographyTables } from './geography'
import { loadStructureCodeTables, loadReferenceTables } from './reference'
import { createAppTables } from './app-schema'
import { createFileTables } from './file-schema'
import { syncObservationRules } from './observations'
import { createApiSchema } from './api'

/**
 * Builds everything the app needs in its own database. Runs on the first start after install
 * (and again only when a pulled structure file changes); on every later start it is a no-op.
 */
export async function initializeSchema(db: PGlite, data: {
  reference?: ReferenceData
  structure?: FileStructure
} = {}, onPhase?: SchemaPhase) {
  await ensureInitTable(db)
  onPhase?.('reference')
  const reference = await loadReferenceTables(db, data.reference)
  onPhase?.('geography')
  const geography = await loadGeographyTables(db)
  onPhase?.('app')
  const app = await createAppTables(db)
  onPhase?.('observations')
  const observations = await syncObservationRules(db)
  onPhase?.('files43')
  const files = await createFileTables(db, data.structure)
  onPhase?.('structure_codes')
  const codes = await loadStructureCodeTables(db, structureCodes, data.reference)
  // Last: the masked views mirror whatever tables the steps above ended up creating.
  onPhase?.('api')
  const api = await createApiSchema(db)
  return { reference, geography, files, app, observations, codes, api,
    firstRun: reference.applied || geography.applied || files.applied || app.applied || codes.applied }
}

export async function initializePostgis(db: PGlite) {
  await db.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
}
