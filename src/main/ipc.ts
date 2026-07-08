import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import type {
  Assessment,
  CollectionName,
  ComparisonResult,
  EvidenceAttachment,
  Finding,
  LogCategory,
  LogEntry,
  LogQuery,
  ScanFetchProgress,
  ScannerConnection,
  Settings,
  VaptRequest
} from '../shared/types'
import { EVIDENCE_EXTENSIONS, categoryOfType, generateProjectCode, parseProjectCode } from '../shared/types'
import { isFindingOpen, slaDueDate } from '../shared/sla'
import { Store } from './store'
import { classifyFinding, classifyLifecycle, fingerprintOf } from './fingerprint'
import { importNessusContent, importNessusFile } from './nessus'
import { fetchScanXml, listScans, testConnection } from './scanner'
import { generateReport, ReportRequest } from './reports'
import { refreshNotifications } from './notifications'
import { logger } from './logger'

// ---- IPC error capture (SRS v6.3 §7): every handler failure is logged with
// its channel, category and a safe stack trace, then rethrown to the caller.

const CHANNEL_CATEGORY: [RegExp, LogCategory][] = [
  [/^scanner:/, 'Scanner'],
  [/^report:/, 'Reports'],
  [/^chart:/, 'Charts'],
  [/^(nessus|evidence):/, 'Import / Export'],
  [/^settings:/, 'Settings'],
  [/^log:/, 'Diagnostics'],
  [/^db:/, 'Storage']
]
function categoryFor(channel: string): LogCategory {
  return CHANNEL_CATEGORY.find(([re]) => re.test(channel))?.[1] ?? 'System'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await fn(e, ...args)
    } catch (err) {
      logger.error({
        category: categoryFor(channel),
        module: 'ipc',
        source: channel,
        action: channel,
        message: `IPC ${channel} failed`,
        error: err
      })
      throw err
    }
  })
}

/** User-activity audit line for data writes (SRS v6.3 §4 "User Activity"). */
function logAudit(
  action: 'create' | 'update' | 'remove',
  name: CollectionName,
  entity?: { id?: string; projectCode?: unknown; applicationId?: unknown }
): void {
  if (name === 'notifications') return // system-generated churn, not user activity
  logger.write({
    category: 'User Activity',
    module: 'ipc',
    source: `db:${action}`,
    action: `${action} ${name}`,
    message: `${action} ${name} ${entity?.id ?? ''}`.trim(),
    projectCode: typeof entity?.projectCode === 'string' ? entity.projectCode : '',
    applicationId: typeof entity?.applicationId === 'string' ? entity.applicationId : ''
  })
}

