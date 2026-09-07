export interface DatabaseStatus {
  version: string
  postgis: string
  path: string
  geometry: string
}

export interface AppApi {
  databaseStatus: () => Promise<DatabaseStatus>
}
