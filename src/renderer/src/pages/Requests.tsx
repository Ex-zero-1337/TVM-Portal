import type { ReactNode } from 'react'
import type { AssessmentCategory, VaptRequest } from '@shared/types'
import { ASSESSMENT_TYPES, CATEGORY_TYPES, ENVIRONMENTS, PRIORITIES, REQUEST_STATUSES } from '@shared/types'
import { useDb } from '../data'
import { CrudPage } from '../components/CrudPage'
import { DetailField as Field, DetailSection, Modal, StatusBadge } from '../components/ui'

/** Strip SharePoint's `_x000D_` artifacts for display. */
function cleanText(v: unknown): string {
  if (!v) return ''
  return String(v)
    .replace(/_x000D_/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
}

/** Hostname for a link label; falls back to the raw text for malformed URLs. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.length > 60 ? `${url.slice(0, 57)}…` : url
  }
}

/**
 * Read-only request detail (v6.6.8): shows every field from the original
 * Power Automate export (kept verbatim on `request.source`) alongside the
 * portal's own fields, grouped into sections for professional review.
 */
function RequestDetail({ r, close, edit }: { r: VaptRequest; close: () => void; edit: () => void }) {
  const s = r.source ?? {}
  const attachments = cleanText(s.attachments)
    .split('\n')
    .filter((u) => u)
  const reviewed = [cleanText(s.reviewerName), cleanText(s.timeOfReview) && `on ${cleanText(s.timeOfReview).replace('T', ' ')}`]
    .filter(Boolean)
    .join(' ')
  const section = (title: string, children: ReactNode) => <DetailSection title={title}>{children}</DetailSection>
  const approval = cleanText(s.approvalStatus)
  return (
    <Modal title="Request Details" onClose={close} wide>
      <div className="req-detail">
        <header className="req-detail-head">
          <div>
            <code className="req-detail-code">{r.projectCode || '—'}</code>
            <h3>{r.title}</h3>
          </div>
          <div className="req-detail-badges">
            <StatusBadge value={r.status} />
            <StatusBadge value={r.priority} />
          </div>
        </header>

        {section(
          'Requester',
          <>
            <Field label="Name" value={r.requestedBy} />
            <Field label="Email" value={r.requesterEmail} />
            <Field label="Department / Division" value={r.department} />
            <Field
              label="Additional Recipients"
              value={cleanText(s.additionalEmailRecipients).split('\n').join('; ')}
            />
          </>
        )}

        {section(
          'System',
          <>
            <Field label="System Name" value={r.systemName} />
            <Field label="Type of System" value={cleanText(s.typeOfSystem) || r.assessmentType} />
            <Field label="Purpose" value={r.purpose} />
            <Field label="Environment" value={r.environment} />
            <Field label="System Properties" value={cleanText(s.doesTheSystem)} wide />
            <Field label="Scope" value={r.scope} wide />
          </>
        )}

        {section(
          'Schedule',
          <>
            <Field label="Target UAT Completion" value={r.targetUatDate} />
            <Field label="Target Go-Live" value={r.goLiveDate} />
            <Field label="Assessment Target Date" value={r.targetDate} />
          </>
        )}

        {(s.approvalStatus || s.comments || reviewed || attachments.length > 0) &&
          section(
            'Approval & Review',
            <>
              {approval && (
                <div className="req-field">
                  <span className="req-field-label">Approval Status</span>
                  <span>
                    <span className={`req-chip ${/acknowledg|approv/i.test(approval) ? 'req-chip-ok' : ''}`}>
                      {approval}
                    </span>
                  </span>
                </div>
              )}
              <Field label="Reviewed By" value={reviewed} />
              <Field label="Comments" value={cleanText(s.comments)} wide />
              {attachments.length > 0 && (
                <div className="req-field wide">
                  <span className="req-field-label">Attachments</span>
                  <span className="req-field-value">
                    {attachments.map((url, i) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="req-attachment" title={url}>
                        Attachment {attachments.length > 1 ? i + 1 : ''} — {hostOf(url)}
                      </a>
                    ))}
                  </span>
                </div>
              )}
            </>
          )}

        {r.notes && section('Notes', <Field label="" value={r.notes} wide />)}
      </div>

      <div className="modal-actions">
        <span className="spacer" />
        <button onClick={close}>Close</button>
        <button className="primary" onClick={edit}>
          Edit Request
        </button>
      </div>
    </Modal>
  )
}

