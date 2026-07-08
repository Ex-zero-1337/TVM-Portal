import { useMemo, useState } from 'react'
import type { AssessmentCategory, Finding, KbTemplate, Severity, Timeframe } from '@shared/types'
import { FINDING_STATUSES, SEVERITIES, CATEGORY_TYPES, TIMEFRAMES, categoryOfType } from '@shared/types'
import { isOverdue, slaDaysRemaining } from '@shared/sla'
import { api } from '../api'
import { useDb } from '../data'
import { CrudPage } from '../components/CrudPage'
import { Modal, SeverityBadge, StatusBadge } from '../components/ui'

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Multiple evidence attachments per finding (SRS v4 §4). */
function Attachments({ finding }: { finding: Finding }) {
  const db = useDb()
  const [busy, setBusy] = useState(false)
  const attachments = finding.attachments ?? []

  const add = async () => {
    setBusy(true)
    try {
      await api.evidenceAdd(finding.id)
      await db.reload()
    } finally {
      setBusy(false)
    }
  }
  const remove = async (attachmentId: string) => {
    if (!confirm('Remove this attachment?')) return
    await api.evidenceRemove(finding.id, attachmentId)
    await db.reload()
  }

  return (
    <>
      <h3>Evidence Attachments</h3>
      {attachments.length === 0 && <p className="muted">No attachments.</p>}
      <div className="attach-list">
        {attachments.map((a) => (
          <div key={a.id} className="attach-row">
            <button className="link" onClick={() => api.evidenceOpen(a.path)} title="Open">
              📎 {a.filename}
            </button>
            <span className="muted">{humanSize(a.size)}</span>
            <button className="icon-btn" onClick={() => remove(a.id)} title="Remove">
              ✕
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} disabled={busy}>
        {busy ? 'Attaching…' : '➕ Attach evidence (png/jpg/jpeg/gif/txt/zip)'}
      </button>
    </>
  )
}

function FindingDetail({ finding, onClose, onEdit }: { finding: Finding; onClose: () => void; onEdit: () => void }) {
  const db = useDb()
  const f = db.findings.find((x) => x.id === finding.id) ?? finding
  const overdue = isOverdue(f)
  const days = f.slaDueDate ? slaDaysRemaining(f) : null

  const Section = ({ label, text }: { label: string; text: string }) =>
    text ? (
      <>
        <h3>{label}</h3>
        <p className="prewrap">{text}</p>
      </>
    ) : null

  return (
    <Modal title={f.title} onClose={onClose} wide>
      <div className="detail-grid">
        <div>
          <b>Severity:</b> <SeverityBadge value={f.severity} /> {f.cvss ? `(CVSS ${f.cvss})` : ''}
        </div>
        <div>
          <b>Status:</b> <StatusBadge value={f.status} />
        </div>
        <div>
          <b>Classification:</b> <StatusBadge value={f.classification} />{' '}
          {f.classification === 'Existing' && f.firstIdentifiedPeriod && (
            <span className="muted">
              • First Identified: {f.firstIdentifiedAssessmentType ? `${f.firstIdentifiedAssessmentType} · ` : ''}
              {f.firstIdentifiedPeriod}
              {f.firstIdentifiedProjectCode ? ` · ${f.firstIdentifiedProjectCode}` : ''}
            </span>
          )}
        </div>
        <div>
          <b>Project Code:</b> {f.projectCode || '—'}
        </div>
        <div>
          <b>Application:</b> {db.appName(f.applicationId)}
        </div>
        <div>
          <b>Affected Asset:</b> {f.affectedAsset || (f.hostId ? `${db.hostLabel(f.hostId)}${f.port ? `:${f.port}` : ''}` : '—')}
        </div>
        <div>
          <b>Assessment:</b> {db.assessmentName(f.assessmentId)}
        </div>
        <div>
          <b>Endpoint:</b> {f.endpoint || '—'} {f.parameter ? `(param: ${f.parameter})` : ''}
        </div>
        <div>
          <b>CVE / CWE / OWASP:</b> {[f.cve, f.cwe, f.owasp].filter(Boolean).join(' · ') || '—'}
        </div>
        <div>
          <b>Discovered:</b> {f.discoveredDate || '—'}
        </div>
        <div>
          <b>SLA due:</b> {f.slaDueDate || '—'}{' '}
          {days !== null && (
            <span className={overdue ? 'sla-overdue' : 'sla-ok'}>
              {overdue ? `${-days} day(s) overdue` : `${days} day(s) left`}
            </span>
          )}
        </div>
      </div>
      <Section label="Description" text={f.description} />
      <Section label="Evidence (notes)" text={f.evidence} />
      <Attachments finding={f} />
      <Section label="Recommendation" text={f.recommendation} />
      <p className="muted">Fingerprint: {f.fingerprint?.slice(0, 24)}…</p>
      <div className="modal-actions">
        <span className="spacer" />
        <button onClick={onEdit}>Edit</button>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

/**
 * Findings are always viewed per working context. The web module's
 * "Project Code / Application" selector offers two kinds of context so adhoc
 * and annual/quarterly findings never clash:
 *   - a Project Code (from the Request tab) → adhoc findings of that code;
 *   - an Application (from the Applications module) → its annual/quarterly
 *     findings.
 * Other modules select an application (FR-F1/F3). The view is further scoped
 * by timeframe and severity checkboxes (FR-F2, §3.5).
 */
export function FindingsPage({ category }: { category?: AssessmentCategory }) {
  const db = useDb()
  const [kbPick, setKbPick] = useState(false)
  const [kbTemplate, setKbTemplate] = useState<KbTemplate | null>(null)
  const [appId, setAppId] = useState('')
  // Web context value: 'req:<requestId>' (adhoc) or 'app:<applicationId>'.
  const [webContext, setWebContext] = useState('')
  // Assessment Name filter (SRS v6.6.1): coexists with the context selector;
  // either one is sufficient to display findings.
  const [assessmentCtxId, setAssessmentCtxId] = useState('')
  const [timeframe, setTimeframe] = useState<Timeframe | ''>('')
  const [severities, setSeverities] = useState<Set<Severity>>(new Set(SEVERITIES))

  // Web findings use a free-text Affected Asset (URL/endpoint/API route/cookie/
  // parameter); network/host findings pick a host auto-populated from the
  // current application + its assessments (SRS v4 §4/§5).
  const isWeb = category === 'web' || !category

  // Only active project codes are offered (SRS v6.1 §3.4); a request need not
  // be bound to an application — the code alone is the adhoc context.
  const webRequests = db.requests.filter(
    (r) => r.projectCode && r.status !== 'Closed' && CATEGORY_TYPES.web.includes(r.assessmentType)
  )
  const ctxKind = webContext.startsWith('req:') ? 'code' : webContext.startsWith('app:') ? 'app' : ''
  const contextRequest = ctxKind === 'code' ? webRequests.find((r) => r.id === webContext.slice(4)) : undefined

  // Assessment Name values come from this module's Assessment tab (FR-FND-002).
  const moduleAssessments = db.assessments.filter(
    (a) => !category || (a.category || categoryOfType(a.type)) === category
  )
  const ctxAssessment = moduleAssessments.find((a) => a.id === assessmentCtxId)

  const contextSelected = isWeb ? ctxKind !== '' : appId !== ''
  const ctxAppId = contextSelected
    ? isWeb
      ? ctxKind === 'app'
        ? webContext.slice(4)
        : (contextRequest?.applicationId ?? '')
      : appId
    : (ctxAssessment?.applicationId ?? '')
  // FR-FND-005: at least one of Project Code / Application or Assessment Name.
  const hasContext = contextSelected || assessmentCtxId !== ''

  const scoped = useMemo(
    () =>
      db.findings.filter((f) => {
        if (!severities.has(f.severity)) return false
        // Assessment Name filter (v6.6.1): applied whenever selected; when
        // both filters are set, findings must satisfy both.
        if (assessmentCtxId && f.assessmentId !== assessmentCtxId) return false
        const a = db.assessments.find((x) => x.id === f.assessmentId)
        if (category && (!a || (a.category || categoryOfType(a.type)) !== category)) return false
        // Adhoc context: findings are keyed by their project code, not by
        // application, so codes never mix with annual/quarterly views. The
        // timeframe control is hidden here, so its value must not apply.
        if (isWeb && ctxKind === 'code') return !!contextRequest && f.projectCode === contextRequest.projectCode
        if (timeframe && (a?.timeframe || 'adhoc') !== timeframe) return false
        if (!contextSelected) return true // assessment-only view
        if (f.applicationId !== ctxAppId) return false
        // Application context shows the app's annual/quarterly work; adhoc
        // findings that carry a project code live under that code instead.
        if (isWeb && ctxKind === 'app' && (a?.timeframe || 'adhoc') === 'adhoc' && f.projectCode) return false
        return true
      }),
    [db.findings, db.assessments, assessmentCtxId, contextSelected, isWeb, ctxKind, contextRequest, ctxAppId, category, timeframe, severities]
  )

  const toggleSeverity = (s: Severity) =>
    setSeverities((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  const appOptions = db.applications.map((a) => ({ value: a.id, label: a.name }))
  const scopedAssessments = db.assessments.filter(
    (a) => (!ctxAppId || a.applicationId === ctxAppId) && (!category || (a.category || categoryOfType(a.type)) === category)
  )
  const assessmentHostIds = new Set(scopedAssessments.flatMap((a) => a.hostIds))
  const hostOptions = db.hosts
    .filter((h) => h.applicationId === ctxAppId || assessmentHostIds.has(h.id))
    .map((h) => ({ value: h.id, label: db.hostLabel(h.id) }))
  const assessmentOptions = scopedAssessments.map((a) => ({ value: a.id, label: a.name }))
  // Application context creates annual/quarterly findings, which still pick
  // their assessment; adhoc assessments belong to project-code contexts.
  const annualQuarterlyOptions = db.assessments
    .filter(
      (a) =>
        a.applicationId === ctxAppId &&
        (a.category || categoryOfType(a.type)) === 'web' &&
        (a.timeframe || 'adhoc') !== 'adhoc'
    )
    .map((a) => ({ value: a.id, label: `${a.name} (${a.timeframe})` }))

  // New web findings inherit the working context automatically (SRS v6.2 §7):
  // in a project-code context the code, application and (server-side) adhoc
  // Web assessment are all derived — the form never asks for them again.
  const defaults = (): Partial<Finding> => ({
    severity: 'Medium',
    status: 'Open',
    classification: 'New',
    cvss: 0,
    projectCode: isWeb && ctxKind === 'code' ? (contextRequest?.projectCode ?? '') : '',
    applicationId: ctxAppId,
    // Assessment Name filter active: new findings belong to that assessment.
    ...(assessmentCtxId ? { assessmentId: assessmentCtxId } : {}),
    discoveredDate: new Date().toISOString().slice(0, 10),
    ...(kbTemplate
      ? {
          title: kbTemplate.title,
          severity: kbTemplate.severity,
          description: kbTemplate.description,
          recommendation: kbTemplate.recommendation,
          cve: kbTemplate.cve,
          cwe: kbTemplate.cwe,
          owasp: kbTemplate.owasp
        }
      : {})
  })

  const filterBar = (
    <div className="findings-filter card">
      {isWeb ? (
        <label>
          <span>Project Code / Application</span>
          <select value={webContext} onChange={(e) => setWebContext(e.target.value)}>
            <option value="">— select a project code or application —</option>
            <optgroup label="Project Codes (adhoc) — from Requests">
              {webRequests.map((r) => (
                <option key={r.id} value={`req:${r.id}`}>
                  {r.projectCode} — {r.applicationId ? db.appName(r.applicationId) : r.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Applications (annual / quarterly)">
              {appOptions.map((o) => (
                <option key={o.value} value={`app:${o.value}`}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      ) : (
        <label>
          <span>Application</span>
          <select value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">— select an application —</option>
            {appOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* Assessment Name filter (SRS v6.6.1) — either this or the context
          selector is sufficient; both together narrow further. */}
      <label>
        <span>Assessment Name</span>
        <select value={assessmentCtxId} onChange={(e) => setAssessmentCtxId(e.target.value)}>
          <option value="">— any assessment —</option>
          {moduleAssessments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {/* A project-code context is adhoc by definition — no timeframe filter. */}
      {!(isWeb && ctxKind === 'code') && (
        <label>
          <span>Timeframe</span>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe | '')}>
            <option value="">All timeframes</option>
            {(isWeb && ctxKind === 'app' ? TIMEFRAMES.filter((t) => t !== 'adhoc') : TIMEFRAMES).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="sev-checkboxes">
        {SEVERITIES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={severities.has(s)} onChange={() => toggleSeverity(s)} />
            {s}
          </label>
        ))}
      </div>
    </div>
  )

  if (!hasContext) {
    return (
      <div className="page">
        {!category && (
          <div className="page-header">
            <h1>Findings</h1>
          </div>
        )}
        {filterBar}
        <p className="muted">
          {isWeb
            ? 'Select a Project Code / Application or an Assessment Name above — either is enough to view findings; together they narrow further.'
            : `Select an application or an Assessment Name above${category ? ` (${CATEGORY_TYPES[category].join('/')})` : ''} — either is enough to view findings.`}
        </p>
      </div>
    )
  }

  return (
    <>
      {!category && (
        <div className="page-header" style={{ padding: '0 0 0 0' }}>
          <h1>
            Findings —{' '}
            {contextSelected
              ? ctxKind === 'code'
                ? contextRequest?.projectCode
                : db.appName(ctxAppId)
              : (ctxAssessment?.name ?? '')}
          </h1>
        </div>
      )}
      {filterBar}
      <CrudPage
        collection="findings"
        title=""
        singular="Finding"
        rows={scoped}
        defaults={defaults}
        validate={(d) =>
          !d.title
            ? 'Title is required.'
            : isWeb
              ? !d.affectedAsset
                ? 'Affected asset is required.'
                : ctxKind === 'app' && !d.assessmentId
                  ? 'Assessment (annual / quarterly) is required.'
                  : null
              : !d.assessmentId
                ? 'Assessment is required.'
                : !d.hostId
                  ? 'Affected asset (host) is required.'
                  : null
        }
        toolbarExtra={
          <button onClick={() => setKbPick(true)} disabled={db.kb.length === 0} title="Prefill from Knowledge Base">
            📚 From Template
          </button>
        }
        columns={[
          { key: 'title', label: 'Title' },
          {
            key: 'severity',
            label: 'Severity',
            sortValue: (r) => SEVERITIES.indexOf(r.severity),
            render: (r) => <SeverityBadge value={r.severity} />
          },
          { key: 'cvss', label: 'CVSS' },
          {
            key: 'affectedAsset',
            label: 'Affected Asset',
            render: (r) => r.affectedAsset || (r.hostId ? db.hostLabel(r.hostId) : '—')
          },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
          { key: 'classification', label: 'Class', render: (r) => <StatusBadge value={r.classification} /> },
          {
            key: 'slaDueDate',
            label: 'SLA Due',
            render: (r) => (
              <span className={isOverdue(r) ? 'sla-overdue' : ''}>
                {r.slaDueDate}
                {isOverdue(r) ? ' ⚠' : ''}
              </span>
            )
          },
          { key: 'discoveredDate', label: 'Discovered' }
        ]}
        fields={[
          { key: 'title', label: 'Title', required: true, span2: true },
          // Adhoc web findings (project-code context) ask for neither
          // Assessment nor Project Code (SRS v6.2 §6) — both come from the
          // selected context, and the adhoc Web assessment is linked
          // server-side. Annual/quarterly web findings (application context)
          // still pick their assessment.
          ...(isWeb && ctxKind === 'app'
            ? [
                {
                  key: 'assessmentId',
                  label: 'Assessment (annual / quarterly)',
                  type: 'select' as const,
                  options: annualQuarterlyOptions,
                  required: true
                }
              ]
            : []),
          ...(isWeb
            ? []
            : [
                {
                  key: 'assessmentId',
                  label: 'Assessment',
                  type: 'select' as const,
                  options: assessmentOptions,
                  required: true
                },
                { key: 'applicationId', label: 'Application', type: 'select' as const, options: appOptions }
              ]),
          ...(isWeb
            ? [
                {
                  key: 'affectedAsset',
                  label: 'Affected Asset (URL / endpoint / API route / cookie / parameter)',
                  required: true,
                  span2: true
                } as const
              ]
            : [
                {
                  key: 'hostId',
                  label: 'Affected Asset (host)',
                  type: 'select' as const,
                  options: hostOptions,
                  required: true
                }
              ]),
          { key: 'severity', label: 'Severity', type: 'select', options: SEVERITIES },
          { key: 'cvss', label: 'CVSS Score', type: 'number' },
          { key: 'status', label: 'Status', type: 'select', options: FINDING_STATUSES },
          { key: 'endpoint', label: 'Endpoint / URL' },
          { key: 'port', label: 'Port' },
          { key: 'parameter', label: 'Parameter' },
          { key: 'discoveredDate', label: 'Discovered Date', type: 'date' },
          { key: 'cve', label: 'CVE' },
          { key: 'cwe', label: 'CWE' },
          { key: 'owasp', label: 'OWASP Category' },
          { key: 'description', label: 'Description', type: 'textarea', span2: true },
          { key: 'evidence', label: 'Evidence (notes)', type: 'textarea', span2: true },
          { key: 'recommendation', label: 'Recommendation', type: 'textarea', span2: true }
        ]}
        renderDetail={(row, close, edit) => <FindingDetail finding={row} onClose={close} onEdit={edit} />}
      />

      {kbPick && (
        <Modal title="Pick a Knowledge Base template" onClose={() => setKbPick(false)}>
          <div className="kb-pick-list">
            {db.kb.map((t) => (
              <button
                key={t.id}
                className="kb-pick"
                onClick={() => {
                  setKbTemplate(t)
                  setKbPick(false)
                  alert('Template selected — click "+ New Finding" and the form will be prefilled.')
                }}
              >
                <SeverityBadge value={t.severity} /> {t.title}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
