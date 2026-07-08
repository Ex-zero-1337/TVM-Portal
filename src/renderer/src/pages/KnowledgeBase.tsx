import type { KbTemplate } from '@shared/types'
import { SEVERITIES } from '@shared/types'
import { CrudPage } from '../components/CrudPage'
import { SeverityBadge } from '../components/ui'

export function KnowledgeBasePage() {
  return (
    <CrudPage
      collection="kb"
      title="Knowledge Base"
      singular="Template"
      defaults={(): Partial<KbTemplate> => ({ severity: 'Medium', description: '', risk: '', recommendation: '' })}
      validate={(d) => (!d.title ? 'Title is required.' : null)}
      columns={[
        { key: 'title', label: 'Title' },
        {
          key: 'severity',
          label: 'Default Severity',
          sortValue: (r) => SEVERITIES.indexOf(r.severity),
          render: (r) => <SeverityBadge value={r.severity} />
        },
        { key: 'cve', label: 'CVE' },
        { key: 'cwe', label: 'CWE' },
        { key: 'owasp', label: 'OWASP' }
      ]}
      fields={[
        { key: 'title', label: 'Title', required: true, span2: true },
        { key: 'severity', label: 'Default Severity', type: 'select', options: SEVERITIES },
        { key: 'cve', label: 'CVE' },
        { key: 'cwe', label: 'CWE (e.g. CWE-89)' },
        { key: 'owasp', label: 'OWASP Category (e.g. A03:2021 Injection)' },
        { key: 'description', label: 'Description', type: 'textarea', span2: true },
        { key: 'risk', label: 'Risk / Impact', type: 'textarea', span2: true },
        { key: 'recommendation', label: 'Recommendation', type: 'textarea', span2: true }
      ]}
    />
  )
}
