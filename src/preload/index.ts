import { contextBridge, ipcRenderer } from 'electron'

const api = {
  list: (name: string) => ipcRenderer.invoke('db:list', name),
  get: (name: string, id: string) => ipcRenderer.invoke('db:get', name, id),
  create: (name: string, data: unknown) => ipcRenderer.invoke('db:create', name, data),
  update: (name: string, id: string, patch: unknown) => ipcRenderer.invoke('db:update', name, id, patch),
  remove: (name: string, id: string) => ipcRenderer.invoke('db:remove', name, id),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  chooseDir: () => ipcRenderer.invoke('settings:chooseDir'),

  importNessus: (assessmentId: string, kind: 'nessus' | 'csv') =>
    ipcRenderer.invoke('nessus:import', assessmentId, kind),
  scannerTest: (conn: unknown) => ipcRenderer.invoke('scanner:test', conn),
  scannerListScans: (connId: string, includePolicy?: boolean) =>
    ipcRenderer.invoke('scanner:listScans', connId, includePolicy),
  scannerFetch: (assessmentId: string, connId: string, scanId: number, scanName: string) =>
    ipcRenderer.invoke('scanner:fetch', assessmentId, connId, scanId, scanName),
  onScannerProgress: (callback: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => callback(p)
    ipcRenderer.on('scanner:progress', listener)
    return () => ipcRenderer.removeListener('scanner:progress', listener)
  },
  evidenceAdd: (findingId: string) => ipcRenderer.invoke('evidence:add', findingId),
  evidenceOpen: (relPath: string) => ipcRenderer.invoke('evidence:open', relPath),
  evidenceRemove: (findingId: string, attachmentId: string) =>
    ipcRenderer.invoke('evidence:remove', findingId, attachmentId),
  generateReport: (req: unknown) => ipcRenderer.invoke('report:generate', req),
  compareAssessments: (baselineId: string, currentId: string) =>
    ipcRenderer.invoke('assessments:compare', baselineId, currentId),
  refreshNotifications: () => ipcRenderer.invoke('notifications:refresh'),
  chartExportPdf: (pngDataUrl: string, title: string, suggestedName: string) =>
    ipcRenderer.invoke('chart:exportPdf', pngDataUrl, title, suggestedName),
  logWrite: (entry: unknown) => ipcRenderer.invoke('log:write', entry),
  logQuery: (q: unknown) => ipcRenderer.invoke('log:query', q),
  logClear: () => ipcRenderer.invoke('log:clear'),
  logExport: (q: unknown) => ipcRenderer.invoke('log:export', q),
  logDiagnostics: () => ipcRenderer.invoke('log:diagnostics'),
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),
  onDataChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('data-changed', listener)
    return () => ipcRenderer.removeListener('data-changed', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
