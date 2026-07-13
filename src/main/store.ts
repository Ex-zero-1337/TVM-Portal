import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type {
  Assessment,
  BaseEntity,
  CollectionMap,
  CollectionName,
  Finding,
  Host,
  Settings,
  VaptRequest
} from '../shared/types'
import { categoryOfType } from '../shared/types'
import { fromPaRequestFile, toPaRequestFile } from './pa-format'

const COLLECTIONS: CollectionName[] = [
  'requests',
  'applications',
  'hosts',
  'assessments',
  'findings',
  'kb',
  'notifications'
]

/** Default folder names under dataDir; web/internal/external can be relocated in Settings. */
const FINDINGS_DIRS: Record<string, string> = {
  web: 'web-findings',
  internal: 'internal-findings',
  external: 'external-findings',
  host: 'host-findings'
}

/** Pre-v6.6.3 combined tree — still read (and cleaned up on write) for migration. */
const LEGACY_INT_EXT_DIR = 'internal-external-findings'

/** Make a string safe as a single directory/file name. */
function safeSeg(s: string): string {
  return (s || 'unknown').replace(/[^\w.\- ]+/g, '_').trim() || 'unknown'
}

function walkJsonFiles(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkJsonFiles(p))
    else if (entry.name.endsWith('.json')) out.push(p)
  }
  return out
}

/**
 * Filesystem-only persistence (no database). Simple collections live in one
 * JSON file each. Findings and hosts use the audit-oriented directory layouts
 * from SRS update v3:
 *   <category>-findings/<timeframe>/<application|request>/[<host_id>/]findings.json
 *   hosts/<nessus_filename|manual>/<ip>.json (+ summary.json per import)
 * Requests are one file per request (requests/VAPT-<code>.json), matching the
 * one-JSON-per-request shape Power Automate produces.
 * All writes are atomic (tmp file + rename) so a crash never corrupts data.
 */
export class Store {
  private settings: Settings
  private cache = new Map<CollectionName, BaseEntity[]>()

  constructor() {
    this.settings = this.loadSettings()
    this.ensureDataDir()
  }

  private get configPath(): string {
    // Portable build: config sits next to the executable, not in %APPDATA%.
    const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
    return path.join(portableRoot ?? app.getPath('userData'), 'config.json')
  }

