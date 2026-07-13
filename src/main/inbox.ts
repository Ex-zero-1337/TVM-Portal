import fs from 'fs'
import path from 'path'
import type { VaptRequest } from '../shared/types'
import { Store } from './store'
import { prepareRequest } from './ipc'
import { logger } from './logger'
import { assessmentTypeOf, cleanPaText as clean, normalizeDate, requestStatusOf } from './pa-format'

/**
 * Power Automate integration (live updates): watches `<dataDir>/inbox/` for
 * request files dropped by a flow (via a SharePoint/OneDrive-synced folder).
 * Each file named `VAPT*.json` or `VAPT*.txt` becomes a VAPT request (other
 * files are ignored and left in place); processed files move to
 * `inbox/processed/`, unparseable ones to `inbox/failed/`. See POWER-AUTOMATE.md.
 */
export class InboxWatcher {
  private watcher: fs.FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private store: Store,
    private onChange: () => void
  ) {}

  private get inboxDir(): string {
    return path.join(this.store.getSettings().dataDir, 'inbox')
  }

  start(): void {
    this.stop()
    const dir = this.inboxDir
    fs.mkdirSync(path.join(dir, 'processed'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'failed'), { recursive: true })
    this.processAll()
    try {
      this.watcher = fs.watch(dir, () => this.schedule())
    } catch {
      /* watching is best-effort; the poll below still runs */
    }
    // Synced folders (OneDrive/SharePoint) don't always emit fs events — poll as backup.
    this.timer = setInterval(() => this.processAll(), 30_000)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Debounce bursts of fs events into one scan. */
  private scheduled: NodeJS.Timeout | null = null
  private schedule(): void {
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = setTimeout(() => this.processAll(), 500)
  }

  private processAll(): void {
    const dir = this.inboxDir
    let entries: string[] = []
    try {
      // Only request files (VAPT*.json / VAPT*.txt) are consumed; anything
      // else in the folder is left untouched.
      entries = fs.readdirSync(dir).filter((f) => /^vapt.*\.(json|txt)$/i.test(f))
    } catch {
      return
    }
    let created = 0
    for (const name of entries) {
      const file = path.join(dir, name)
      try {
        if (this.processFile(file)) {
          created++
          logger.write({
            category: 'Import / Export',
            module: 'inbox',
            source: 'inbox.ts',
            action: 'intake request',
            message: `Power Automate inbox created a request from ${name}`
          })
        }
        this.moveTo(file, 'processed')
      } catch (e) {
        console.error(`inbox: failed to process ${name}:`, e)
        logger.error({
          category: 'Import / Export',
          module: 'inbox',
          source: 'inbox.ts',
          action: 'intake request',
          message: `Inbox file ${name} could not be parsed — moved to inbox/failed/`,
          error: e
        })
        this.moveTo(file, 'failed')
      }
    }
    if (created > 0) this.onChange()
  }

  private moveTo(file: string, bucket: 'processed' | 'failed'): void {
    const dest = path.join(this.inboxDir, bucket, `${Date.now()}-${path.basename(file)}`)
    try {
      fs.renameSync(file, dest)
    } catch {
      fs.rmSync(file, { force: true })
    }
  }

  /** Returns true when a request was created (false = duplicate skipped). */
  private processFile(file: string): boolean {
    const raw = fs.readFileSync(file, 'utf-8')
    let data: Partial<VaptRequest>
    if (file.endsWith('.json')) {
      const j = JSON.parse(raw) as Record<string, string>
      data = {
        title: clean(j.subject || j.title || j.systemName || j.system) || 'Untitled request',
        // `requestNumber` is the native Power Automate export field (VAPT-YYYYMMDD-HHMMSS).
        projectCode: j.projectCode || j.requestNumber || '',
        requestedBy: clean(j.name || j.requestedBy),
        requesterEmail: clean(j.email || j.emailAddress),
        department: clean(j.department || j.departmentDivision),
        systemName: clean(j.systemName || j.system),
        targetUatDate: normalizeDate(
          j.targetUatCompletion || j.targetUatDate || j.targetDateOfUatCompletionServerReadiness
        ),
        goLiveDate: normalizeDate(j.goLiveDate || j.goLive || j.targetDateToGoLive),
        purpose: clean(j.purpose),
        scope: clean(j.scope),
        // Notes stay empty for the analyst — every export field is shown in
        // the request detail view, so no auto-summary is duplicated here.
        notes: j.notes || '',
        // Keep the verbatim export so the stored request file round-trips
        // the Power Automate schema exactly (v6.6.6, see pa-format.ts).
        source: j
      }
      const assessmentType = assessmentTypeOf(j.typeOfSystem)
      if (assessmentType) data.assessmentType = assessmentType
      // Status reflects the export's approvalStatus (v6.6.13); editable afterwards.
      const status = requestStatusOf(j.approvalStatus)
      if (status) data.status = status
    } else {
      // Plain text: first line is the subject, rest goes to notes.
      const [subject, ...rest] = raw.split('\n')
      data = {
        title: subject.trim() || 'Untitled request',
        notes: rest.join('\n').trim() || `Imported from Power Automate inbox (${path.basename(file)})`
      }
    }
    const prepared = prepareRequest({
      status: 'New',
      priority: 'Medium',
      environment: 'Production',
      assessmentType: 'Web',
      ...data
    })
    // Idempotency: a project code that already exists means the flow re-delivered.
    if (prepared.projectCode && this.store.list('requests').some((r) => r.projectCode === prepared.projectCode)) {
      return false
    }
    this.store.create('requests', prepared)
    return true
  }
}

/**
 * Live requests-folder watcher (v6.6.7): requests are one file each, so
 * adding/deleting `*.json` files externally (Finder, SharePoint sync, a
 * Power Automate flow writing straight into the folder) reflects in the UI
 * without restarting the app. Changes are detected via fs events plus a
 * 30-second signature poll (synced folders don't always emit events); the
 * portal's own writes fire too, which just causes a harmless cache refresh.
 */
export class RequestsWatcher {
  private watcher: fs.FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private scheduled: NodeJS.Timeout | null = null
  private lastSig = ''

  constructor(
    private store: Store,
    private onChange: () => void
  ) {}

  private get dir(): string {
    return this.store.requestsDirPath()
  }

  /** Cheap change detector: file names + mtimes + sizes. */
  private signature(): string {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => {
          const st = fs.statSync(path.join(this.dir, f))
          return `${f}:${st.mtimeMs}:${st.size}`
        })
        .join('|')
    } catch {
      return ''
    }
  }

  start(): void {
    this.stop()
    try {
      fs.mkdirSync(this.dir, { recursive: true })
    } catch {
      /* folder may be created later; the poll keeps trying */
    }
    this.lastSig = this.signature()
    try {
      this.watcher = fs.watch(this.dir, () => this.schedule())
    } catch {
      /* watching is best-effort; the poll below still runs */
    }
    this.timer = setInterval(() => this.check(), 30_000)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = null
  }

  private schedule(): void {
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = setTimeout(() => this.check(), 500)
  }

  private check(): void {
    const sig = this.signature()
    if (sig === this.lastSig) return
    this.lastSig = sig
    this.store.invalidate('requests')
    this.onChange()
    logger.write({
      category: 'Import / Export',
      module: 'inbox',
      source: 'inbox.ts',
      action: 'requests folder changed',
      message: 'Requests folder changed on disk — reloaded live'
    })
  }
}

