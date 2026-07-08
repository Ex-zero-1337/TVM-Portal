import { useMemo, useState } from 'react'
import type { Finding, Severity } from '@shared/types'
import { isFindingOpen, slaStats } from '@shared/sla'
import { useDb } from '../data'

/** Dashboard severities — Info is excluded from all dashboard numbers. */
const DASH_SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low']

/**
 * Chart colors (dark-surface set, validated): severity uses the reserved
 * status palette and every bar carries a text label + count, so meaning is
 * never color-alone. Single-series charts use categorical slot 1.
 */
const SEV_COLOR: Record<Severity, string> = {
  Critical: '#d03b3b',
  High: '#ec835a',
  Medium: '#fab219',
  Low: '#3987e5',
  Info: '#898781'
}
const SERIES_1 = '#3987e5'
const RISK_WEIGHT: Record<Severity, number> = { Critical: 10, High: 5, Medium: 2, Low: 1, Info: 0 }

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: 'bad' | 'good' }) {
  return (
    <div className="stat-tile">
      <div className={`stat-value ${tone === 'bad' ? 'stat-bad' : tone === 'good' ? 'stat-good' : ''}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

/** Horizontal bar row: thin mark, rounded data end, direct label + count. */
function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0
  return (
    <div className="hbar" title={`${label}: ${value}`}>
      <span className="hbar-label">{label}</span>
      <span className="hbar-track">
        <span className="hbar-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="hbar-value">{value}</span>
    </div>
  )
}

function BarList({
  data,
  color,
  colors,
  empty
}: {
  data: [string, number][]
  color?: string
  colors?: Record<string, string>
  empty: string
}) {
  if (data.length === 0) return <p className="muted">{empty}</p>
  const max = Math.max(...data.map(([, v]) => v))
  return (
    <div>
      {data.map(([label, value]) => (
        <HBar key={label} label={label} value={value} max={max} color={colors?.[label] ?? color ?? SERIES_1} />
      ))}
    </div>
  )
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function trendMonths(findings: Finding[]): [string, number][] {
  const months: [string, number][] = []
  const d = new Date()
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    months.push([`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, 0])
  }
  const idx = new Map(months.map(([k], i) => [k, i]))
  for (const f of findings) {
    const k = monthKey(f.discoveredDate || f.createdAt)
    const i = idx.get(k)
    if (i !== undefined) months[i][1] += 1
  }
  return months
}

export function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const db = useDb()
  const [selected, setSelected] = useState<Set<Severity>>(new Set(DASH_SEVERITIES))

  const toggle = (s: Severity) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  const model = useMemo(() => {
    // Info findings never count toward dashboard stats; the tick boxes narrow further.
    const findings = db.findings.filter((f) => f.severity !== 'Info' && selected.has(f.severity))
    const sla = slaStats(findings)
    const bySeverity = DASH_SEVERITIES.filter((s) => selected.has(s)).map(
      (s) => [s, findings.filter((f) => f.severity === s).length] as [string, number]
    )
    const open = findings.filter(isFindingOpen)

    const owasp = new Map<string, number>()
    const cwe = new Map<string, number>()
    for (const f of findings) {
      if (f.owasp) owasp.set(f.owasp, (owasp.get(f.owasp) ?? 0) + 1)
      if (f.cwe) cwe.set(f.cwe, (cwe.get(f.cwe) ?? 0) + 1)
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

    const appRisk = db.applications
      .map((a) => {
        const score = findings
          .filter((f) => f.applicationId === a.id && isFindingOpen(f))
          .reduce((s, f) => s + RISK_WEIGHT[f.severity], 0)
        return [a.name, score] as [string, number]
      })
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    const hostRisk = db.hosts
      .map((h) => {
        const score = findings
          .filter((f) => f.hostId === h.id && isFindingOpen(f))
          .reduce((s, f) => s + RISK_WEIGHT[f.severity], 0)
        return [h.hostname || h.ip, score] as [string, number]
      })
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    return {
      sla,
      bySeverity,
      openCount: open.length,
      owasp: top(owasp, 10),
      cwe: top(cwe, 10),
      appRisk,
      hostRisk,
      trend: trendMonths(findings)
    }
  }, [db, selected])

  const trendMax = Math.max(1, ...model.trend.map(([, v]) => v))

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="sev-checkboxes" title="Severities included in all dashboard numbers (Info is always excluded)">
          {DASH_SEVERITIES.map((s) => (
            <label key={s}>
              <input type="checkbox" checked={selected.has(s)} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
      </div>

      <div className="stat-row">
        <StatTile label="Total findings" value={model.sla.total} />
        <StatTile label="Open" value={model.sla.open} tone={model.sla.open ? 'bad' : 'good'} />
        <StatTile label="Closed" value={model.sla.closed} />
        <StatTile label="SLA overdue" value={model.sla.overdue} tone={model.sla.overdue ? 'bad' : 'good'} />
        <StatTile label="SLA compliance" value={`${model.sla.complianceRate}%`} tone={model.sla.complianceRate >= 90 ? 'good' : 'bad'} />
        <StatTile label="Avg closure (days)" value={model.sla.avgClosureDays} />
      </div>

      <div className="dash-grid">
        <div className="card">
          <h3>Findings by Severity</h3>
          <BarList data={model.bySeverity} colors={SEV_COLOR} empty="No findings yet." />
        </div>

        <div className="card">
          <h3>Open vs Closed</h3>
          <BarList
            data={[
              ['Open', model.sla.open],
              ['Closed', model.sla.closed]
            ]}
            empty="No findings yet."
          />
        </div>

        <div className="card span2">
          <h3>Vulnerability Trend (findings discovered, last 12 months)</h3>
          <div className="trend">
            {model.trend.map(([month, v]) => {
              // FR-D2: label as Month-Year, e.g. "Jan 2026"
              const label = new Date(`${month}-15`).toLocaleString('en', { month: 'short', year: 'numeric' })
              return (
                <div key={month} className="trend-col" title={`${label}: ${v} finding(s)`}>
                  <span className="trend-count">{v > 0 ? v : ''}</span>
                  <span className="trend-bar" style={{ height: `${(v / trendMax) * 100}%`, background: SERIES_1 }} />
                  <span className="trend-month">{label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <h3>OWASP Top 10 Mapping</h3>
          <BarList data={model.owasp} empty="No findings have an OWASP category yet." />
        </div>

        <div className="card">
          <h3>CWE Distribution</h3>
          <BarList data={model.cwe} empty="No findings have a CWE yet." />
        </div>

        <div className="card">
          <h3>Application Risk Ranking</h3>
          <BarList data={model.appRisk} empty="No open weighted findings." />
        </div>

        <div className="card">
          <h3>Host Risk Ranking</h3>
          <BarList data={model.hostRisk} empty="No open weighted findings." />
        </div>
      </div>

      {model.sla.total === 0 && (
        <div className="card onboarding">
          <h3>Getting started</h3>
          <ol>
            <li>
              Register an <a onClick={() => onNavigate('applications')}>application</a> and its{' '}
              <a onClick={() => onNavigate('hosts')}>hosts</a>.
            </li>
            <li>
              Create a request and an assessment in the matching{' '}
              <a onClick={() => onNavigate('assessments-web')}>assessment module</a>.
            </li>
            <li>Open the assessment to import a Nessus scan, or add findings manually.</li>
          </ol>
        </div>
      )}
    </div>
  )
}
