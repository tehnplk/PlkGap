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

export interface AppApi {
  databaseStatus: () => Promise<DatabaseStatus>
  findHospital: (hospcode: string) => Promise<Hospital | null>
  /** Opens a native file picker limited to .zip and returns the chosen path, or null if cancelled. */
  chooseImportFile: () => Promise<string | null>
  /** Past import runs, newest first. The history is append-only — it cannot be cleared. */
  listImportLog: () => Promise<ImportLogEntry[]>
  /** Checks a zip before import: it must hold the 52 standard files and nothing else. */
  checkImportFile: (path: string) => Promise<ImportCheck>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  onWindowMaximized: (callback: (maximized: boolean) => void) => () => void
}
