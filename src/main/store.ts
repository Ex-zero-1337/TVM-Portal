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
  Settings
} from '../shared/types'
import { categoryOfType } from '../shared/types'

const COLLECTIONS: CollectionName[] = [
  'requests',
  'applications',
  'hosts',
  'assessments',
  'findings',
  'kb',
  'notifications'
]

const FINDINGS_DIRS: Record<string, string> = {
  web: 'web-findings',
  'internal-external': 'internal-external-findings',
  host: 'host-findings'
}

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
    this.settings = { ...this.settings, ...patch }
    this.atomicWrite(this.configPath, JSON.stringify(this.settings, null, 2))
    this.cache.clear()
    this.ensureDataDir()
    return this.settings
  }

  private ensureDataDir(): void {
    fs.mkdirSync(this.settings.dataDir, { recursive: true })
    fs.mkdirSync(this.settings.reportsDir, { recursive: true })
    fs.mkdirSync(path.join(this.settings.dataDir, 'imports'), { recursive: true })
    fs.mkdirSync(path.join(this.settings.dataDir, 'evidence'), { recursive: true })
  }

  /** Absolute path for a data-folder-relative path (e.g. an evidence attachment). */
  resolve(rel: string): string {
    return path.join(this.settings.dataDir, rel)
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
      return Array.isArray(data) ? data : [data]
    } catch {
      return []
    }
  }

  // ------------------------------------------------------------- loading

  private load(name: CollectionName): BaseEntity[] {
    if (name === 'findings') return this.loadFindings()
    if (name === 'hosts') return this.loadHosts()
    return this.readJson(this.filePath(name))
  }

  private loadFindings(): BaseEntity[] {
    const items: BaseEntity[] = []
    for (const dir of Object.values(FINDINGS_DIRS)) {
      for (const file of walkJsonFiles(path.join(this.settings.dataDir, dir))) {
        items.push(...this.readJson(file))
      }
    }
    // Legacy pre-v3 single file: load once; the tree becomes canonical on next write.
    if (fs.existsSync(this.filePath('findings'))) {
      const ids = new Set(items.map((x) => x.id))
      items.push(...this.readJson(this.filePath('findings')).filter((x) => !ids.has(x.id)))
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
    this.atomicWrite(this.filePath(name), JSON.stringify(this.cache.get(name) ?? [], null, 2))
  }

  /** Directory for one finding, per SRS v3 §3.3. */
  private findingFile(f: Finding, assessments: Map<string, Assessment>): string {
    const a = f.assessmentId ? assessments.get(f.assessmentId) : undefined
    const category = a ? a.category || categoryOfType(a.type) : 'web'
    const timeframe = a?.timeframe || 'adhoc'
    const base = path.join(this.settings.dataDir, FINDINGS_DIRS[category], timeframe)

    let bucket: string
    if (timeframe === 'adhoc') {
      const req = a?.requestId ? this.get('requests', a.requestId) : undefined
      bucket = safeSeg(req?.projectCode || a?.requestId || a?.id || 'unassigned')
    } else {
      const appRec = f.applicationId ? this.get('applications', f.applicationId) : undefined
      bucket = safeSeg(appRec?.name || 'unassigned')
    }

    if (category === 'host' && timeframe === 'adhoc') {
      return path.join(base, bucket, safeSeg(f.hostId), 'findings.json')
    }
    return path.join(base, bucket, 'findings.json')
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
    // Rewrite the whole tree: clear stale files, then write current groups.
    for (const dir of Object.values(FINDINGS_DIRS)) {
      for (const file of walkJsonFiles(path.join(this.settings.dataDir, dir))) {
        if (!byFile.has(file)) fs.rmSync(file)
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
