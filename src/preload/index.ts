import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '../shared/api'

const api: AppApi = {
  databaseStatus: () => ipcRenderer.invoke('database:status'),
}
contextBridge.exposeInMainWorld('api', api)
