import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import type { SchemaPhase } from './sql/types'
import { initializeSchema, initializePostgis } from './sql/schema'
export type { ReferenceTable, ReferenceData, FileColumn, FileTable, FileStructure, SchemaPhase, BoundaryData, GeographyData } from './sql/types'
export type { CheckReporter } from './sql/shared'
export { initializeSchema } from './sql/schema'
export { databaseStatus } from './sql/status'
export { listBoundaries, listHouseholds, loadGeographyTables } from './sql/geography'
export { listStandardFiles, findHospital, referenceTablesInUse, loadStructureCodeTables, referenceCodeList, loadReferenceTables } from './sql/reference'
export { createAppTables } from './sql/app-schema'
export { createFileTables } from './sql/file-schema'
export { listImportLog, startImportRun, finishImportRun, updateImportProgress, insertStandardRows } from './sql/imports'
export { checkImportStructure, RULE_COLUMN, structureFailingRows, structureResult } from './sql/structure-check'
export { syncObservationRules, listObservationRules, setObservationRuleActive, checkObservations, observationRows } from './sql/observations'
export { countByFiscalYears } from './sql/data-count'
export { listTables, describeTable, blockedApiColumns, MASK, API_ROLE, API_SCHEMA, createApiSchema, runReadOnlySql } from './sql/api'
export { processIndicators } from './sql/indicators'
export { getD506Report } from './sql/d506'

export async function openDatabase(path: string, onPhase?: SchemaPhase) {
  const db = new PGlite(path, { extensions: { postgis } })
  try {
    onPhase?.('postgis')
    await initializePostgis(db)
    const setup = await initializeSchema(db, {}, onPhase)
    if (setup.firstRun) {
      console.log(`PlkGap: initialized ${setup.reference.table_count} c_* reference tables `
        + `(${setup.reference.row_count} rows) and ${setup.files.table_count} 43-file tables`)
    }
    return db
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}

export type { TableSummary, ColumnDescription, TableDescription, SqlAnswer } from './sql/api'
