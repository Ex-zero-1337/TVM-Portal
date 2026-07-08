import { useMemo } from 'react'
import { categoryOfType } from '@shared/types'
import { useDb } from '../data'
import { SeverityBadge, StatusBadge } from '../components/ui'

const CATEGORY_PAGE: Record<string, string> = {
  web: 'assessments-web',
  'internal-external': 'assessments-ie',
  host: 'assessments-host'
}

interface Hit {
  id: string
  kind: string
  title: string
  detail: string
  badge?: string
  page: string
}

/** Global search across applications, hosts, findings, CVEs, IPs, endpoints (FR28). */
export function SearchPage({ query, onNavigate }: { query: string; onNavigate: (page: string) => void }) {
  const db = useDb()

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const match = (...vals: (string | undefined)[]) => vals.some((v) => v?.toLowerCase().includes(q))
    const out: Hit[] = []

    for (const a of db.applications)
      if (match(a.name, a.businessUnit, a.owner, a.techStack))
        out.push({ id: a.id, kind: 'Application', title: a.name, detail: a.businessUnit, page: 'applications' })
    for (const h of db.hosts)
      if (match(h.ip, h.hostname, h.os))
        out.push({ id: h.id, kind: 'Host', title: h.hostname || h.ip, detail: h.ip, page: 'hosts' })
    const assessmentCat = (assessmentId: string) => {
      const a = db.assessments.find((x) => x.id === assessmentId)
      return a ? CATEGORY_PAGE[a.category || categoryOfType(a.type)] : 'assessments-web'
    }
    for (const f of db.findings)
      if (match(f.title, f.cve, f.cwe, f.endpoint, f.affectedAsset, f.pluginId, f.description))
        out.push({
          id: f.id,
          kind: 'Finding',
          title: f.title,
          detail: `${f.affectedAsset || db.hostLabel(f.hostId)} · ${f.cve || f.endpoint || f.pluginId || ''}`,
          badge: f.severity,
          page: assessmentCat(f.assessmentId)
        })
    for (const r of db.requests)
      if (match(r.title, r.scope, r.requestedBy, r.projectCode, r.systemName, r.department))
        out.push({
          id: r.id,
          kind: 'Request',
          title: r.projectCode ? `[${r.projectCode}] ${r.title}` : r.title,
          detail: r.status,
          // Requests live in their assessment module's Request tab (SRS v6.1 §2).
          page: CATEGORY_PAGE[categoryOfType(r.assessmentType)]
        })
    for (const a of db.assessments)
      if (match(a.name, a.tester))
        out.push({
          id: a.id,
          kind: 'Assessment',
          title: a.name,
          detail: a.type,
          page: CATEGORY_PAGE[a.category || categoryOfType(a.type)]
        })
    for (const t of db.kb)
      if (match(t.title, t.cve, t.cwe, t.owasp))
        out.push({ id: t.id, kind: 'KB Template', title: t.title, detail: t.cwe, page: 'kb' })
    return out.slice(0, 200)
  }, [query, db])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Search results for “{query}”</h1>
      </div>
      {hits.length === 0 ? (
        <p className="muted">No matches across applications, hosts, findings, requests, assessments or templates.</p>
      ) : (
        <div className="search-results">
          {hits.map((h) => (
            <button key={`${h.kind}-${h.id}`} className="search-hit" onClick={() => onNavigate(h.page)}>
              <StatusBadge value={h.kind} />
              <span className="hit-title">{h.title}</span>
              {h.badge && <SeverityBadge value={h.badge} />}
              <span className="muted">{h.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
