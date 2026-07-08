import { useEffect, useState } from 'react'
import type {
  Assessment,
  AssessmentCategory,
  NessusImportResult,
  ScanFetchProgress,
  ScannerConnection,
  ScannerScan
} from '@shared/types'
import { ASSESSMENT_STATUSES, CATEGORY_LABELS, CATEGORY_TYPES, SEVERITIES, TIMEFRAMES, categoryOfType } from '@shared/types'
import { isFindingOpen } from '@shared/sla'
import { api } from '../api'
import { useDb } from '../data'
import { CrudPage } from '../components/CrudPage'
import { Modal, SeverityBadge, StatusBadge } from '../components/ui'
import { RequestsPage } from './Requests'
import { FindingsPage } from './Findings'

const emptyImportResult = (): NessusImportResult => ({
  imported: 0,
  duplicates: 0,
  hostsCreated: 0,
  classifications: { New: 0, Existing: 0, Retest: 0, Regression: 0, 'Context Change': 0 },
  errors: []
})

function addImportResult(total: NessusImportResult, r: NessusImportResult): void {
  total.imported += r.imported
  total.duplicates += r.duplicates
  total.hostsCreated += r.hostsCreated
  for (const k of Object.keys(total.classifications) as (keyof NessusImportResult['classifications'])[]) {
    total.classifications[k] += r.classifications[k] ?? 0
  }
  total.errors.push(...r.errors)
}

/** Module policy mapping (SRS v6.5.1): scans are filtered by their **Nessus
 * Policy Name** — never by scan name, application, folder or project code. */
const POLICY_KEYWORDS: Record<AssessmentCategory, string[]> = {
  web: ['web'],
  'internal-external': ['internal', 'external'],
  host: ['host']
}

/**
 * Scanner-driven, policy-driven fetch (SRS v6.5): Fetch All / Fetch Selected
 * Only at module level. Each imported scan becomes its own assessment in the
 * module's table — no Application required; mapping can be completed later.
 */
