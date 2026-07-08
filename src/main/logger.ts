import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { LogEntry, LogQuery, Settings } from '../shared/types'

/**
 * Centralized logging (SRS v6.3). Daily JSON-lines files under
 * `<dataDir>/logs/`: `application-YYYY-MM-DD.log` (everything) and
 * `errors-YYYY-MM-DD.log` (ERROR level, duplicated for quick triage and the
 * diagnostic bundle). Writes are append-only and never throw — logging must
 * never take the app down. DEBUG entries are dropped unless enabled in
 * Settings; retention deletes files older than `logRetentionDays`.
 */

/** Key/value secret scrubber (SRS v6.3 §9) — applied to every text field. */
const SECRET_RE =
  /\b(accesskey|secretkey|apikey|api[-_]key|password|passwd|pwd|token|secret|authorization|bearer|cookie|x-apikeys?)\b\s*[=:]\s*("[^"]*"|'[^']*'|[^\s;,)&"']+)/gi

export function redact(text: string): string {
  if (!text) return ''
  return text.replace(SECRET_RE, '$1=[redacted]')
}

/** Safe stack trace: capped depth, home directory anonymized, secrets scrubbed. */
export function safeStack(err: unknown): string {
  const stack = err instanceof Error ? (err.stack ?? err.message) : String(err)
  const home = os.homedir()
  return redact(
    stack
      .split('\n')
      .slice(0, 12)
      .map((l) => l.split(home).join('~'))
      .join('\n')
  )
}

const FILE_RE = /^(application|errors)-(\d{4}-\d{2}-\d{2})\.log$/

class Logger {
  private getSettings: (() => Settings) | null = null

  /** Called once at startup; also triggers retention cleanup. */
  init(getSettings: () => Settings): void {
    this.getSettings = getSettings
    this.rotate()
  }

  private get dir(): string {
    return path.join(this.getSettings!().dataDir, 'logs')
  }

  write(e: Partial<LogEntry>): void {
    try {
      const settings = this.getSettings?.()
      if (!settings) return
      const level = e.level ?? 'INFO'
      if (level === 'DEBUG' && !settings.debugLogging) return
      const entry: LogEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        level,
        category: e.category ?? 'System',
        module: e.module ?? 'main',
        source: e.source ?? '',
        page: e.page ?? '',
        action: e.action ?? '',
        status: e.status ?? (level === 'ERROR' ? 'failed' : 'ok'),
        message: redact(e.message ?? ''),
        failureReason: redact(e.failureReason ?? ''),
        details: redact(e.details ?? ''),
        projectCode: e.projectCode ?? '',
        applicationId: e.applicationId ?? ''
      }
      const day = entry.timestamp.slice(0, 10)
      const line = JSON.stringify(entry) + '\n'
      fs.mkdirSync(this.dir, { recursive: true })
      fs.appendFileSync(path.join(this.dir, `application-${day}.log`), line)
      if (level === 'ERROR') fs.appendFileSync(path.join(this.dir, `errors-${day}.log`), line)
    } catch {
      /* logging must never crash the app */
    }
  }

  /** ERROR entry from a caught exception: what/where/why/when (SRS v6.3 §8). */
  error(e: Partial<LogEntry> & { error?: unknown }): void {
    const { error, ...rest } = e
    this.write({
      category: 'Coding Errors',
      failureReason: error instanceof Error ? error.message : error !== undefined ? String(error) : '',
      details: error !== undefined ? safeStack(error) : '',
      ...rest,
      level: 'ERROR'
    })
  }

  private files(prefix: 'application' | 'errors'): { file: string; day: string }[] {
    try {
      return fs
        .readdirSync(this.dir)
        .map((f) => FILE_RE.exec(f))
        .filter((m): m is RegExpExecArray => !!m && m[1] === prefix)
        .map((m) => ({ file: path.join(this.dir, m[0]), day: m[2] }))
        .sort((a, b) => (a.day < b.day ? 1 : -1)) // newest first
    } catch {
      return []
    }
  }

  /** Filtered query, newest first (SRS v6.3 §11). */
  query(q: LogQuery): LogEntry[] {
    const limit = q.limit ?? 500
    const keyword = (q.keyword ?? '').trim().toLowerCase()
    const out: LogEntry[] = []
    for (const { file, day } of this.files('application')) {
      if (q.dateFrom && day < q.dateFrom) continue
      if (q.dateTo && day > q.dateTo) continue
      let lines: string[]
      try {
        lines = fs.readFileSync(file, 'utf-8').split('\n')
      } catch {
        continue
      }
      // Within a file, later lines are newer — walk backwards.
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue
        let entry: LogEntry
        try {
          entry = JSON.parse(lines[i]) as LogEntry
        } catch {
          continue
        }
        if (q.level && entry.level !== q.level) continue
        if (q.category && entry.category !== q.category) continue
        if (q.module && !entry.module.toLowerCase().includes(q.module.toLowerCase())) continue
        if (q.projectCode && !entry.projectCode.toLowerCase().includes(q.projectCode.toLowerCase())) continue
        if (q.applicationId && entry.applicationId !== q.applicationId) continue
        if (keyword && !JSON.stringify(entry).toLowerCase().includes(keyword)) continue
        out.push(entry)
      }
      if (out.length >= limit) break
    }
    return out
  }

  /** Newest content of the daily files, capped, for exports and the bundle. */
  tail(prefix: 'application' | 'errors', maxBytes: number): string {
    let out = ''
    for (const { file } of this.files(prefix)) {
      try {
        out += fs.readFileSync(file, 'utf-8')
      } catch {
        /* skip unreadable file */
      }
      if (out.length >= maxBytes) break
    }
    return out.slice(0, maxBytes)
  }

  /** Manual cleanup (SRS v6.3 §12); caller is responsible for export-first UX. */
  clear(): number {
    let removed = 0
    for (const prefix of ['application', 'errors'] as const) {
      for (const { file } of this.files(prefix)) {
        try {
          fs.rmSync(file, { force: true })
          removed++
        } catch {
          /* leave locked files in place */
        }
      }
    }
    return removed
  }

  /** Retention: delete daily files older than the configured window. */
  rotate(): void {
    const settings = this.getSettings?.()
    if (!settings) return
    const days = Math.max(1, settings.logRetentionDays || 30)
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    for (const prefix of ['application', 'errors'] as const) {
      for (const { file, day } of this.files(prefix)) {
        if (day < cutoff) {
          try {
            fs.rmSync(file, { force: true })
          } catch {
            /* best effort */
          }
        }
      }
    }
  }
}

export const logger = new Logger()
