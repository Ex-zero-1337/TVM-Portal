import { useMemo, useState, type ReactNode } from 'react'
import type { Host, Severity } from '@shared/types'
import { CATEGORY_LABELS, ENVIRONMENTS, INVENTORY_STATUSES, categoryOfType } from '@shared/types'
import { api } from '../api'
import { useDb } from '../data'
import { EntityForm, Modal, StatusBadge } from '../components/ui'

/**
 * Host inventory (SRS v4 §7) — populated automatically from scan imports and
 * organised as a collapsible tree:
 *   Application → Assessment Type → Period → Scan → Hosts
 * Manual add/edit is also supported; manually-entered hosts (which have no
 * scan) are grouped under a "Manual / Unassigned" node per application.
 * Each host row shows its open finding counts by severity.
 */

const COUNT_SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low']
const MANUAL_TYPE = 'Manual / Unassigned'
const MANUAL_SOURCE = 'manual'

interface ScanNode {
  scan: string
  hosts: Host[]
}
interface PeriodNode {
  period: string
  scans: ScanNode[]
}
interface TypeNode {
  type: string
  periods: PeriodNode[]
}
interface AppNode {
  appId: string
  appName: string
  hostCount: number
  types: TypeNode[]
}

function countHosts(node: TypeNode | PeriodNode): number {
  if ('periods' in node) return node.periods.reduce((n, p) => n + countHosts(p), 0)
  return node.scans.reduce((n, s) => n + s.hosts.length, 0)
}

interface ParsedHost {
  ip: string
  hostname: string
  os: string
}

const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g

/** Parse the bulk textarea: one host per line, multiple IPs on a line split out. */
export function parseHostLines(text: string): ParsedHost[] {
  const out: ParsedHost[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const ips = line.match(IP_RE) ?? []
    if (ips.length > 1) {
      for (const ip of ips) out.push({ ip, hostname: '', os: '' })
      continue
    }
    const [c0 = '', c1 = '', c2 = ''] = line.split(',').map((p) => p.trim())
    if (ips.length === 1) out.push({ ip: ips[0], hostname: c1, os: c2 })
    else out.push({ ip: '', hostname: c0, os: c1 }) // hostname-only line
  }
  return out
}