function ModuleFetchModal({
  category,
  mode,
  onClose
}: {
  category: AssessmentCategory
  mode: 'all' | 'selected'
  onClose: () => void
}) {
  const db = useDb()
  const [scanners, setScanners] = useState<ScannerConnection[]>([])
  const [connId, setConnId] = useState('')
  const [scans, setScans] = useState<ScannerScan[] | null>(null)
  // Escape hatch when policy names don't match the module keywords (e.g.
  // custom policy naming): default off, so v6.5.1 strict filtering holds.
  const [includeNonMatching, setIncludeNonMatching] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<ScanFetchProgress | null>(null)
  const [batch, setBatch] = useState<{ index: number; total: number; name: string } | null>(null)
  const [summary, setSummary] = useState<{ created: number; result: NessusImportResult; failures: string[] } | null>(
    null
  )

  useEffect(() => {
    void api.getSettings().then((s) => {
      setScanners(s.scanners)
      setConnId(s.scanners.find((x) => x.isDefault)?.id ?? s.scanners[0]?.id ?? '')
    })
    return api.onScannerProgress(setProgress)
  }, [])

  const keywords = POLICY_KEYWORDS[category]
  // FR-NF-002/003: only Nessus Policy Name decides eligibility; unmatched
  // scans are neither displayed nor imported unless the user overrides.
  const matched = (scans ?? []).filter(
    (s) => includeNonMatching || keywords.some((k) => s.policy.toLowerCase().includes(k))
  )

  const retrieve = async () => {
    if (!connId) return
    setBusy(true)
    setError('')
    setScans(null)
    setSelected(new Set())
    try {
      // includePolicy: the policy name comes from each scan's detail record.
      setScans(await api.scannerListScans(connId, true))
    } catch (e) {
      setError(`Could not list scans: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Int/Ext module: the Nessus Policy Name decides Internal vs External;
  // other modules use their default type.
  const typeFor = (scan: ScannerScan) =>
    category === 'internal-external'
      ? /external/i.test(scan.policy)
        ? 'External VA'
        : 'Internal VA'
      : CATEGORY_TYPES[category][0]

  const importScans = async (list: ScannerScan[]) => {
    if (list.length === 0) return
    setBusy(true)
    setError('')
    const result = emptyImportResult()
    const failures: string[] = []
    let created = 0
    try {
      for (let i = 0; i < list.length; i++) {
        const scan = list[i]
        setBatch({ index: i, total: list.length, name: scan.name })
        setProgress({ scanId: scan.id, stage: 'export', percent: 0, message: 'Starting fetch…' })
        try {
          // Application intentionally empty (SRS v6.5): mapping happens later.
          const assessment = await api.create('assessments', {
            name: scan.name,
            applicationId: '',
            requestId: '',
            type: typeFor(scan),
            category,
            timeframe: 'adhoc',
            status: scan.status === 'completed' ? 'Completed' : 'In Progress',
            startDate: '',
            endDate: '',
            hostIds: [],
            tester: '',
            baselineAssessmentId: '',
            notes: `Imported from scanner (Nessus policy: ${scan.policy || 'unknown'})`
          })
          addImportResult(result, await api.scannerFetch(assessment.id, connId, scan.id, scan.name))
          created++
        } catch (e) {
          failures.push(`${scan.name}: ${e instanceof Error ? e.message : e}`)
        }
      }
      void api
        .logWrite({
          category: 'Assessment',
          module: 'renderer',
          source: 'ModuleFetchModal',
          action: mode === 'all' ? 'fetch all from scanner' : 'fetch selected from scanner',
          status: failures.length ? 'partial' : 'ok',
          message: `Imported ${created}/${list.length} scan(s) into ${CATEGORY_LABELS[category]} assessments (${result.imported} finding(s))`,
          failureReason: failures.slice(0, 3).join('; ')
        })
        .catch(() => {})
      await db.reload()
      setSummary({ created, result, failures })
    } finally {
      setBusy(false)
      setBatch(null)
      setProgress(null)
    }
  }

  const percent = batch
    ? Math.round(((batch.index + (progress?.percent ?? 0) / 100) / batch.total) * 100)
    : (progress?.percent ?? 0)
  const toImport = mode === 'all' ? matched : matched.filter((s) => selected.has(s.id))

  return (
    <Modal
      title={mode === 'all' ? 'Fetch All from Scanner' : 'Fetch Selected Only from Scanner'}
      onClose={onClose}
      wide
    >
      {scanners.length === 0 ? (
        <p className="muted">
          No scanner connections configured. Add one in <b>Settings → Scanner Connections</b>.
        </p>
      ) : summary ? (
        <>
          <div className="import-result">
            Created <b>{summary.created}</b> assessment(s) in {CATEGORY_LABELS[category]}. Imported{' '}
            <b>{summary.result.imported}</b> finding(s), skipped <b>{summary.result.duplicates}</b> duplicate(s),
            created <b>{summary.result.hostsCreated}</b> host(s).
            {summary.failures.length > 0 && (
              <div className="form-error">
                {summary.failures.length} scan(s) failed: {summary.failures.join(' · ')}
              </div>
            )}
          </div>
          <p className="muted">
            Assessments were imported without an application — open one and Edit to map it when ready.
          </p>
          <div className="modal-actions">
            <span className="spacer" />
            <button className="primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            Policy: <b>{keywords.map((k) => k[0].toUpperCase() + k.slice(1)).join(' / ')}</b> — scans are filtered by
            their <b>Nessus Policy Name</b>. No application is required; imported assessments can be mapped later.
          </p>
          <div className="compare-controls">
            <label>
              <span>Scanner</span>
              <select value={connId} onChange={(e) => setConnId(e.target.value)} disabled={busy}>
                {scanners.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={retrieve} disabled={busy || !connId}>
              {busy && !progress ? 'Reading scan policies…' : 'Retrieve scans'}
            </button>
            {scans && (
              <label className="inline-check" title="Use when your Nessus policy names don't match the module policy">
                <input
                  type="checkbox"
                  checked={includeNonMatching}
                  onChange={(e) => setIncludeNonMatching(e.target.checked)}
                />
                Include scans not matching the policy
              </label>
            )}
          </div>

          {busy && progress && (
            <div className="fetch-progress">
              <div className="fetch-progress-track">
                <div className="fetch-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="fetch-progress-label">
                {batch ? `Scan ${batch.index + 1}/${batch.total}: ${batch.name} — ` : ''}
                {progress.message} ({percent}%)
              </div>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          {scans && (
            <>
              <p className="muted">
                {matched.length} of {scans.length} scan(s) match the module policy by Nessus Policy Name
                {scans.length - matched.length > 0 ? ` — ${scans.length - matched.length} hidden (non-matching or no policy)` : ''}
                .
              </p>
              <div className="kb-pick-list">
                {matched.map((s) => (
                  <label key={s.id} className="kb-pick scan-pick">
                    {mode === 'selected' && (
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} disabled={busy} />
                    )}
                    <StatusBadge value={s.status === 'completed' ? 'Completed' : s.status} /> {s.name}
                    <span className="muted">
                      {s.policy || 'no policy'} · {s.lastModified}
                    </span>
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                {mode === 'selected' && (
                  <button onClick={() => setSelected(new Set(matched.map((s) => s.id)))} disabled={busy}>
                    Select all
                  </button>
                )}
                <span className="spacer" />
                <button onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button className="primary" onClick={() => importScans(toImport)} disabled={busy || toImport.length === 0}>
                  {busy ? 'Importing…' : `Import ${toImport.length} scan(s)`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}

/**
 * Fetch one scan or all listed scans from a configured scanner (SRS v4 §5,
 * §10), with live stage/percentage progress streamed from the main process.
 */
function ScannerFetchModal({
  assessmentId,
  onClose,
  onDone
}: {
  assessmentId: string
  onClose: () => void
  onDone: (r: NessusImportResult) => void
}) {
  const [scanners, setScanners] = useState<ScannerConnection[]>([])
  const [connId, setConnId] = useState('')
  const [scans, setScans] = useState<ScannerScan[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<ScanFetchProgress | null>(null)
  const [batch, setBatch] = useState<{ index: number; total: number; name: string } | null>(null)

  useEffect(() => {
    void api.getSettings().then((s) => {
      setScanners(s.scanners)
      setConnId(s.scanners.find((x) => x.isDefault)?.id ?? s.scanners[0]?.id ?? '')
    })
    return api.onScannerProgress(setProgress)
  }, [])

  const loadScans = async () => {
    if (!connId) return
    setLoading(true)
    setError('')
    setScans([])
    try {
      setScans(await api.scannerListScans(connId))
    } catch (e) {
      setError(`Could not list scans: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
    }
  }

  const fetchScan = async (scan: ScannerScan) => {
    setLoading(true)
    setError('')
    setProgress({ scanId: scan.id, stage: 'export', percent: 0, message: 'Starting fetch…' })
    try {
      const res = await api.scannerFetch(assessmentId, connId, scan.id, scan.name)
      onDone(res)
    } catch (e) {
      setError(`Fetch of "${scan.name}" failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const fetchAll = async () => {
    setLoading(true)
    setError('')
    const total = emptyImportResult()
    const failures: string[] = []
    try {
      for (let i = 0; i < scans.length; i++) {
        const scan = scans[i]
        setBatch({ index: i, total: scans.length, name: scan.name })
        setProgress({ scanId: scan.id, stage: 'export', percent: 0, message: 'Starting fetch…' })
        try {
          addImportResult(total, await api.scannerFetch(assessmentId, connId, scan.id, scan.name))
        } catch (e) {
          // One bad scan must not sink the batch — record and continue.
          failures.push(`${scan.name}: ${e instanceof Error ? e.message : e}`)
        }
      }
      total.errors.push(...failures)
      if (failures.length) setError(`Fetched with ${failures.length} failure(s): ${failures.join(' · ')}`)
      onDone(total)
    } finally {
      setLoading(false)
      setBatch(null)
      setProgress(null)
    }
  }

  // Overall percentage: within a batch each scan owns an equal slice.
  const percent = batch
    ? Math.round(((batch.index + (progress?.percent ?? 0) / 100) / batch.total) * 100)
    : (progress?.percent ?? 0)

  return (
    <Modal title="Fetch from Scanner" onClose={onClose}>
      {scanners.length === 0 ? (
        <p className="muted">
          No scanner connections configured. Add one in <b>Settings → Scanner Connections</b>.
        </p>
      ) : (
        <>
          <div className="compare-controls">
            <label>
              <span>Scanner</span>
              <select value={connId} onChange={(e) => setConnId(e.target.value)} disabled={loading}>
                {scanners.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={loadScans} disabled={loading || !connId}>
              {loading && !progress ? 'Loading…' : 'List scans'}
            </button>
            <button onClick={fetchAll} disabled={loading || scans.length === 0} title="Fetch every listed scan in turn">
              ⬇ Fetch all ({scans.length})
            </button>
          </div>

          {loading && progress && (
            <div className="fetch-progress">
              <div className="fetch-progress-track">
                <div className="fetch-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="fetch-progress-label">
                {batch ? `Scan ${batch.index + 1}/${batch.total}: ${batch.name} — ` : ''}
                {progress.message} ({percent}%)
              </div>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}
          <div className="kb-pick-list">
            {scans.map((s) => (
              <button key={s.id} className="kb-pick" onClick={() => fetchScan(s)} disabled={loading} title="Fetch this scan">
                <StatusBadge value={s.status === 'completed' ? 'Completed' : s.status} /> {s.name}
                <span className="muted">{s.lastModified}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

function AssessmentDetail({
  assessment,
  onClose,
  onEdit
}: {
  assessment: Assessment
  onClose: () => void
  onEdit: () => void
}) {
  const db = useDb()
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<NessusImportResult | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const findings = db.findings.filter((f) => f.assessmentId === assessment.id)
  const current = db.assessments.find((a) => a.id === assessment.id) ?? assessment
  // Assets in scope are auto-populated from hosts attached to this assessment (SRS v4 §5).
  const scopeHosts = db.hosts.filter((h) => current.hostIds.includes(h.id))

  const runImport = async (kind: 'nessus' | 'csv') => {
    setImporting(true)
    try {
      const res = await api.importNessus(current.id, kind)
      if (res) {
        setImportResult(res)
        await db.reload()
      }
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal title={current.name} onClose={onClose} wide>
      <div className="detail-grid">
        <div>
          <b>Application:</b> {db.appName(current.applicationId)}
        </div>
        <div>
          <b>Type:</b> {current.type}
        </div>
        <div>
          <b>Status:</b> <StatusBadge value={current.status} />
        </div>
        <div>
          <b>Tester:</b> {current.tester || '—'}
        </div>
        <div>
          <b>Window:</b> {current.startDate || '?'} → {current.endDate || '?'}
        </div>
        <div>
          <b>Findings:</b> {findings.length}
        </div>
        <div>
          {/* Open Findings excludes Informational — only Critical/High/Medium/Low count (SRS v5 §2). */}
          <b>Open Findings:</b> {findings.filter((f) => f.severity !== 'Info' && isFindingOpen(f)).length}
        </div>
      </div>

      <h3>Assets in Scope</h3>
      <div className="host-checklist">
        {scopeHosts.length === 0 && (
          <p className="muted">No assets yet — auto-populated from hosts when you import a scan.</p>
        )}
        {scopeHosts.map((h) => (
          <span key={h.id} className="asset-chip">
            {h.hostname || h.ip} {h.ip && h.hostname ? `(${h.ip})` : ''} · {h.exposure}
          </span>
        ))}
      </div>

      <h3>Findings by Severity</h3>
      <div className="sev-strip">
        {SEVERITIES.map((s) => {
          const n = findings.filter((f) => f.severity === s).length
          return n ? (
            <span key={s}>
              <SeverityBadge value={s} /> {n}
            </span>
          ) : null
        })}
        {findings.length === 0 && <span className="muted">None yet — add manually or import a Nessus scan.</span>}
      </div>

      {importResult && (
        <div className="import-result">
          Imported <b>{importResult.imported}</b> finding(s), skipped <b>{importResult.duplicates}</b> duplicate(s),
          created <b>{importResult.hostsCreated}</b> host(s). Classification: {importResult.classifications.New} new,{' '}
          {importResult.classifications.Existing ?? 0} existing, {importResult.classifications.Retest} retest,{' '}
          {importResult.classifications.Regression} regression, {importResult.classifications['Context Change']} context
          change.
          {importResult.errors.length > 0 && <div className="form-error">{importResult.errors.join('; ')}</div>}
        </div>
      )}

      <h3>Import Scan</h3>
      <div className="import-actions">
        <button onClick={() => setShowScanner(true)} disabled={importing}>
          🛰 Fetch from Scanner
        </button>
        <button onClick={() => runImport('nessus')} disabled={importing}>
          {importing ? 'Importing…' : '⬆ Upload .nessus'}
        </button>
        <button onClick={() => runImport('csv')} disabled={importing}>
          ⬆ Upload CSV
        </button>
      </div>

      {showScanner && (
        <ScannerFetchModal
          assessmentId={current.id}
          onClose={() => setShowScanner(false)}
          onDone={async (res) => {
            setImportResult(res)
            setShowScanner(false)
            await db.reload()
          }}
        />
      )}

      <div className="modal-actions">
        <button
          onClick={() =>
            api.generateReport({ format: 'pdf', assessmentId: current.id, suggestedName: current.name.replace(/\W+/g, '-') })
          }
        >
          📄 PDF Report
        </button>
        {/* Move between modules (SRS v6.5): re-categorize with the target's default type. */}
        {(Object.keys(CATEGORY_LABELS) as AssessmentCategory[])
          .filter((c) => c !== (current.category || categoryOfType(current.type)))
          .map((target) => (
            <button
              key={target}
              onClick={async () => {
                if (!confirm(`Move "${current.name}" to ${CATEGORY_LABELS[target]} Assessments?`)) return
                await db.update('assessments', current.id, { category: target, type: CATEGORY_TYPES[target][0] })
                onClose()
              }}
            >
              ↪ Move to {CATEGORY_LABELS[target]}
            </button>
          ))}
        <span className="spacer" />
        <button onClick={onEdit}>Edit</button>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

/** One assessment module (FR-A1..A3) with its own request tracking and findings view (FR-A4). */
export function AssessmentsPage({ category }: { category: AssessmentCategory }) {
  const db = useDb()
  const [tab, setTab] = useState<'assessments' | 'requests' | 'findings'>('assessments')
  const [moduleFetch, setModuleFetch] = useState<'all' | 'selected' | null>(null)

  const types = CATEGORY_TYPES[category]
  const rows = db.assessments.filter((a) => (a.category || categoryOfType(a.type)) === category)
  const appOptions = db.applications.map((a) => ({ value: a.id, label: a.name }))
  const requestOptions = db.requests
    .filter((r) => types.includes(r.assessmentType))
    .map((r) => ({ value: r.id, label: `${r.projectCode ? `[${r.projectCode}] ` : ''}${r.title}` }))
  const assessmentOptions = rows.map((a) => ({ value: a.id, label: a.name }))

  return (
    <div>
      <div className="module-tabs">
        <h1>{CATEGORY_LABELS[category]} Assessments</h1>
        <div className="tab-bar">
          {(['assessments', 'requests', 'findings'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'requests' && <RequestsPage category={category} />}
      {tab === 'findings' && <FindingsPage category={category} />}
      {tab === 'assessments' && (
        <CrudPage
          collection="assessments"
          title=""
          singular="Assessment"
          rows={rows}
          defaults={(): Partial<Assessment> => ({
            type: types[0],
            category,
            timeframe: 'adhoc',
            status: 'Planned',
            hostIds: [],
            tester: '',
            notes: '',
            baselineAssessmentId: ''
          })}
          validate={(d) => (!d.name ? 'Name is required.' : null)}
          deleteKeyword="delete"
          toolbarExtra={
            <>
              <button onClick={() => setModuleFetch('all')}>🛰 Fetch All from Scanner</button>
              <button onClick={() => setModuleFetch('selected')}>🛰 Fetch Selected Only from Scanner</button>
            </>
          }
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'applicationId', label: 'Application', render: (r) => db.appName(r.applicationId) },
            { key: 'type', label: 'Type', render: (r) => <StatusBadge value={r.type === 'Retest' ? 'Retest' : r.type} /> },
            { key: 'timeframe', label: 'Timeframe' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
            { key: 'startDate', label: 'Start' },
            { key: 'endDate', label: 'End' },
            {
              key: 'findings',
              label: 'Findings',
              sortValue: (r) => db.findings.filter((f) => f.assessmentId === r.id).length,
              render: (r) => db.findings.filter((f) => f.assessmentId === r.id).length
            },
            { key: 'tester', label: 'Tester' }
          ]}
          fields={[
            { key: 'name', label: 'Name', required: true, span2: true },
            // Application optional (SRS v6.5): scanner-driven imports map later.
            { key: 'applicationId', label: 'Application (optional — map later)', type: 'select', options: appOptions },
            { key: 'requestId', label: 'Linked Request', type: 'select', options: requestOptions },
            { key: 'type', label: 'Type', type: 'select', options: types },
            { key: 'timeframe', label: 'Timeframe', type: 'select', options: TIMEFRAMES },
            { key: 'status', label: 'Status', type: 'select', options: ASSESSMENT_STATUSES },
            { key: 'startDate', label: 'Start Date', type: 'date' },
            { key: 'endDate', label: 'End Date', type: 'date' },
            { key: 'tester', label: 'Tester' },
            {
              key: 'baselineAssessmentId',
              label: 'Baseline Assessment (for retests)',
              type: 'select',
              options: assessmentOptions
            },
            { key: 'notes', label: 'Notes', type: 'textarea', span2: true }
          ]}
          renderDetail={(row, close, edit) => <AssessmentDetail assessment={row} onClose={close} onEdit={edit} />}
        />
      )}

      {moduleFetch && <ModuleFetchModal category={category} mode={moduleFetch} onClose={() => setModuleFetch(null)} />}
    </div>
  )
}