/**
 * Project Code Requests (SRS v3 §4). The project code (VAPT-YYYYMMDD-HHMMSS)
 * is generated server-side on create; pasting a Power Automate subject like
 * "[VAPT-20260701-140418] VAPT Request - Thune" into the title extracts the
 * code and keeps the remainder as the title.
 */
/** Scheduling urgency (v6.6.3): go-live date, else target UAT completion, else nothing. */
function urgencyDate(r: VaptRequest): string {
  return r.goLiveDate || r.targetUatDate || ''
}

/**
 * Default order (v6.6.3): soonest go-live first; requests without a clear
 * go-live fall back to their target UAT completion; requests with neither
 * date come last, first-come-first-served. Ties break by arrival order.
 */
function byUrgency(a: VaptRequest, b: VaptRequest): number {
  const da = urgencyDate(a)
  const db_ = urgencyDate(b)
  if (da && db_ && da !== db_) return da < db_ ? -1 : 1
  if (da !== db_) return da ? -1 : 1 // dated requests before undated ones
  return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1
}

export function RequestsPage({ category }: { category?: AssessmentCategory }) {
  const db = useDb()
  const appOptions = db.applications.map((a) => ({ value: a.id, label: a.name }))
  const types = category ? CATEGORY_TYPES[category] : ASSESSMENT_TYPES
  const rows = (category ? db.requests.filter((r) => types.includes(r.assessmentType)) : db.requests)
    .slice()
    .sort(byUrgency)

  return (
    <CrudPage
      collection="requests"
      title={category ? '' : 'Project Code Requests'}
      singular="Request"
      rows={rows}
      defaults={(): Partial<VaptRequest> => ({
        status: 'New',
        priority: 'Medium',
        environment: 'Production',
        assessmentType: types[0],
        scope: '',
        notes: '',
        requestedBy: '',
        requesterEmail: '',
        department: '',
        systemName: '',
        targetUatDate: '',
        goLiveDate: '',
        purpose: '',
        targetDate: ''
      })}
      validate={(d) => (!d.title ? 'Title is required.' : null)}
      renderDetail={(r, close, edit) => <RequestDetail r={r} close={close} edit={edit} />}
      // v6.6.4: System / Application / Priority columns hidden for now — the
      // list is driven by scheduling dates (UAT completion + go-live).
      columns={[
        {
          key: 'projectCode',
          label: 'Project Code',
          width: '200px',
          render: (r) => <code>{r.projectCode || '—'}</code>
        },
        { key: 'title', label: 'Title' },
        { key: 'department', label: 'Department' },
        { key: 'assessmentType', label: 'Type' },
        { key: 'targetUatDate', label: 'UAT Completion', render: (r) => r.targetUatDate || '—' },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
        {
          key: 'goLiveDate',
          label: 'Go-Live',
          sortValue: (r) => urgencyDate(r) || '9999-12-31',
          render: (r) => (r.goLiveDate ? r.goLiveDate : r.targetUatDate ? `${r.targetUatDate} (UAT)` : '—')
        }
      ]}
      fields={[
        {
          key: 'title',
          label: 'Title — paste "[VAPT-…] VAPT Request - Name" to auto-extract the project code',
          required: true,
          span2: true
        },
        { key: 'projectCode', label: 'Project Code (blank = auto-generate)' },
        // Requests are not bound to an application: the project code alone is
        // the adhoc working context, keeping adhoc findings separate from an
        // application's annual/quarterly findings.
        { key: 'applicationId', label: 'Application (optional)', type: 'select', options: appOptions },
        { key: 'systemName', label: 'System Name' },
        { key: 'assessmentType', label: 'Assessment Type', type: 'select', options: types },
        { key: 'requestedBy', label: 'Requester Name' },
        { key: 'requesterEmail', label: 'Requester Email' },
        { key: 'department', label: 'Department' },
        { key: 'purpose', label: 'Purpose' },
        { key: 'environment', label: 'Environment', type: 'select', options: ENVIRONMENTS },
        { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
        { key: 'status', label: 'Status', type: 'select', options: REQUEST_STATUSES },
        { key: 'targetDate', label: 'Target Date', type: 'date' },
        { key: 'targetUatDate', label: 'Target UAT Completion', type: 'date' },
        { key: 'goLiveDate', label: 'Go Live Date', type: 'date' },
        { key: 'scope', label: 'Scope', type: 'textarea', span2: true },
        { key: 'notes', label: 'Notes', type: 'textarea', span2: true }
      ]}
    />
  )
}