/** Server-side hooks for finding writes: fingerprint, SLA and closure dates. */
function prepareFinding(store: Store, data: Partial<Finding>, existing?: Finding): Partial<Finding> {
  const merged = { ...existing, ...data } as Finding
  // Selecting a Project Code auto-links the related application (SRS v6.1
  // §3.4) — the code, not the user, decides which application the finding
  // belongs to.
  if (merged.projectCode) {
    const req = store.list('requests').find((r) => r.projectCode === merged.projectCode)
    if (req?.applicationId) merged.applicationId = req.applicationId
    // Adhoc web findings arrive without an assessment (SRS v6.2 §6/§7): the
    // finding inherits Assessment Type = Web, Period = Adhoc by linking to the
    // project code's adhoc Web assessment, created on first use.
    if (!merged.assessmentId && req) {
      const adhocAssessment =
        store
          .list('assessments')
          .find(
            (a) =>
              a.requestId === req.id &&
              (a.category || categoryOfType(a.type)) === 'web' &&
              (a.timeframe || 'adhoc') === 'adhoc'
          ) ??
        store.create(
          'assessments',
          prepareAssessment({
            name: `Adhoc Web — ${req.projectCode}`,
            requestId: req.id,
            applicationId: req.applicationId,
            type: 'Web',
            category: 'web',
            timeframe: 'adhoc',
            status: 'In Progress',
            startDate: new Date().toISOString().slice(0, 10),
            endDate: '',
            hostIds: [],
            tester: '',
            baselineAssessmentId: '',
            notes: `Auto-created for adhoc web findings of ${req.projectCode} (SRS v6.2 §7)`
          })
        )
      merged.assessmentId = adhocAssessment.id
    }
  }
  const host = merged.hostId ? store.get('hosts', merged.hostId) : undefined
  // Hosts are per-import records (FR-H3), so the IP — not the host record id —
  // is the stable identity used for fingerprint matching across imports.
  merged.fingerprint = fingerprintOf({
    hostId: host?.ip ? '' : merged.hostId,
    ip: host?.ip,
    port: merged.port,
    pluginId: merged.pluginId,
    // Web findings have no host; the affected asset (URL/endpoint) is their identity.
    endpoint: merged.endpoint || merged.affectedAsset,
    parameter: merged.parameter,
    title: merged.title
  })
  if (merged.severity && merged.discoveredDate) {
    merged.slaDueDate = slaDueDate(merged.severity, merged.discoveredDate)
  }
  if (!isFindingOpen(merged) && !merged.closedDate) {
    merged.closedDate = new Date().toISOString().slice(0, 10)
  } else if (isFindingOpen(merged)) {
    merged.closedDate = ''
  }
  if (!existing) {
    const assessment = merged.assessmentId ? store.get('assessments', merged.assessmentId) : undefined
    if (assessment) {
      const requestsById = new Map(store.list('requests').map((r) => [r.id, r]))
      // Findings inherit the assessment's project code unless one was chosen
      // explicitly (adhoc web findings, SRS v5 §4).
      if (!merged.projectCode && assessment.requestId) {
        merged.projectCode = requestsById.get(assessment.requestId)?.projectCode ?? ''
      }
      const hosts = store.list('hosts')
      // Annual/quarterly assessments use the New/Existing lifecycle (SRS v5 §5).
      const lifecycle = classifyLifecycle(
        merged.fingerprint,
        assessment,
        store.list('assessments'),
        store.list('findings'),
        requestsById
      )
      if (lifecycle) Object.assign(merged, lifecycle)
      else
        merged.classification = classifyFinding(merged.fingerprint, merged.hostId, {
          priorFindings: store.list('findings').filter((f) => f.applicationId === assessment.applicationId),
          hostsById: new Map(hosts.map((h) => [h.id, h])),
          assessment
        })
    }
  }
  return merged
}

/** Copy evidence files into the finding's evidence folder and record them. */
export function evidenceAddFile(store: Store, findingId: string, srcPaths: string[]): Finding {
  const finding = store.get('findings', findingId)
  if (!finding) throw new Error('Finding not found')
  const dir = store.resolve(path.join('evidence', findingId))
  fs.mkdirSync(dir, { recursive: true })
  const attachments: EvidenceAttachment[] = [...(finding.attachments ?? [])]
  for (const src of srcPaths) {
    const ext = path.extname(src).slice(1).toLowerCase()
    if (!EVIDENCE_EXTENSIONS.includes(ext as never)) continue
    const id = randomUUID()
    const filename = path.basename(src)
    const stored = `${id}-${filename}`
    fs.copyFileSync(src, path.join(dir, stored))
    attachments.push({
      id,
      filename,
      path: path.join('evidence', findingId, stored),
      size: fs.statSync(src).size,
      addedAt: new Date().toISOString()
    })
  }
  return store.update('findings', findingId, { attachments })
}

function compareAssessments(store: Store, baselineId: string, currentId: string): ComparisonResult {
  const all = store.list('findings')
  const a = all.filter((f) => f.assessmentId === baselineId)
  const b = all.filter((f) => f.assessmentId === currentId)
  const aByFp = new Map(a.map((f) => [f.fingerprint, f]))
  const bByFp = new Map(b.map((f) => [f.fingerprint, f]))
  const result: ComparisonResult = { newFindings: [], resolvedFindings: [], recurringFindings: [], severityChanges: [] }
  for (const f of b) {
    const prior = aByFp.get(f.fingerprint)
    if (!prior) result.newFindings.push(f)
    else {
      result.recurringFindings.push({ a: prior, b: f })
      if (prior.severity !== f.severity) result.severityChanges.push({ a: prior, b: f })
    }
  }
  for (const f of a) if (!bByFp.has(f.fingerprint)) result.resolvedFindings.push(f)
  return result
}