/** A collapsible section header + body, controlled by an expanded-keys set. */
function Section({
  nodeKey,
  label,
  count,
  level,
  expanded,
  toggle,
  children
}: {
  nodeKey: string
  label: ReactNode
  count: number
  level: 'app' | 'type' | 'period' | 'scan'
  expanded: Set<string>
  toggle: (key: string) => void
  children: ReactNode
}) {
  const open = expanded.has(nodeKey)
  return (
    <div className={`inv-node inv-${level}`}>
      <button className="inv-header" onClick={() => toggle(nodeKey)}>
        <span className={`inv-chevron ${open ? 'open' : ''}`}>▶</span>
        <span className="inv-label">{label}</span>
        <span className="inv-count">
          {count} host{count === 1 ? '' : 's'}
        </span>
      </button>
      {open && <div className="inv-body">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- add / edit

function AddHostsModal({ onClose }: { onClose: () => void }) {
  const db = useDb()
  const [applicationId, setApplicationId] = useState('')
  const [environment, setEnvironment] = useState('Production')
  const [status, setStatus] = useState<Host['status']>('Pending')
  const [exposure, setExposure] = useState<'internal' | 'external'>('internal')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const parsed = useMemo(() => parseHostLines(text).filter((h) => h.ip || h.hostname), [text])

  const save = async () => {
    if (!applicationId) return setError('Select an application.')
    if (parsed.length === 0) return setError('Enter at least one host (one per line).')
    setSaving(true)
    try {
      const existingIps = new Set(
        db.hosts.filter((h) => h.applicationId === applicationId).map((h) => h.ip).filter(Boolean)
      )
      let added = 0
      for (const p of parsed) {
        if (p.ip && existingIps.has(p.ip)) continue
        if (p.ip) existingIps.add(p.ip)
        await db.create('hosts', {
          ip: p.ip,
          hostname: p.hostname,
          os: p.os,
          environment: environment as Host['environment'],
          status,
          exposure,
          applicationId,
          notes: 'Added manually',
          sourceFile: MANUAL_SOURCE
        })
        added++
      }
      onClose()
      if (added < parsed.length) alert(`${added} host(s) added. ${parsed.length - added} skipped (duplicate IP).`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Add Hosts" onClose={onClose} wide>
      <div className="form-grid">
        <label>
          <span>
            Application<em className="req"> *</em>
          </span>
          <select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
            <option value="">— select —</option>
            {db.applications.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Environment</span>
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            {ENVIRONMENTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Host['status'])}>
            {INVENTORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Exposure</span>
          <select value={exposure} onChange={(e) => setExposure(e.target.value as 'internal' | 'external')}>
            <option value="internal">internal</option>
            <option value="external">external</option>
          </select>
        </label>
        <label className="span2">
          <span>Hosts — one per line (IP, or “IP, hostname, OS”; multiple IPs on a line become separate hosts)</span>
          <textarea
            rows={7}
            value={text}
            placeholder={'10.10.10.10, web01, Ubuntu 22.04\n10.10.10.11\n10.10.10.12 10.10.10.13'}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <span className="muted">{parsed.length} host(s) will be added</span>
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? 'Adding…' : `Add ${parsed.length || ''} host(s)`}
        </button>
      </div>
    </Modal>
  )
}

function EditHostModal({ host, onClose }: { host: Host; onClose: () => void }) {
  const db = useDb()
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...host })
  const appOptions = db.applications.map((a) => ({ value: a.id, label: a.name }))

  const save = async () => {
    if (!draft.ip && !draft.hostname) {
      alert('IP address or hostname is required.')
      return
    }
    await db.update('hosts', host.id, draft as Partial<Host>)
    onClose()
  }
  const del = async () => {
    if (confirm('Delete this host? This cannot be undone.')) {
      await db.remove('hosts', host.id)
      onClose()
    }
  }

  return (
    <Modal title="Edit Host" onClose={onClose} wide>
      <EntityForm
        fields={[
          { key: 'ip', label: 'IP Address' },
          { key: 'hostname', label: 'Hostname' },
          { key: 'os', label: 'Operating System' },
          { key: 'environment', label: 'Environment', type: 'select', options: ENVIRONMENTS },
          { key: 'status', label: 'Status', type: 'select', options: INVENTORY_STATUSES },
          { key: 'exposure', label: 'Exposure', type: 'select', options: ['internal', 'external'] },
          { key: 'applicationId', label: 'Application', type: 'select', options: appOptions },
          { key: 'notes', label: 'Notes', type: 'textarea', span2: true }
        ]}
        value={draft}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
      />
      <div className="modal-actions">
        <button className="danger" onClick={del}>
          Delete
        </button>
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- page

export function HostsPage() {
  const db = useDb()
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Host | null>(null)
  // Multi-selection for bulk delete (SRS v5 §3).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const deleteSelected = async () => {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} selected host(s)? This cannot be undone.`)) return
    setDeleting(true)
    try {
      for (const id of selected) await api.remove('hosts', id)
      setSelected(new Set())
      await db.reload()
    } finally {
      setDeleting(false)
    }
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const sevCounts = useMemo(() => {
    const m = new Map<string, Record<Severity, number>>()
    for (const f of db.findings) {
      if (!f.hostId) continue
      if (!m.has(f.hostId)) m.set(f.hostId, { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 })
      m.get(f.hostId)![f.severity]++
    }
    return m
  }, [db.findings])

  // Build the Application → Type → Period → Scan → Hosts tree, including manual
  // hosts (not attached to any assessment) under a Manual / Unassigned node.
  const tree = useMemo<AppNode[]>(() => {
    const q = filter.trim().toLowerCase()
    const matches = (h: Host) =>
      !q ||
      h.ip.toLowerCase().includes(q) ||
      h.hostname.toLowerCase().includes(q) ||
      (h.os || '').toLowerCase().includes(q)

    const hostById = new Map(db.hosts.map((h) => [h.id, h]))
    const apps: AppNode[] = []

    for (const app of db.applications) {
      const typeNodes = new Map<string, Map<string, Map<string, Host[]>>>()
      const placed = new Set<string>()
      const put = (type: string, period: string, scan: string, host: Host) => {
        if (!typeNodes.has(type)) typeNodes.set(type, new Map())
        const periods = typeNodes.get(type)!
        if (!periods.has(period)) periods.set(period, new Map())
        const scans = periods.get(period)!
        if (!scans.has(scan)) scans.set(scan, [])
        const list = scans.get(scan)!
        if (!list.some((x) => x.id === host.id)) list.push(host)
        placed.add(host.id)
      }

      for (const a of db.assessments.filter((x) => x.applicationId === app.id)) {
        const typeLabel = CATEGORY_LABELS[a.category || categoryOfType(a.type)]
        for (const hid of a.hostIds) {
          const host = hostById.get(hid)
          if (!host || !matches(host)) continue
          put(typeLabel, a.timeframe || 'adhoc', host.sourceFile || MANUAL_SOURCE, host)
        }
      }

      // Manual / orphan hosts belonging to this app but attached to no assessment.
      for (const host of db.hosts) {
        if (host.applicationId !== app.id || placed.has(host.id) || !matches(host)) continue
        put(MANUAL_TYPE, 'inventory', host.sourceFile || MANUAL_SOURCE, host)
      }

      if (typeNodes.size === 0) continue
      const types: TypeNode[] = [...typeNodes].map(([type, periods]) => ({
        type,
        periods: [...periods].map(([period, scans]) => ({
          period,
          scans: [...scans].map(([scan, hosts]) => ({ scan, hosts }))
        }))
      }))
      apps.push({
        appId: app.id,
        appName: app.name,
        hostCount: types.reduce((n, t) => n + countHosts(t), 0),
        types
      })
    }
    return apps
  }, [db.applications, db.assessments, db.hosts, filter])

  const allKeys = useMemo(() => {
    const keys: string[] = []
    for (const app of tree) {
      keys.push(app.appId)
      for (const t of app.types) {
        const tk = `${app.appId}|${t.type}`
        keys.push(tk)
        for (const p of t.periods) {
          const pk = `${tk}|${p.period}`
          keys.push(pk)
          for (const s of p.scans) keys.push(`${pk}|${s.scan}`)
        }
      }
    }
    return keys
  }, [tree])

  const filtering = filter.trim() !== ''
  const shown = filtering ? new Set(allKeys) : expanded
  const totalHosts = db.hosts.length
  // All host ids currently visible in the tree — the target of "Select All".
  const visibleHostIds = useMemo(
    () => tree.flatMap((a) => a.types.flatMap((t) => t.periods.flatMap((p) => p.scans.flatMap((s) => s.hosts.map((h) => h.id))))),
    [tree]
  )
  const allSelected = visibleHostIds.length > 0 && visibleHostIds.every((id) => selected.has(id))

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inventory</h1>
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            placeholder="Filter IP / hostname / OS…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button onClick={() => setExpanded(new Set(allKeys))} disabled={filtering}>
            Expand all
          </button>
          <button onClick={() => setExpanded(new Set())} disabled={filtering}>
            Collapse all
          </button>
          <button onClick={() => setMany(visibleHostIds, !allSelected)} disabled={visibleHostIds.length === 0}>
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          {selected.size > 0 && (
            <button className="danger" onClick={deleteSelected} disabled={deleting}>
              {deleting ? 'Deleting…' : `🗑 Delete Selected (${selected.size})`}
            </button>
          )}
          <button className="primary" onClick={() => setAdding(true)}>
            + Add Hosts
          </button>
        </div>
      </div>
      <p className="muted">
        {totalHosts} host(s) across all imports. Hosts are populated automatically from scan imports (and can be added
        manually) — organised by application, assessment type, period and scan. Click a host row to edit or delete it.
      </p>

      {tree.length === 0 && (
        <p className="muted">No hosts yet. Import a scan from an assessment, or use “+ Add Hosts”.</p>
      )}

      {tree.map((app) => (
        <div key={app.appId} className="card inv-app-card">
          <Section
            nodeKey={app.appId}
            label={<b>{app.appName}</b>}
            count={app.hostCount}
            level="app"
            expanded={shown}
            toggle={toggle}
          >
            {app.types.map((t) => {
              const tk = `${app.appId}|${t.type}`
              return (
                <Section
                  key={tk}
                  nodeKey={tk}
                  label={t.type}
                  count={countHosts(t)}
                  level="type"
                  expanded={shown}
                  toggle={toggle}
                >
                  {t.periods.map((p) => {
                    const pk = `${tk}|${p.period}`
                    return (
                      <Section
                        key={pk}
                        nodeKey={pk}
                        label={<span className="cap">{p.period}</span>}
                        count={countHosts(p)}
                        level="period"
                        expanded={shown}
                        toggle={toggle}
                      >
                        {p.scans.map((s) => {
                          const sk = `${pk}|${s.scan}`
                          return (
                            <Section
                              key={sk}
                              nodeKey={sk}
                              label={<>📄 {s.scan}</>}
                              count={s.hosts.length}
                              level="scan"
                              expanded={shown}
                              toggle={toggle}
                            >
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th className="check-col">
                                        <input
                                          type="checkbox"
                                          title="Select all hosts in this scan"
                                          checked={s.hosts.every((h) => selected.has(h.id))}
                                          onChange={(e) =>
                                            setMany(
                                              s.hosts.map((h) => h.id),
                                              e.target.checked
                                            )
                                          }
                                        />
                                      </th>
                                      <th>IP Address</th>
                                      <th>Hostname</th>
                                      <th>Operating System</th>
                                      <th>Status</th>
                                      {COUNT_SEVERITIES.map((sev) => (
                                        <th key={sev}>{sev}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.hosts.map((h) => {
                                      const c = sevCounts.get(h.id)
                                      return (
                                        <tr key={h.id} className="clickable" onClick={() => setEditing(h)}>
                                          <td className="check-col" onClick={(e) => e.stopPropagation()}>
                                            <input
                                              type="checkbox"
                                              checked={selected.has(h.id)}
                                              onChange={() => toggleSelect(h.id)}
                                            />
                                          </td>
                                          <td>{h.ip || '—'}</td>
                                          <td>{h.hostname || '—'}</td>
                                          <td>{h.os || '—'}</td>
                                          <td>
                                            <StatusBadge value={h.status || 'Pending'} />
                                          </td>
                                          {COUNT_SEVERITIES.map((sev) => (
                                            <td
                                              key={sev}
                                              className={c && c[sev] ? `sev-count sev-${sev.toLowerCase()}` : 'sev-count'}
                                            >
                                              {c?.[sev] ?? 0}
                                            </td>
                                          ))}
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </Section>
                          )
                        })}
                      </Section>
                    )
                  })}
                </Section>
              )
            })}
          </Section>
        </div>
      ))}

      {adding && <AddHostsModal onClose={() => setAdding(false)} />}
      {editing && <EditHostModal host={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
