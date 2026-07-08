import fs from 'fs'
import path from 'path'
import type { VaptRequest } from '../shared/types'
import { Store } from './store'
import { prepareRequest } from './ipc'
import { logger } from './logger'

/**
 * Power Automate integration (live updates): watches `<dataDir>/inbox/` for
 * request files dropped by a flow (via a SharePoint/OneDrive-synced folder).
 * Each `.json` or `.txt` file becomes a VAPT request; processed files move to
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
      entries = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json') || f.endsWith('.txt'))
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
        title: j.subject || j.title || 'Untitled request',
        projectCode: j.projectCode || '',
        requestedBy: j.name || j.requestedBy || '',
        requesterEmail: j.email || '',
        department: j.department || '',
        systemName: j.systemName || j.system || '',
        targetUatDate: normalizeDate(j.targetUatCompletion || j.targetUatDate),
        goLiveDate: normalizeDate(j.goLiveDate || j.goLive),
        purpose: j.purpose || '',
        scope: j.scope || '',
        notes: j.notes || `Imported from Power Automate inbox (${path.basename(file)})`
      }
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

/** Accept "30/6/2026" (Power Automate d/m/yyyy), "2026-06-30", or empty. */
export function normalizeDate(v?: string): string {
  if (!v) return ''
  const dmy = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const iso = v.trim().match(/^\d{4}-\d{2}-\d{2}/)
  return iso ? iso[0] : ''
}
