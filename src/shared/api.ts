export interface DatabaseStatus {
  version: string
  postgis: string
  path: string
  geometry: string
  /** c_* reference tables seeded at setup, ready to use on a brand new machine. */
  referenceTables: number
  referenceRows: number
  /** The 52 standard files, created empty and waiting for an import. */
  fileTables: number
}

/** One service unit as recorded in the SUB-HDC `c_hospital` reference table. */
export interface Hospital {
  hospcode: string
  hospname: string
  hospnameShort: string
  hostype: string
  hostypeName: string
  mu: string
  tambon: string
  ampur: string
  changwat: string
}

/** Result of checking that a zip holds the 52 standard files and nothing else. */
export interface ImportCheck {
  valid: boolean
  entries: number
  found: string[]
  missing: string[]
  unexpected: string[]
  error: string
}

/** One row of `import52files_log` — a single import run. */
export interface ImportLogEntry {
  id: number
  fileName: string
  filePath: string
  fileSize: number
  startedAt: string
  finishedAt: string | null
  status: string
  progressPercent: number
  rowCount: number
  message: string
}

/** Progress pushed from the main process while a zip is being imported. */
export interface ImportProgress {
  runId: number
  percent: number
  file: string
  rowCount: number
}

/** Outcome of one import run. */
export interface ImportResult {
  runId: number
  files: number
  rowCount: number
}

/** Row counts of one standard file, one row per fiscal year, twelve months each. */
export interface DataCountYear {
  fiscalYear: number
  months: number[]
  total: number
}
export interface DataCountResult {
  table: string
  column: string
  years: DataCountYear[]
}

/** One rule the imported data broke, counted over a single import run. */
export interface StructureFinding {
  tableName: string
  columnName: string
  rule: string
  detail: string
  /** Rows of this file that came from the zip. */
  tableRows: number
  /** How many of them broke the rule. */
  found: number
  level: string
}

/** A sample of the rows behind one finding. */
export interface FailingRows {
  tableName: string
  columnName: string
  detail: string
  columns: string[]
  rows: string[][]
  total: number
}
export interface StructureCheckResult {
  /** The zip whose rows were checked — every run that imported this file name. */
  zipName: string
  rows: number
  rules: number
  checkedAt: string
  findings: StructureFinding[]
}

/** One household from the HOME file that has a usable coordinate. */
export interface Household {
  hospcode: string
  hid: string
  /** House number as written in the HOME file. */
  house: string
  /** Village number, e.g. "02". */
  village: string
  tambonName: string
  ampurName: string
  latitude: number
  longitude: number
}

/** Administrative boundaries as GeoJSON, ready to hand to Leaflet. */
export type BoundaryLevel = 'province' | 'district' | 'subdistrict'
export interface BoundaryCollection {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: { name: string; code: string }; geometry: unknown }[]
}

export interface AppApi {
  databaseStatus: () => Promise<DatabaseStatus>
  findHospital: (hospcode: string) => Promise<Hospital | null>
  /** Opens a native file picker limited to .zip and returns the chosen path, or null if cancelled. */
  chooseImportFile: () => Promise<string | null>
  /** Province, district or subdistrict outlines, as a GeoJSON FeatureCollection. */
  listBoundaries: (level: BoundaryLevel) => Promise<BoundaryCollection>
  /** Households from the HOME file that carry a coordinate inside Thailand. */
  listHouseholds: () => Promise<Household[]>
  /** The 52 standard file names, from the c_file reference table. */
  listStandardFiles: () => Promise<string[]>
  /** Row counts of one standard file for each of the given Thai fiscal years (Oct-Sep). */
  countByFiscalYears: (table: string, years: number[]) => Promise<DataCountResult>
  /** Checks the rows imported from one zip against the 43-file data dictionary, and stores it. */
  checkStructure: (zipName: string) => Promise<StructureCheckResult>
  /** The stored result of the last structure check of a zip, if there is one. */
  structureResult: (zipName: string) => Promise<StructureCheckResult | null>
  /** The actual rows behind one finding, capped to a readable sample. */
  failingRows: (zipName: string, tableName: string, columnName: string, rule: string) => Promise<FailingRows>
  /** Past import runs, newest first. The history is append-only — it cannot be cleared. */
  listImportLog: () => Promise<ImportLogEntry[]>
  /** Checks a zip before import: it must hold the 52 standard files and nothing else. */
  checkImportFile: (path: string) => Promise<ImportCheck>
  /** Imports a checked zip into the 52 tables and records the run in the history. */
  runImport: (path: string) => Promise<ImportResult>
  onImportProgress: (callback: (progress: ImportProgress) => void) => () => void
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  onWindowMaximized: (callback: (maximized: boolean) => void) => () => void
}
