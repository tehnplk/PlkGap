import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '../shared/api'

const api: AppApi = {
  getD506Report: (year) => ipcRenderer.invoke('d506:report', year),
  listMessageVillages: () => ipcRenderer.invoke('messaging:villages'),
  processIndicators: (period) => ipcRenderer.invoke('indicators:process', period),
  saveIndicatorWorkbook: (period, bytes) => ipcRenderer.invoke('indicators:save-workbook', period, bytes),
  gatewayState: () => ipcRenderer.invoke('gateway:state'),
  setGatewayEnabled: (enabled) => ipcRenderer.invoke('gateway:set-enabled', enabled),
  ssoState: () => ipcRenderer.invoke('sso:state'),
  ssoLogin: () => ipcRenderer.invoke('sso:login'),
  ssoLogout: () => ipcRenderer.invoke('sso:logout'),
  onSsoState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state)
    ipcRenderer.on('sso:state', listener)
    return () => ipcRenderer.removeListener('sso:state', listener)
  },
  updateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  databaseStatus: () => ipcRenderer.invoke('database:status'),
  findHospital: (hospcode) => ipcRenderer.invoke('hospital:find', hospcode),
  chooseImportFile: () => ipcRenderer.invoke('import:choose-file'),
  listBoundaries: (level) => ipcRenderer.invoke('geo:boundaries', level),
  listHouseholds: () => ipcRenderer.invoke('home:list'),
  listStandardFiles: () => ipcRenderer.invoke('files:list'),
  countByFiscalYears: (table, years) => ipcRenderer.invoke('files:count-by-year', table, years),
  checkStructure: (zipName) => ipcRenderer.invoke('structure:check', zipName),
  checkObservations: (zipName) => ipcRenderer.invoke('observations:check', zipName),
  observationRows: (zipName, rule) => ipcRenderer.invoke('observations:rows', zipName, rule),
  listObservationRules: () => ipcRenderer.invoke('observations:rules'),
  setObservationRuleActive: (rule, active) => ipcRenderer.invoke('observations:set-active', rule, active),
  structureResult: (zipName) => ipcRenderer.invoke('structure:result', zipName),
  failingRows: (zipName, tableName, columnName, rule) =>
    ipcRenderer.invoke('structure:failing-rows', zipName, tableName, columnName, rule),
  referenceCodes: (table) => ipcRenderer.invoke('reference:codes', table),
  listImportLog: () => ipcRenderer.invoke('import:log'),
  checkImportFile: (path) => ipcRenderer.invoke('import:check-file', path),
  runImport: (path) => ipcRenderer.invoke('import:run', path),
  onImportProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },
  onCheckProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress)
    ipcRenderer.on('check:progress', listener)
    return () => ipcRenderer.removeListener('check:progress', listener)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
}
contextBridge.exposeInMainWorld('api', api)
