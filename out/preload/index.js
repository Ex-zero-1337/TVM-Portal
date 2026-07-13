"use strict";
const electron = require("electron");
const api = {
  list: (name) => electron.ipcRenderer.invoke("db:list", name),
  get: (name, id) => electron.ipcRenderer.invoke("db:get", name, id),
  create: (name, data) => electron.ipcRenderer.invoke("db:create", name, data),
  update: (name, id, patch) => electron.ipcRenderer.invoke("db:update", name, id, patch),
  remove: (name, id) => electron.ipcRenderer.invoke("db:remove", name, id),
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => electron.ipcRenderer.invoke("settings:set", patch),
  chooseDir: () => electron.ipcRenderer.invoke("settings:chooseDir"),
  importNessus: (assessmentId, kind) => electron.ipcRenderer.invoke("nessus:import", assessmentId, kind),
  importNessusFiles: (category) => electron.ipcRenderer.invoke("nessus:importFiles", category),
  assessmentsRemoveMany: (ids) => electron.ipcRenderer.invoke("assessments:removeMany", ids),
  scannerTest: (conn) => electron.ipcRenderer.invoke("scanner:test", conn),
  scannerListScans: (connId, includePolicy) => electron.ipcRenderer.invoke("scanner:listScans", connId, includePolicy),
  scannerFetch: (assessmentId, connId, scanId, scanName) => electron.ipcRenderer.invoke("scanner:fetch", assessmentId, connId, scanId, scanName),
  onScannerProgress: (callback) => {
    const listener = (_e, p) => callback(p);
    electron.ipcRenderer.on("scanner:progress", listener);
    return () => electron.ipcRenderer.removeListener("scanner:progress", listener);
  },
  evidenceAdd: (findingId) => electron.ipcRenderer.invoke("evidence:add", findingId),
  evidenceOpen: (relPath) => electron.ipcRenderer.invoke("evidence:open", relPath),
  evidenceRemove: (findingId, attachmentId) => electron.ipcRenderer.invoke("evidence:remove", findingId, attachmentId),
  generateReport: (req) => electron.ipcRenderer.invoke("report:generate", req),
  compareAssessments: (baselineId, currentId) => electron.ipcRenderer.invoke("assessments:compare", baselineId, currentId),
  refreshNotifications: () => electron.ipcRenderer.invoke("notifications:refresh"),
  chartExportPdf: (pngDataUrl, title, suggestedName) => electron.ipcRenderer.invoke("chart:exportPdf", pngDataUrl, title, suggestedName),
  logWrite: (entry) => electron.ipcRenderer.invoke("log:write", entry),
  logQuery: (q) => electron.ipcRenderer.invoke("log:query", q),
  logClear: () => electron.ipcRenderer.invoke("log:clear"),
  logExport: (q) => electron.ipcRenderer.invoke("log:export", q),
  logDiagnostics: () => electron.ipcRenderer.invoke("log:diagnostics"),
  openPath: (p) => electron.ipcRenderer.invoke("shell:openPath", p),
  onDataChanged: (callback) => {
    const listener = () => callback();
    electron.ipcRenderer.on("data-changed", listener);
    return () => electron.ipcRenderer.removeListener("data-changed", listener);
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