  private loadSettings(): Settings {
    // Portable build (electron-builder "portable" target): keep everything —
    // config and data — beside the executable so the whole app travels on a
    // USB stick / network share with no trace left on the host machine.
    const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
    const baseDir = portableRoot ? path.join(portableRoot, 'tvm-data') : path.join(app.getPath('userData'), 'tvm-data')
    const defaults: Settings = {
      dataDir: baseDir,
      reportsDir: path.join(baseDir, 'reports'),
      scanners: [],
      appearance: 'system',
      logRetentionDays: 30,
      debugLogging: false
    }
    try {
      return { ...defaults, ...JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) }
    } catch {
      return defaults
    }
  }

  getSettings(): Settings {
    return this.settings
  }

  setSettings(patch: Partial<Settings>): Settings {
    // Relocating a per-area storage folder migrates the stored files there.
    // Changing dataDir instead switches the whole workspace (no migration).
    const storageKeys = ['requestsDir', 'webFindingsDir', 'internalFindingsDir', 'externalFindingsDir'] as const
    const migrate =
      !('dataDir' in patch) &&
      storageKeys.some((k) => k in patch && (patch[k] || '') !== (this.settings[k] || ''))
    const oldRoots = migrate ? [this.requestsRoot(), ...this.allFindingsRoots()] : []
    if (migrate) {
      // Load with the old paths so every record travels to its new location.
      this.list('requests')
      this.list('findings')
      this.list('assessments')
      this.list('applications')
    }
    this.settings = { ...this.settings, ...patch }
    this.atomicWrite(this.configPath, JSON.stringify(this.settings, null, 2))
    if (migrate) {
      this.ensureDataDir()
      this.persistRequests()
      this.persistFindings()
      // Remove the portal-written copies left behind in abandoned roots.
      const current = new Set([this.requestsRoot(), ...this.allFindingsRoots()])
      for (const root of oldRoots) {
        if (current.has(root)) continue
        for (const file of walkJsonFiles(root)) {
          if (this.isPortalRecordFile(file)) fs.rmSync(file)
        }
      }
    } else {
      this.cache.clear()
    }
    this.ensureDataDir()
    return this.settings
  }

  /**
   * True when a JSON file holds portal-written record(s) — a top-level `id`
   * (flat records) or a `portal.id` block (PA-schema request files, v6.6.6).
   * Never delete anything else (e.g. raw Power Automate exports).
   */
  private isPortalRecordFile(file: string): boolean {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      const first = Array.isArray(data) ? data[0] : data
      return !!first && (typeof first.id === 'string' || typeof first.portal?.id === 'string')
    } catch {
      return false
    }
  }

  private ensureDataDir(): void {
    fs.mkdirSync(this.settings.dataDir, { recursive: true })
    fs.mkdirSync(this.settings.reportsDir, { recursive: true })
    fs.mkdirSync(path.join(this.settings.dataDir, 'imports'), { recursive: true })
    fs.mkdirSync(path.join(this.settings.dataDir, 'evidence'), { recursive: true })
  }

  /** Absolute path for a data-folder-relative path (e.g. an evidence attachment). Absolute paths pass through (relocated storage roots). */
  resolve(rel: string): string {
    return path.isAbsolute(rel) ? rel : path.join(this.settings.dataDir, rel)
  }

  /** Store `abs` relative to the data folder when inside it, absolute otherwise. */
  storablePath(abs: string): string {
    const rel = path.relative(this.settings.dataDir, abs)
    return rel.startsWith('..') ? abs : rel
  }

  // -------------------------------------------------- storage roots (v6.6.3)

  /** Effective requests folder: Settings override or `<dataDir>/requests`. */
  private requestsRoot(): string {
    return this.settings.requestsDir || path.join(this.settings.dataDir, 'requests')
  }

  /** Effective requests folder — public for the live folder watcher (v6.6.7). */
  requestsDirPath(): string {
    return this.requestsRoot()
  }

  /** Drop a collection's cache so the next read reloads from disk (live external file edits). */
  invalidate(name: CollectionName): void {
    this.cache.delete(name)
  }

  /** Effective findings folder for a storage bucket (web / internal / external / host). */
  private findingsRoot(bucket: 'web' | 'internal' | 'external' | 'host'): string {
    const override = {
      web: this.settings.webFindingsDir,
      internal: this.settings.internalFindingsDir,
      external: this.settings.externalFindingsDir,
      host: undefined
    }[bucket]
    return override || path.join(this.settings.dataDir, FINDINGS_DIRS[bucket])
  }

  /** Every folder findings may live in: effective roots, defaults, and the legacy combined tree. */
  private allFindingsRoots(): string[] {
    const roots = new Set<string>()
    for (const bucket of ['web', 'internal', 'external', 'host'] as const) {
      roots.add(this.findingsRoot(bucket))
      roots.add(path.join(this.settings.dataDir, FINDINGS_DIRS[bucket]))
    }
    roots.add(path.join(this.settings.dataDir, LEGACY_INT_EXT_DIR))
    return [...roots]
  }

  private filePath(name: CollectionName): string {
    return path.join(this.settings.dataDir, `${name}.json`)
  }

  private atomicWrite(file: string, data: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${randomUUID()}.tmp`
    fs.writeFileSync(tmp, data, 'utf-8')
    fs.renameSync(tmp, file)
  }

  private readJson(file: string): BaseEntity[] {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      const items = Array.isArray(data) ? data : [data]
      // Only portal records carry an id — skip foreign JSON (e.g. raw Power
      // Automate exports) that may share a user-chosen folder.
      return items.filter((x) => x && typeof x.id === 'string')
    } catch {
      return []
    }
  }

  // ------------------------------------------------------------- loading

  private load(name: CollectionName): BaseEntity[] {
    if (name === 'findings') return this.loadFindings()
    if (name === 'hosts') return this.loadHosts()
    if (name === 'requests') return this.loadRequests()
    return this.readJson(this.filePath(name))
  }

  /**
   * One file per request (`requests/VAPT-<code>.json`) in the Power Automate
   * export schema (v6.6.6, see pa-format.ts). Flat pre-v6.6.6 records and raw
   * PA exports without a `portal` block are accepted too.
   */
  private loadRequests(): BaseEntity[] {
    const items: BaseEntity[] = []
    const seen = new Set<string>()
    const roots = new Set([this.requestsRoot(), path.join(this.settings.dataDir, 'requests')])
    for (const root of roots) {
      for (const file of walkJsonFiles(root)) {
        try {
          const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
          for (const entry of Array.isArray(data) ? data : [data]) {
            const item = fromPaRequestFile(entry)
            if (!item || seen.has(item.id)) continue
            seen.add(item.id)
            items.push(item)
          }
        } catch {
          /* unreadable file — skip */
        }
      }
    }
    // Legacy single requests.json: load once; the per-file tree becomes canonical on next write.
    if (fs.existsSync(this.filePath('requests'))) {
      items.push(...this.readJson(this.filePath('requests')).filter((x) => !seen.has(x.id)))
    }
    return items
  }

  private loadFindings(): BaseEntity[] {
    const items: BaseEntity[] = []
    const seen = new Set<string>()
    for (const root of this.allFindingsRoots()) {
      for (const file of walkJsonFiles(root)) {
        for (const item of this.readJson(file)) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          items.push(item)
        }
      }
    }
    // Legacy pre-v3 single file: load once; the tree becomes canonical on next write.
    if (fs.existsSync(this.filePath('findings'))) {
      items.push(...this.readJson(this.filePath('findings')).filter((x) => !seen.has(x.id)))
    }
    return items
  }

  private loadHosts(): BaseEntity[] {
    const items: BaseEntity[] = []
    for (const file of walkJsonFiles(path.join(this.settings.dataDir, 'hosts'))) {
      if (path.basename(file) === 'summary.json') continue
      items.push(...this.readJson(file))
    }
    if (fs.existsSync(this.filePath('hosts'))) {
      const ids = new Set(items.map((x) => x.id))
      items.push(...this.readJson(this.filePath('hosts')).filter((x) => !ids.has(x.id)))
    }
    return items
  }

  // ------------------------------------------------------------- persisting

  private persist(name: CollectionName): void {
    if (name === 'findings') return this.persistFindings()
    if (name === 'hosts') return this.persistHosts()
    if (name === 'requests') return this.persistRequests()
    this.atomicWrite(this.filePath(name), JSON.stringify(this.cache.get(name) ?? [], null, 2))
  }

  private persistRequests(): void {
    const requests = (this.cache.get('requests') ?? []) as VaptRequest[]
    const root = this.requestsRoot()
    const expected = new Set<string>()
    for (const r of requests) {
      let file = path.join(root, `${safeSeg(r.projectCode || r.id)}.json`)
      // Two requests should never share a project code, but never lose one to a collision.
      if (expected.has(file)) file = path.join(root, `${safeSeg(r.projectCode || 'request')}-${r.id}.json`)
      expected.add(file)
      this.atomicWrite(file, JSON.stringify(toPaRequestFile(r), null, 2))
    }
    // Clear stale copies from the active root and the default location (migration);
    // foreign JSON in a user-chosen folder is never touched.
    for (const dir of new Set([root, path.join(this.settings.dataDir, 'requests')])) {
      for (const file of walkJsonFiles(dir)) {
        if (!expected.has(file) && this.isPortalRecordFile(file)) fs.rmSync(file)
      }
    }
    // Remove the legacy single file so data isn't loaded twice.
    fs.rmSync(this.filePath('requests'), { force: true })
  }

  /**
   * Context directory (v6.6.14): everything belonging to one working context
   * lives together — findings.json, evidence/ (POC) and generated reports —
   * so the tree is browsable from SharePoint:
   *   <findings-root>/<timeframe>/<projectCode | application | assessment name>/
   * Adhoc contexts prefer the project code; annual/quarterly the application;
   * unmapped scanner imports fall back to the assessment name.
   */
  contextDir(a?: Assessment, fallbackApplicationId?: string): string {
    const category = a ? a.category || categoryOfType(a.type) : 'web'
    // Internal and external findings live in separate trees (v6.6.3);
    // Retests in the internal-external module default to the internal tree.
    const storageBucket =
      category === 'internal-external' ? (a?.type === 'External VA' ? 'external' : 'internal') : category
    const timeframe = a?.timeframe || 'adhoc'
    let name = ''
    if (timeframe === 'adhoc') {
      const req = a?.requestId ? this.get('requests', a.requestId) : undefined
      name = req?.projectCode || ''
    }
    const appId = a?.applicationId || fallbackApplicationId
    if (!name && appId) name = this.get('applications', appId)?.name ?? ''
    if (!name) name = a?.name || ''
    return path.join(
      this.findingsRoot(storageBucket as 'web' | 'internal' | 'external' | 'host'),
      timeframe,
      safeSeg(name || 'unassigned')
    )
  }

  /** Directory for one finding, per SRS v3 §3.3 (+ v6.6.14 context layout). */
  private findingFile(f: Finding, assessments: Map<string, Assessment>): string {
    const a = f.assessmentId ? assessments.get(f.assessmentId) : undefined
    const dir = this.contextDir(a, f.applicationId)
    const category = a ? a.category || categoryOfType(a.type) : 'web'
    if (category === 'host' && (a?.timeframe || 'adhoc') === 'adhoc') {
      // Per-host subfolder named by IP (v6.6.14) — browsable, unlike the record id.
      const host = f.hostId ? this.get('hosts', f.hostId) : undefined
      return path.join(dir, safeSeg(host?.ip || f.hostId), 'findings.json')
    }
    return path.join(dir, 'findings.json')
  }

  private persistFindings(): void {
    const findings = (this.cache.get('findings') ?? []) as Finding[]
    const assessments = new Map((this.list('assessments') as Assessment[]).map((a) => [a.id, a]))
    const byFile = new Map<string, Finding[]>()
    for (const f of findings) {
      const file = this.findingFile(f, assessments)
      if (!byFile.has(file)) byFile.set(file, [])
      byFile.get(file)!.push(f)
    }
    // Rewrite the whole tree: clear stale files (including default locations
    // and the legacy combined internal-external tree), then write current groups.
    for (const root of this.allFindingsRoots()) {
      for (const file of walkJsonFiles(root)) {
        if (!byFile.has(file) && this.isPortalRecordFile(file)) fs.rmSync(file)
      }
    }
    for (const [file, group] of byFile) {
      this.atomicWrite(file, JSON.stringify(group, null, 2))
    }
    // Remove the legacy single file so data isn't loaded twice.
    fs.rmSync(this.filePath('findings'), { force: true })
  }

  private persistHosts(): void {
    const hosts = (this.cache.get('hosts') ?? []) as Host[]
    const root = path.join(this.settings.dataDir, 'hosts')
    const byDir = new Map<string, Host[]>()
    for (const h of hosts) {
      const dir = path.join(root, safeSeg(h.sourceFile || 'manual'))
      if (!byDir.has(dir)) byDir.set(dir, [])
      byDir.get(dir)!.push(h)
    }
    const expected = new Set<string>()
    for (const [dir, group] of byDir) {
      for (const h of group) {
        const file = path.join(dir, `${safeSeg(h.ip || h.id)}.json`)
        expected.add(file)
        this.atomicWrite(file, JSON.stringify(h, null, 2))
      }
      const summary = path.join(dir, 'summary.json')
      expected.add(summary)
      this.atomicWrite(
        summary,
        JSON.stringify(
          {
            source: path.basename(dir),
            hostCount: group.length,
            ips: group.map((h) => h.ip).sort(),
            updatedAt: new Date().toISOString()
          },
          null,
          2
        )
      )
    }
    for (const file of walkJsonFiles(root)) {
      if (!expected.has(file)) fs.rmSync(file)
    }
    fs.rmSync(this.filePath('hosts'), { force: true })
  }

  // ------------------------------------------------------------- CRUD

  list<K extends CollectionName>(name: K): CollectionMap[K][] {
    if (!this.cache.has(name)) this.cache.set(name, this.load(name))
    return this.cache.get(name) as CollectionMap[K][]
  }

  get<K extends CollectionName>(name: K, id: string): CollectionMap[K] | undefined {
    return this.list(name).find((x) => x.id === id)
  }

  create<K extends CollectionName>(name: K, data: Partial<CollectionMap[K]>): CollectionMap[K] {
    const now = new Date().toISOString()
    const item = { ...data, id: data.id || randomUUID(), createdAt: now, updatedAt: now } as CollectionMap[K]
    this.list(name).push(item)
    this.persist(name)
    return item
  }

  createMany<K extends CollectionName>(name: K, rows: Partial<CollectionMap[K]>[]): CollectionMap[K][] {
    const now = new Date().toISOString()
    const items = rows.map(
      (data) => ({ ...data, id: data.id || randomUUID(), createdAt: now, updatedAt: now }) as CollectionMap[K]
    )
    this.list(name).push(...items)
    this.persist(name)
    return items
  }

  update<K extends CollectionName>(name: K, id: string, patch: Partial<CollectionMap[K]>): CollectionMap[K] {
    const items = this.list(name)
    const idx = items.findIndex((x) => x.id === id)
    if (idx === -1) throw new Error(`${name}/${id} not found`)
    items[idx] = { ...items[idx], ...patch, id, updatedAt: new Date().toISOString() }
    this.persist(name)
    return items[idx]
  }

  remove(name: CollectionName, id: string): void {
    this.cache.set(
      name,
      this.list(name).filter((x) => x.id !== id)
    )
    this.persist(name)
  }

  /** Bulk removal with a single persist — the on-disk tree is rewritten once. */
  removeMany(name: CollectionName, ids: string[]): void {
    if (ids.length === 0) return
    const gone = new Set(ids)
    this.cache.set(
      name,
      this.list(name).filter((x) => !gone.has(x.id))
    )
    this.persist(name)
  }

  /** Repartition stored findings/hosts after metadata that affects their paths changes. */
  repartition(): void {
    this.list('findings')
    this.list('hosts')
    this.persistFindings()
    this.persistHosts()
  }

  /** Copy of every collection, e.g. for export/backup. */
  snapshot(): Record<CollectionName, BaseEntity[]> {
    const out = {} as Record<CollectionName, BaseEntity[]>
    for (const c of COLLECTIONS) out[c] = this.list(c)
    return out
  }
}
