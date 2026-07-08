import type { Application } from '@shared/types'
import { PRIORITIES, SEVERITIES } from '@shared/types'
import { isFindingOpen } from '@shared/sla'
import { useDb } from '../data'
import { CrudPage } from '../components/CrudPage'
import { SeverityBadge } from '../components/ui'

export function ApplicationsPage() {
  const db = useDb()

  return (
    <CrudPage
      collection="applications"
      title="Applications"
      singular="Application"
      defaults={(): Partial<Application> => ({ criticality: 'Medium', riskRating: 'Unrated', techStack: '', description: '' })}
      validate={(d) => (!d.name ? 'Name is required.' : null)}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'businessUnit', label: 'Business Unit' },
        { key: 'owner', label: 'Owner' },
        { key: 'techStack', label: 'Tech Stack' },
        { key: 'criticality', label: 'Criticality', render: (r) => <SeverityBadge value={r.criticality} /> },
        { key: 'riskRating', label: 'Risk Rating', render: (r) => <SeverityBadge value={r.riskRating} /> },
        {
          key: 'openFindings',
          label: 'Open Findings',
          sortValue: (r) =>
            db.findings.filter((f) => f.applicationId === r.id && f.severity !== 'Info' && isFindingOpen(f)).length,
          render: (r) =>
            db.findings.filter((f) => f.applicationId === r.id && f.severity !== 'Info' && isFindingOpen(f)).length
        },
        {
          key: 'assessments',
          label: 'Assessments',
          sortValue: (r) => db.assessments.filter((a) => a.applicationId === r.id).length,
          render: (r) => db.assessments.filter((a) => a.applicationId === r.id).length
        }
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'businessUnit', label: 'Business Unit' },
        { key: 'owner', label: 'Owner' },
        { key: 'techStack', label: 'Technology Stack' },
        { key: 'criticality', label: 'Criticality', type: 'select', options: PRIORITIES },
        { key: 'riskRating', label: 'Risk Rating', type: 'select', options: [...SEVERITIES, 'Unrated'] },
        { key: 'description', label: 'Description', type: 'textarea', span2: true }
      ]}
    />
  )
}
