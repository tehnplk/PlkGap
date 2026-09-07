export interface DatabaseStatus {
  version: string
  postgis: string
  path: string
  geometry: string
}

export interface AppApi {
  databaseStatus: () => Promise<DatabaseStatus>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  onWindowMaximized: (callback: (maximized: boolean) => void) => () => void
}
