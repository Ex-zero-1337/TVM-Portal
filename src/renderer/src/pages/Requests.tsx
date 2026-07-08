import type { AssessmentCategory, VaptRequest } from '@shared/types'
import { ASSESSMENT_TYPES, CATEGORY_TYPES, ENVIRONMENTS, PRIORITIES, REQUEST_STATUSES } from '@shared/types'
import { useDb } from '../data'
import { CrudPage } from '../components/CrudPage'
import { StatusBadge } from '../components/ui'

/**
 * Project Code Requests (SRS v3 §4). The project code (VAPT-YYYYMMDD-HHMMSS)
 * is generated server-side on create; pasting a Power Automate subject like
 * "[VAPT-20260701-140418] VAPT Request - Thune" into the title extracts the
 * code and keeps the remainder as the title.
 */
export function RequestsPage({ category }: { category?: AssessmentCategory }) {
  const db = useDb()
  const appOptions = db.applications.map((a) => ({ value: a.id, label: a.name }))
  const types = category ? CATEGORY_TYPES[category] : ASSESSMENT_TYPES
  const rows = category ? db.requests.filter((r) => types.includes(r.assessmentType)) : db.requests

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
      columns={[
        {
          key: 'projectCode',
          label: 'Project Code',
          render: (r) => <code>{r.projectCode || '—'}</code>
        },
        { key: 'title', label: 'Title' },
        { key: 'systemName', label: 'System' },
        { key: 'department', label: 'Department' },
        { key: 'applicationId', label: 'Application', render: (r) => db.appName(r.applicationId) },
        { key: 'assessmentType', label: 'Type' },
        { key: 'priority', label: 'Priority', render: (r) => <StatusBadge value={r.priority} /> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
        { key: 'targetDate', label: 'Target Date' }
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