/** Project-code hooks (SRS v3 §4): auto-generate, or parse "[code] title" pastes. */
export function prepareRequest(data: Partial<VaptRequest>, existing?: VaptRequest): Partial<VaptRequest> {
  const merged = { ...existing, ...data }
  if (merged.title?.includes('[')) {
    const parsed = parseProjectCode(merged.title)
    if (parsed.projectCode) {
      merged.projectCode = parsed.projectCode
      merged.title = parsed.title
    }
  }
  if (!merged.projectCode) merged.projectCode = generateProjectCode()
  return merged
}

function prepareAssessment(data: Partial<Assessment>, existing?: Assessment): Partial<Assessment> {
  const merged = { ...existing, ...data }
  if (merged.type && !merged.category) merged.category = categoryOfType(merged.type)
  if (!merged.timeframe) merged.timeframe = 'adhoc'
  return merged
}

export function registerIpc(store: Store, onSettingsChanged?: () => void): void {
  handle('db:list', (_e, name: CollectionName) => store.list(name))
  handle('db:get', (_e, name: CollectionName, id: string) => store.get(name, id))
  handle('db:create', (_e, name: CollectionName, data: Record<string, unknown>) => {
    const created = (() => {
      if (name === 'findings') return store.create(name, prepareFinding(store, data as Partial<Finding>))
      if (name === 'requests') return store.create(name, prepareRequest(data as Partial<VaptRequest>))
      if (name === 'assessments') return store.create(name, prepareAssessment(data as Partial<Assessment>))
      return store.create(name, data)
    })()
    logAudit('create', name, created)
    return created
  })
  handle('db:update', (_e, name: CollectionName, id: string, patch: Record<string, unknown>) => {
    const updated = (() => {
      if (name === 'findings') {
        const existing = store.get('findings', id)
        return store.update(name, id, prepareFinding(store, patch as Partial<Finding>, existing))
      }
      if (name === 'requests') {
        const next = store.update(name, id, prepareRequest(patch as Partial<VaptRequest>, store.get('requests', id)))
        store.repartition() // adhoc finding folders are keyed by project code
        return next
      }
      if (name === 'assessments') {
        const next = store.update(
          name,
          id,
          prepareAssessment(patch as Partial<Assessment>, store.get('assessments', id))
        )
        store.repartition() // category/timeframe decide where findings are stored
        return next
      }
      if (name === 'applications') {
        const next = store.update(name, id, patch)
        store.repartition() // findings folders are keyed by application name
        return next
      }
      return store.update(name, id, patch)
    })()
    logAudit('update', name, updated)
    return updated
  })
  handle('db:remove', (_e, name: CollectionName, id: string) => {
    const entity = store.get(name, id) as { id?: string; projectCode?: unknown; applicationId?: unknown } | undefined
    store.remove(name, id)
    logAudit('remove', name, entity ?? { id })
  })

  handle('settings:get', () => store.getSettings())
  handle('settings:set', (_e, patch: Partial<Settings>) => {
    const result = store.setSettings(patch)
    onSettingsChanged?.()
    // Log which settings changed, never their values (§9: keys may be secrets).
    logger.write({
      category: 'Settings',
      module: 'ipc',
      source: 'settings:set',
      action: 'update settings',
      message: `Settings updated: ${Object.keys(patch).join(', ')}`
    })
    if (patch.logRetentionDays !== undefined) logger.rotate()
    return result
  })
  handle('settings:chooseDir', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  handle('nessus:import', async (_e, assessmentId: string, kind: 'nessus' | 'csv') => {
    const res = await dialog.showOpenDialog({
      title: kind === 'csv' ? 'Select CSV export' : 'Select .nessus export',
      filters:
        kind === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'Nessus export', extensions: ['nessus', 'xml'] }],
      properties: ['openFile']
    })
    if (res.canceled) return null
    const result = importNessusFile(store, assessmentId, res.filePaths[0])
    logger.write({
      category: 'Import / Export',
      module: 'ipc',
      source: 'nessus:import',
      action: 'import scan',
      status: result.errors.length ? 'partial' : 'ok',
      message: `Imported ${path.basename(res.filePaths[0])}: ${result.imported} finding(s), ${result.duplicates} duplicate(s), ${result.hostsCreated} host(s)`,
      failureReason: result.errors.slice(0, 3).join('; '),
      details: `assessmentId=${assessmentId}`
    })
    return result
  })

  // --- Scanner connections (SRS v4 §5, §9)
  handle('scanner:test', async (_e, conn: ScannerConnection) => {
    const result = await testConnection(conn)
    // Generic reason only — never the keys themselves (SRS v6.3 §9).
    logger.write({
      category: 'Scanner',
      module: 'ipc',
      source: 'scanner:test',
      action: 'test connection',
      level: result.ok ? 'INFO' : 'WARNING',
      status: result.ok ? 'ok' : 'failed',
      message: `Scanner "${conn.name || conn.url}" test ${result.ok ? 'succeeded' : 'failed'}`,
      failureReason: result.ok ? '' : result.message
    })
    return result
  })
  handle('scanner:listScans', (_e, connId: string, includePolicy?: boolean) => {
    const conn = store.getSettings().scanners.find((s) => s.id === connId)
    if (!conn) throw new Error('Scanner connection not found')
    return listScans(conn, includePolicy ?? false)
  })
  handle('scanner:fetch', async (e, assessmentId: string, connId: string, scanId: number, scanName: string) => {
    const conn = store.getSettings().scanners.find((s) => s.id === connId)
    if (!conn) throw new Error('Scanner connection not found')
    // Live progress to the invoking window (export → generate → download → import).
    const send = (p: Omit<ScanFetchProgress, 'scanId'>) => {
      try {
        e.sender.send('scanner:progress', { scanId, ...p } satisfies ScanFetchProgress)
      } catch {
        /* window may have closed mid-fetch */
      }
    }
    const xml = await fetchScanXml(conn, scanId, send)
    const safe = `${scanName.replace(/[^\w.-]+/g, '_')}-${scanId}.nessus`
    send({ stage: 'importing', percent: 92, message: 'Importing findings…' })
    const result = importNessusContent(store, assessmentId, xml, safe, false)
    send({ stage: 'done', percent: 100, message: `Imported ${result.imported} finding(s)` })
    logger.write({
      category: 'Scanner',
      module: 'ipc',
      source: 'scanner:fetch',
      action: 'fetch scan',
      status: result.errors.length ? 'partial' : 'ok',
      message: `Fetched "${scanName}" from ${conn.name || conn.url}: ${result.imported} finding(s), ${result.hostsCreated} host(s)`,
      failureReason: result.errors.slice(0, 3).join('; '),
      details: `assessmentId=${assessmentId}`
    })
    return result
  })

  // --- Evidence attachments (SRS v4 §4)
  handle('evidence:add', async (e, findingId: string) => {
    const finding = store.get('findings', findingId)
    if (!finding) throw new Error('Finding not found')
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      title: 'Attach evidence',
      filters: [{ name: 'Evidence', extensions: [...EVIDENCE_EXTENSIONS] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || res.filePaths.length === 0) return finding
    return evidenceAddFile(store, findingId, res.filePaths)
  })
  handle('evidence:open', (_e, relPath: string) => shell.openPath(store.resolve(relPath)))
  handle('evidence:remove', (_e, findingId: string, attachmentId: string) => {
    const finding = store.get('findings', findingId)
    if (!finding) throw new Error('Finding not found')
    const att = (finding.attachments ?? []).find((a) => a.id === attachmentId)
    if (att) fs.rmSync(store.resolve(att.path), { force: true })
    return store.update('findings', findingId, {
      attachments: (finding.attachments ?? []).filter((a) => a.id !== attachmentId)
    })
  })

  handle('report:generate', async (_e, req: Omit<ReportRequest, 'outputPath'> & { suggestedName: string }) => {
    const res = await dialog.showSaveDialog({
      title: 'Save report',
      defaultPath: `${store.getSettings().reportsDir}/${req.suggestedName}.${req.format}`,
      filters: [{ name: req.format.toUpperCase(), extensions: [req.format] }]
    })
    if (res.canceled || !res.filePath) return null
    const out = await generateReport(store, { ...req, outputPath: res.filePath })
    logger.write({
      category: 'Reports',
      module: 'ipc',
      source: 'report:generate',
      action: 'generate report',
      message: `Generated ${req.format.toUpperCase()} report ${path.basename(out)}`
    })
    shell.showItemInFolder(out)
    return out
  })

  handle('assessments:compare', (_e, baselineId: string, currentId: string) =>
    compareAssessments(store, baselineId, currentId)
  )

  handle('notifications:refresh', () => refreshNotifications(store))

  // --- Charts module PDF export (SRS v5 §6): render the chart PNG into an A4 page.
  handle('chart:exportPdf', async (_e, pngDataUrl: string, title: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Export chart as PDF',
      defaultPath: `${store.getSettings().reportsDir}/${suggestedName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return null
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;margin:40px;color:#111}
      h1{font-size:20px} img{max-width:100%}
    </style></head><body><h1>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>
    <p>Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</p>
    <img src="${pngDataUrl}"></body></html>`
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      fs.writeFileSync(res.filePath, pdf)
    } finally {
      win.destroy()
    }
    logger.write({
      category: 'Charts',
      module: 'ipc',
      source: 'chart:exportPdf',
      action: 'export chart pdf',
      message: `Chart exported to PDF: ${path.basename(res.filePath)}`
    })
    shell.showItemInFolder(res.filePath)
    return res.filePath
  })

  handle('shell:openPath', (_e, p: string) => shell.openPath(p))

  // --- System logs & diagnostics (SRS v6.3 §10–§12)

  handle('log:write', (_e, entry: Partial<LogEntry>) => logger.write({ module: 'renderer', ...entry }))

  handle('log:query', (_e, q: LogQuery) => logger.query(q ?? {}))

  handle('log:clear', () => {
    const removed = logger.clear()
    logger.write({
      category: 'Diagnostics',
      module: 'ipc',
      source: 'log:clear',
      action: 'clear logs',
      message: `Log files cleared (${removed} file(s) removed)`
    })
    return removed
  })

  handle('log:export', async (_e, q: LogQuery) => {
    const res = await dialog.showSaveDialog({
      title: 'Export logs',
      defaultPath: `${store.getSettings().reportsDir}/tvm-logs-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: 'Log (JSON lines)', extensions: ['log', 'json'] }]
    })
    if (res.canceled || !res.filePath) return null
    const entries = logger.query({ ...(q ?? {}), limit: 100000 })
    fs.writeFileSync(res.filePath, entries.map((x) => JSON.stringify(x)).join('\n'))
    logger.write({
      category: 'Diagnostics',
      module: 'ipc',
      source: 'log:export',
      action: 'export logs',
      message: `Exported ${entries.length} log entrie(s) to ${path.basename(res.filePath)}`
    })
    shell.showItemInFolder(res.filePath)
    return res.filePath
  })

  handle('log:diagnostics', async () => {
    const res = await dialog.showSaveDialog({
      title: 'Generate diagnostic bundle',
      defaultPath: `${store.getSettings().reportsDir}/diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePath) return null
    const s = store.getSettings()
    // Secrets never leave the machine (SRS v6.3 §9/§10): scanner keys are
    // replaced before anything enters the bundle.
    const redactScanner = (c: ScannerConnection) => ({
      ...c,
      accessKey: c.accessKey ? '[redacted]' : '',
      secretKey: c.secretKey ? '[redacted]' : ''
    })
    const zip = new JSZip()
    zip.file('application.log', logger.tail('application', 2_000_000))
    zip.file('errors.log', logger.tail('errors', 1_000_000))
    zip.file('configuration.json', JSON.stringify({ ...s, scanners: s.scanners.map(redactScanner) }, null, 2))
    zip.file(
      'system-info.json',
      JSON.stringify(
        {
          appVersion: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          osRelease: os.release(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          locale: app.getLocale()
        },
        null,
        2
      )
    )
    zip.file('scanner-settings.json', JSON.stringify(s.scanners.map(redactScanner), null, 2))
    zip.file('version.json', JSON.stringify({ name: 'TVM Portal', version: app.getVersion() }, null, 2))
    fs.writeFileSync(res.filePath, await zip.generateAsync({ type: 'nodebuffer' }))
    logger.write({
      category: 'Diagnostics',
      module: 'ipc',
      source: 'log:diagnostics',
      action: 'diagnostic bundle',
      message: `Diagnostic bundle generated: ${path.basename(res.filePath)}`
    })
    shell.showItemInFolder(res.filePath)
    return res.filePath
  })
}
