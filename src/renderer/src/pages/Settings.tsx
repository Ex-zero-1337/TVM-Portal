import { Fragment, useCallback, useEffect, useState } from 'react'
import type { Appearance, LogCategory, LogEntry, LogLevel, LogQuery, ScannerConnection, Settings } from '@shared/types'
import { LOG_CATEGORIES, LOG_LEVELS, SCANNER_TYPES } from '@shared/types'
import { api } from '../api'
import { useDb } from '../data'
import { applyAppearance } from '../theme'
import { Modal, StatusBadge } from '../components/ui'

const APPEARANCE_OPTIONS: { value: Appearance; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', hint: 'Always use the dark theme.' },
  { value: 'system', label: 'System Default', hint: 'Follow the operating system theme automatically.' }
]

const SECTIONS = ['General', 'Storage', 'Scanner Connections', 'Report Templates', 'Backup', 'Logs', 'About'] as const
type Section = (typeof SECTIONS)[number]

function newScanner(): ScannerConnection {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'Nessus',
    url: 'https://scanner.local:8834',
    accessKey: '',
    secretKey: '',
    isDefault: false
  }
}

export function SettingsPage() {
  const db = useDb()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [section, setSection] = useState<Section>('General')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    void api.getSettings().then(setSettings)
  }, [])

  if (!settings) return <div className="page">Loading…</div>

  const save = async (patch: Partial<Settings>, msg = 'Saved.') => {
    const next = await api.setSettings(patch)
    setSettings(next)
    setSaved(msg)
    await db.reload()
  }

  const chooseDataDir = async () => {
    const dir = await api.chooseDir()
    if (dir) await save({ dataDir: dir, reportsDir: `${dir}/reports` }, 'Data folder updated.')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s} className={section === s ? 'active' : ''} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {saved && <p className="sla-ok">{saved}</p>}

          {section === 'General' && (
            <div className="card">
              <h3>Appearance</h3>
              <p className="muted">Theme applies across the whole application. Exported reports keep the standard report formatting.</p>
              <div className="appearance-options">
                {APPEARANCE_OPTIONS.map((o) => (
                  <label key={o.value} className="appearance-option">
                    <input
                      type="radio"
                      name="appearance"
                      checked={(settings.appearance ?? 'system') === o.value}
                      onChange={() => {
                        applyAppearance(o.value)
                        void save({ appearance: o.value }, 'Appearance updated.')
                      }}
                    />
                    <span>
                      <b>{o.label}</b>
                      <span className="muted"> — {o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {section === 'General' && (
            <div className="card">
              <h3>Remediation SLAs</h3>
              <p className="muted">SLA windows are applied automatically from a finding's severity and discovery date.</p>
              <table className="sla-table">
                <tbody>
                  <tr><td>Critical</td><td>30 days</td></tr>
                  <tr><td>High</td><td>60 days</td></tr>
                  <tr><td>Medium</td><td>90 days</td></tr>
                  <tr><td>Low</td><td>180 days</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {section === 'Storage' && (
            <>
              <div className="card">
                <h3>Data Folder</h3>
                <p className="muted">
                  All data is stored as JSON files in a single folder — no database. Point this at a
                  SharePoint/OneDrive-synced folder to share with the team and enable Power Automate intake. Fully
                  portable: copy the folder to move the workspace.
                </p>
                <div className="settings-row">
                  <code>{settings.dataDir}</code>
                  <button onClick={chooseDataDir}>Change folder…</button>
                  <button onClick={() => api.openPath(settings.dataDir)}>Open in file manager</button>
                </div>
              </div>
              <div className="card">
                <h3>Reports Folder</h3>
                <div className="settings-row">
                  <code>{settings.reportsDir}</code>
                  <button onClick={() => api.openPath(settings.reportsDir)}>Open in file manager</button>
                </div>
              </div>
            </>
          )}

          {section === 'Scanner Connections' && (
            <ScannerSettings settings={settings} onSave={save} />
          )}

          {section === 'Report Templates' && (
            <div className="card">
              <h3>Report Templates</h3>
              <p className="muted">
                Report structure and formats (Excel / Word / PDF, Executive &amp; Full Technical) are documented in
                <code>REPORTING.md</code> and generated from the Reports page. Custom template files are not required in
                this version.
              </p>
            </div>
          )}

          {section === 'Logs' && <LogsSettings settings={settings} onSave={save} />}

          {section === 'Backup' && (
            <div className="card">
              <h3>Backup</h3>
              <p className="muted">
                Because all data lives in the data folder as plain files, a backup is a copy of that folder. Use your
                normal file backup / OneDrive version history.
              </p>
              <div className="settings-row">
                <button onClick={() => api.openPath(settings.dataDir)}>Open data folder to copy</button>
              </div>
            </div>
          )}

          {section === 'About' && (
            <div className="card">
              <h3>About</h3>
              <p>
                <b>TVM Portal</b> — Threat &amp; Vulnerability Management System.
              </p>
              <p className="muted">
                Filesystem-first, offline-first desktop VAPT management (Electron + React). SRS baseline plus patches
                v3–v6.1. See <code>USER-GUIDE.md</code>, <code>POWER-AUTOMATE.md</code> and <code>REPORTING.md</code>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Settings → Logs (SRS v6.3 §10–§12): view/search/filter/export/clear logs,
 * generate the diagnostic bundle, and configure retention + DEBUG capture.
 */
function LogsSettings({
  settings,
  onSave
}: {
  settings: Settings
  onSave: (patch: Partial<Settings>, msg?: string) => Promise<void>
}) {
  const db = useDb()
  const [filters, setFilters] = useState<LogQuery>({})
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState('')
  const [retention, setRetention] = useState(settings.logRetentionDays || 30)
  // Clear Logs is destructive: it arms a modal that requires typing the
  // keyword "clear" before the action is enabled.
  const [clearArmed, setClearArmed] = useState(false)
  const [clearWord, setClearWord] = useState('')
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await api.logQuery({ ...filters, limit: 300 }))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const set = (patch: Partial<LogQuery>) => setFilters((f) => ({ ...f, ...patch }))

  const clearConfirmed = clearWord.trim().toLowerCase() === 'clear'

  // Only arm the confirm prompter when there is something to clear —
  // otherwise report "no log records" instead of asking for the keyword.
  const armClear = async () => {
    setNotice('')
    try {
      const any = await api.logQuery({ limit: 1 })
      if (any.length === 0) {
        setNotice('No log records found — nothing to clear.')
        return
      }
      setClearArmed(true)
    } catch (e) {
      alert(`Could not read logs: ${e instanceof Error ? e.message : e}`)
    }
  }

  const clearLogs = async () => {
    if (!clearConfirmed || clearing) return
    // Close the prompter immediately; the delete + list refresh run behind it.
    setClearArmed(false)
    setClearWord('')
    setClearing(true)
    try {
      const removed = await api.logClear()
      setNotice(removed > 0 ? `Logs cleared — ${removed} file(s) removed.` : 'No log records found — nothing to clear.')
      await refresh()
    } catch (e) {
      alert(`Clear logs failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <div className="card">
        <h3>Log Settings</h3>
        <div className="settings-row">
          <label className="inline-check">
            Retention (days)
            <input
              type="number"
              min={1}
              style={{ width: 90 }}
              value={retention}
              onChange={(e) => setRetention(parseInt(e.target.value) || 30)}
              onBlur={() => void onSave({ logRetentionDays: Math.max(1, retention) }, 'Log retention updated.')}
            />
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={settings.debugLogging ?? false}
              onChange={(e) => void onSave({ debugLogging: e.target.checked }, 'Debug logging updated.')}
            />
            Capture DEBUG entries
          </label>
          <span className="spacer" />
          <button onClick={() => void api.logExport(filters)}>⬇ Export Logs</button>
          <button onClick={() => void api.logDiagnostics()}>🧰 Generate Diagnostic Bundle</button>
          <button className="danger" onClick={() => void armClear()}>
            🗑 Clear Logs
          </button>
        </div>
        {notice && <p className="sla-ok">{notice}</p>}

        {clearArmed && (
          <Modal
            title="Clear all logs?"
            onClose={() => {
              setClearArmed(false)
              setClearWord('')
            }}
          >
            <p>
              This permanently deletes every log file. Export first if you need to keep them — this cannot be undone.
            </p>
            <p>
              Type <code>clear</code> to confirm:
            </p>
            <input
              autoFocus
              value={clearWord}
              placeholder="clear"
              onChange={(e) => setClearWord(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && clearConfirmed) void clearLogs()
              }}
            />
            <div className="modal-actions">
              <span className="spacer" />
              <button
                onClick={() => {
                  setClearArmed(false)
                  setClearWord('')
                }}
              >
                Cancel
              </button>
              <button className="danger" disabled={!clearConfirmed || clearing} onClick={() => void clearLogs()}>
                {clearing ? 'Clearing…' : 'Clear Logs'}
              </button>
            </div>
          </Modal>
        )}
        <p className="muted">
          Daily log files live in the data folder under <code>logs/</code>; files older than the retention window are
          deleted automatically. The diagnostic bundle contains logs, configuration and system info with all secrets
          redacted. Export honours the filters below.
        </p>
      </div>

      <div className="card">
        <h3>View Logs</h3>
        <div className="findings-filter log-filter">
          <label>
            <span>From</span>
            <input type="date" value={filters.dateFrom ?? ''} onChange={(e) => set({ dateFrom: e.target.value })} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={filters.dateTo ?? ''} onChange={(e) => set({ dateTo: e.target.value })} />
          </label>
          <label>
            <span>Level</span>
            <select value={filters.level ?? ''} onChange={(e) => set({ level: e.target.value as LogLevel | '' })}>
              <option value="">All</option>
              {LOG_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Category</span>
            <select
              value={filters.category ?? ''}
              onChange={(e) => set({ category: e.target.value as LogCategory | '' })}
            >
              <option value="">All</option>
              {LOG_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Application</span>
            <select value={filters.applicationId ?? ''} onChange={(e) => set({ applicationId: e.target.value })}>
              <option value="">All</option>
              {db.applications.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Project Code</span>
            <input
              placeholder="VAPT-…"
              value={filters.projectCode ?? ''}
              onChange={(e) => set({ projectCode: e.target.value })}
            />
          </label>
          <label>
            <span>Keyword</span>
            <input
              type="search"
              placeholder="Search message, module, details…"
              value={filters.keyword ?? ''}
              onChange={(e) => set({ keyword: e.target.value })}
            />
          </label>
          <button onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Loading…' : '⟳ Refresh'}
          </button>
        </div>

        <div className="table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Category</th>
                <th>Module</th>
                <th>Action</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No log entries match the filters.
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    className="clickable"
                    onClick={() => setExpanded((prev) => (prev === e.id ? '' : e.id))}
                  >
                    <td className="log-time">{new Date(e.timestamp).toLocaleString()}</td>
                    <td>
                      <StatusBadge value={e.level} />
                    </td>
                    <td>{e.category}</td>
                    <td>{e.module}</td>
                    <td>{e.action || '—'}</td>
                    <td className="log-message">{e.message}</td>
                  </tr>
                  {expanded === e.id && (
                    <tr>
                      <td colSpan={6} className="log-detail">
                        <div>
                          <b>Source:</b> {e.source || '—'} · <b>Page:</b> {e.page || '—'} · <b>Status:</b>{' '}
                          {e.status || '—'}
                          {e.projectCode && (
                            <>
                              {' '}
                              · <b>Project Code:</b> {e.projectCode}
                            </>
                          )}
                          {e.applicationId && (
                            <>
                              {' '}
                              · <b>Application:</b> {db.appName(e.applicationId)}
                            </>
                          )}
                        </div>
                        {e.failureReason && (
                          <div>
                            <b>Failure reason:</b> {e.failureReason}
                          </div>
                        )}
                        {e.details && <pre className="log-stack">{e.details}</pre>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Showing the {entries.length} most recent matching entrie(s), newest first.</p>
      </div>
    </>
  )
}

function ScannerSettings({
  settings,
  onSave
}: {
  settings: Settings
  onSave: (patch: Partial<Settings>, msg?: string) => Promise<void>
}) {
  const [scanners, setScanners] = useState<ScannerConnection[]>(settings.scanners)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  const persist = (next: ScannerConnection[]) => {
    setScanners(next)
    void onSave({ scanners: next }, 'Scanner connections saved.')
  }

  const patch = (id: string, p: Partial<ScannerConnection>) =>
    setScanners((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)))

  const setDefault = (id: string) =>
    persist(scanners.map((s) => ({ ...s, isDefault: s.id === id })))

  const test = async (conn: ScannerConnection) => {
    setTesting(conn.id)
    try {
      const res = await api.scannerTest(conn)
      setTestResult((r) => ({ ...r, [conn.id]: (res.ok ? '✓ ' : '✗ ') + res.message }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="card">
      <h3>Scanner Connections</h3>
      <p className="muted">
        Connect to Nessus (Professional / Manager) or Tenable.io using API keys to fetch scans directly into an
        assessment. Manual <code>.nessus</code>/CSV upload remains available as a fallback.
      </p>

      {scanners.map((s) => (
        <div key={s.id} className="scanner-card">
          <div className="form-grid">
            <label>
              <span>Scanner Name</span>
              <input value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} onBlur={() => persist(scanners)} />
            </label>
            <label>
              <span>Type</span>
              <select value={s.type} onChange={(e) => { patch(s.id, { type: e.target.value as ScannerConnection['type'] }); }}>
                {SCANNER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="span2">
              <span>Scanner URL</span>
              <input
                value={s.url}
                placeholder="https://host:8834 (Nessus) or https://cloud.tenable.com"
                onChange={(e) => patch(s.id, { url: e.target.value })}
                onBlur={() => persist(scanners)}
              />
            </label>
            <label>
              <span>Access Key</span>
              <input value={s.accessKey} onChange={(e) => patch(s.id, { accessKey: e.target.value })} onBlur={() => persist(scanners)} />
            </label>
            <label>
              <span>Secret Key</span>
              <input type="password" value={s.secretKey} onChange={(e) => patch(s.id, { secretKey: e.target.value })} onBlur={() => persist(scanners)} />
            </label>
          </div>
          <div className="scanner-actions">
            <label className="inline-check">
              <input type="checkbox" checked={s.isDefault} onChange={() => setDefault(s.id)} /> Default scanner
            </label>
            <span className="spacer" />
            <button onClick={() => test(s)} disabled={testing === s.id}>
              {testing === s.id ? 'Testing…' : 'Test Connection'}
            </button>
            <button className="danger" onClick={() => persist(scanners.filter((x) => x.id !== s.id))}>
              Remove
            </button>
          </div>
          {testResult[s.id] && (
            <p className={testResult[s.id].startsWith('✓') ? 'sla-ok' : 'form-error'}>{testResult[s.id]}</p>
          )}
        </div>
      ))}

      <button className="primary" onClick={() => persist([...scanners, newScanner()])}>
        + Add Scanner
      </button>
    </div>
  )
}
