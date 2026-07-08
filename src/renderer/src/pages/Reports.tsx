import { useState } from 'react'
import { api } from '../api'
import { useDb } from '../data'

const FORMATS = [
  {
    id: 'xlsx' as const,
    label: 'Excel (.xlsx)',
    desc: 'Sheets: Summary, Findings, SLA Tracking, Host Mapping, Severity Distribution.'
  },
  {
    id: 'docx' as const,
    label: 'Word (.docx)',
    desc: 'Cover page with project code, table of contents, executive summary, findings detail, appendices.'
  },
  {
    id: 'pdf' as const,
    label: 'PDF — Full Technical',
    variant: 'full' as const,
    desc: 'Print-ready full report: summaries plus every technical finding.'
  },
  {
    id: 'pdf' as const,
    label: 'PDF — Executive Only',
    variant: 'executive' as const,
    desc: 'Client-sharing edition: executive, risk, SLA and retest summaries only.'
  }
]

export function ReportsPage() {
  const db = useDb()
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState('')
  const [lastPath, setLastPath] = useState('')

  const generate = async (format: 'xlsx' | 'docx' | 'pdf', variant?: 'executive' | 'full') => {
    setBusy(`${format}-${variant ?? ''}`)
    try {
      const assessment = db.assessments.find((a) => a.id === scope)
      const request = assessment?.requestId ? db.requests.find((r) => r.id === assessment.requestId) : undefined
      const name = request?.projectCode
        ? request.projectCode
        : assessment
          ? `VAPT-${assessment.name.replace(/\W+/g, '-')}`
          : 'TVM-Portfolio-Report'
      const out = await api.generateReport({
        format,
        variant,
        assessmentId: scope || undefined,
        suggestedName: `${name}${variant === 'executive' ? '-Executive' : ''}-${new Date().toISOString().slice(0, 10)}`
      })
      if (out) setLastPath(out)
    } catch (e) {
      alert(`Report generation failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reports</h1>
      </div>

      <div className="card">
        <h3>Scope</h3>
        <label className="report-scope">
          <span>Report on</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Entire portfolio (all findings)</option>
            {db.assessments.map((a) => (
              <option key={a.id} value={a.id}>
                Assessment: {a.name} ({db.appName(a.applicationId)})
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Every report includes an executive summary, risk summary, SLA summary, retest summary and full technical
          findings.
        </p>
      </div>

      <div className="report-formats">
        {FORMATS.map((f) => (
          <div key={f.label} className="card report-card">
            <h3>{f.label}</h3>
            <p className="muted">{f.desc}</p>
            <button className="primary" disabled={!!busy} onClick={() => generate(f.id, 'variant' in f ? f.variant : undefined)}>
              {busy === `${f.id}-${('variant' in f ? f.variant : undefined) ?? ''}` ? 'Generating…' : 'Generate'}
            </button>
          </div>
        ))}
      </div>

      {lastPath && (
        <p className="muted">
          Last report saved to <code>{lastPath}</code>
        </p>
      )}
    </div>
  )
}
