import { useState } from 'react'
import type { ComparisonResult, Finding } from '@shared/types'
import { api } from '../api'
import { useDb } from '../data'
import { DataTable, SeverityBadge, StatusBadge } from '../components/ui'

function FindingMiniTable({ rows }: { rows: Finding[] }) {
  const db = useDb()
  return (
    <DataTable
      rows={rows}
      pageSize={20}
      emptyText="None."
      columns={[
        { key: 'title', label: 'Title' },
        { key: 'severity', label: 'Severity', render: (r) => <SeverityBadge value={r.severity} /> },
        { key: 'hostId', label: 'Host', render: (r) => db.hostLabel(r.hostId) },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> }
      ]}
    />
  )
}

export function RetestsPage() {
  const db = useDb()
  const [baselineId, setBaselineId] = useState('')
  const [currentId, setCurrentId] = useState('')
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [running, setRunning] = useState(false)

  const retestAssessments = db.assessments.filter((a) => a.type === 'Retest')

  const run = async () => {
    setRunning(true)
    try {
      setResult(await api.compareAssessments(baselineId, currentId))
    } finally {
      setRunning(false)
    }
  }

  const pickRetest = (id: string) => {
    const a = db.assessments.find((x) => x.id === id)
    if (a) {
      setCurrentId(a.id)
      if (a.baselineAssessmentId) setBaselineId(a.baselineAssessmentId)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Post Assessment — Retests &amp; Historical Comparison</h1>
      </div>

      <div className="card">
        <h3>Retest Sessions</h3>
        <DataTable
          rows={retestAssessments}
          emptyText='No retest sessions yet. Create an assessment with type "Retest" and link its baseline.'
          onRowClick={(r) => pickRetest(r.id)}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'applicationId', label: 'Application', render: (r) => db.appName(r.applicationId) },
            {
              key: 'baselineAssessmentId',
              label: 'Baseline',
              render: (r) => db.assessmentName(r.baselineAssessmentId)
            },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
            { key: 'startDate', label: 'Start' }
          ]}
        />
      </div>

      <div className="card">
        <h3>Compare Two Assessments</h3>
        <div className="compare-controls">
          <label>
            <span>Baseline (earlier)</span>
            <select value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
              <option value="">— select —</option>
              {db.assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({db.appName(a.applicationId)})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Current (later)</span>
            <select value={currentId} onChange={(e) => setCurrentId(e.target.value)}>
              <option value="">— select —</option>
              {db.assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({db.appName(a.applicationId)})
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={!baselineId || !currentId || baselineId === currentId || running} onClick={run}>
            {running ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        {result && (
          <div className="compare-results">
            <h3>🆕 New findings ({result.newFindings.length})</h3>
            <FindingMiniTable rows={result.newFindings} />
            <h3>✅ Resolved findings ({result.resolvedFindings.length})</h3>
            <FindingMiniTable rows={result.resolvedFindings} />
            <h3>🔁 Recurring findings ({result.recurringFindings.length})</h3>
            <FindingMiniTable rows={result.recurringFindings.map((p) => p.b)} />
            <h3>⚠ Severity changes ({result.severityChanges.length})</h3>
            {result.severityChanges.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul className="sev-changes">
                {result.severityChanges.map((p) => (
                  <li key={p.b.id}>
                    {p.b.title}: <SeverityBadge value={p.a.severity} /> → <SeverityBadge value={p.b.severity} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
