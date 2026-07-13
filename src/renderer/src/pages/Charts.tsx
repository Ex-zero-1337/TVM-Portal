import { useMemo, useRef, useState } from 'react'
import type { Severity } from '@shared/types'
import { categoryOfType } from '@shared/types'
import { api } from '../api'
import { useDb } from '../data'
import { useEffectiveTheme } from '../theme'

/**
 * Charts module (SRS v5 §6): a reusable chart workspace for reporting and
 * presentations. Counts include Critical/High/Medium/Low only — Informational
 * findings are always excluded. The chart is rendered as a self-contained SVG
 * (explicit fills, no CSS classes) so it can be copied / exported pixel-perfect.
 */

const CHART_SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low']

// Severity colors per SRS v5 §6 (Red / Dark Yellow / Yellow / Green),
// validated for CVD separation and ≥3:1 contrast on the app surface. Every
// bar carries a direct label + count, so meaning is never color-alone.
const SEV_COLOR: Record<string, string> = {
  Critical: '#d03b3b',
  High: '#c9860a',
  Medium: '#fab219',
  Low: '#3fa34d'
}

const SCOPES = [
  { id: 'application', label: 'Application' },
  { id: 'web', label: 'Web Assessment' },
  { id: 'internal', label: 'Internal Assessment' },
  { id: 'external', label: 'External Assessment' },
  { id: 'host', label: 'Host Assessment' },
  { id: 'inventory', label: 'Inventory' }
] as const

type ScopeId = (typeof SCOPES)[number]['id']

/**
 * Chart chrome adapts to the appearance mode (SRS v6 §5); severity colors
 * above stay identical in both themes. Colors are baked into the SVG (not CSS
 * vars) so copied/exported images match what is on screen.
 */
const CHART_THEME = {
  dark: { surface: '#1a1a19', ink: '#e8e6e1', muted: '#98968f', track: '#262624' },
  light: { surface: '#ffffff', ink: '#1c1b18', muted: '#6e6c65', track: '#eaeae6' }
} as const

const W = 720
const ROW_H = 40
const TOP = 64
const LABEL_W = 90
const COUNT_W = 60

function SeverityBarChart({
  title,
  data,
  theme
}: {
  title: string
  data: [Severity, number][]
  theme: 'light' | 'dark'
}) {
  const t = CHART_THEME[theme]
  const max = Math.max(1, ...data.map(([, v]) => v))
  const h = TOP + data.length * ROW_H + 20
  const trackW = W - LABEL_W - COUNT_W - 40
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={h}
      viewBox={`0 0 ${W} ${h}`}
      style={{ maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label={title}
    >
      <rect x={0} y={0} width={W} height={h} fill={t.surface} rx={8} />
      <text x={20} y={30} fill={t.ink} fontSize={16} fontWeight={600} fontFamily="Segoe UI, Arial, sans-serif">
        {title}
      </text>
      <text x={20} y={50} fill={t.muted} fontSize={11} fontFamily="Segoe UI, Arial, sans-serif">
        Open + closed findings by severity · Informational excluded
      </text>
      {data.map(([sev, value], i) => {
        const y = TOP + i * ROW_H
        const barW = value > 0 ? Math.max((value / max) * trackW, 6) : 0
        return (
          <g key={sev}>
            <title>{`${sev}: ${value}`}</title>
            <text
              x={20 + LABEL_W - 8}
              y={y + 20}
              fill={t.ink}
              fontSize={12}
              textAnchor="end"
              fontFamily="Segoe UI, Arial, sans-serif"
            >
              {sev}
            </text>
            <rect x={20 + LABEL_W} y={y + 10} width={trackW} height={14} fill={t.track} rx={4} />
            {value > 0 && <rect x={20 + LABEL_W} y={y + 10} width={barW} height={14} fill={SEV_COLOR[sev]} rx={4} />}
            <text
              x={20 + LABEL_W + trackW + 10}
              y={y + 21}
              fill={t.ink}
              fontSize={12}
              fontWeight={600}
              fontFamily="Segoe UI, Arial, sans-serif"
            >
              {value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Rasterise the workspace SVG to a PNG blob at 2× for crisp exports. */
async function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const xml = new XMLSerializer().serializeToString(svg)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Could not render chart image'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = svg.width.baseVal.value * 2
  canvas.height = svg.height.baseVal.value * 2
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)
  ctx.drawImage(img, 0, 0)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png')
  )
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export function ChartsPage() {
  const db = useDb()
  const theme = useEffectiveTheme()
  const [scope, setScope] = useState<ScopeId>('application')
  // Application scope can be viewed per application or per project code (v6.6.4):
  // adhoc web findings are keyed by project code, not by application.
  const [viewBy, setViewBy] = useState<'app' | 'code'>('app')
  const [appId, setAppId] = useState('')
  const [code, setCode] = useState('')
  const chartRef = useRef<HTMLDivElement>(null)

  const codes = useMemo(
    () => [...new Set(db.requests.map((r) => r.projectCode).filter(Boolean))].sort(),
    [db.requests]
  )

  const scopeLabel = SCOPES.find((s) => s.id === scope)!.label
  const title =
    scope === 'application'
      ? `${viewBy === 'code' ? code || '—' : db.appName(appId)} — Findings by Severity`
      : `${scopeLabel} — Findings by Severity`

  const counts = useMemo(() => {
    const assessmentById = new Map(db.assessments.map((a) => [a.id, a]))
    const inScope = db.findings.filter((f) => {
      if (f.severity === 'Info') return false
      const a = assessmentById.get(f.assessmentId)
      const category = a ? a.category || categoryOfType(a.type) : undefined
      switch (scope) {
        case 'application':
          if (viewBy === 'code') return !!code && f.projectCode === code
          return !!appId && f.applicationId === appId
        case 'web':
          return category === 'web'
        case 'internal':
          return a?.type === 'Internal VA'
        case 'external':
          return a?.type === 'External VA'
        case 'host':
          return category === 'host'
        case 'inventory':
          return !!f.hostId
      }
    })
    return CHART_SEVERITIES.map((s) => [s, inScope.filter((f) => f.severity === s).length] as [Severity, number])
  }, [db.findings, db.assessments, scope, appId, viewBy, code])

  const total = counts.reduce((n, [, v]) => n + v, 0)
  const needsApp = scope === 'application' && (viewBy === 'code' ? !code : !appId)
  const safeName = title.replace(/\W+/g, '-')

  const getPng = async () => {
    const svg = chartRef.current?.querySelector('svg')
    if (!svg) throw new Error('No chart to export')
    return svgToPngBlob(svg)
  }

  const copyImage = async () => {
    try {
      const blob = await getPng()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      alert('Chart copied to clipboard as an image.')
    } catch (e) {
      alert(`Copy failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const exportPng = async () => {
    try {
      const blob = await getPng()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${safeName}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const exportPdf = async () => {
    try {
      const dataUrl = await blobToDataUrl(await getPng())
      await api.chartExportPdf(dataUrl, title, safeName)
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const copyTable = async () => {
    const lines = ['Severity\tCount', ...counts.map(([s, v]) => `${s}\t${v}`), `Total\t${total}`]
    await navigator.clipboard.writeText(lines.join('\n'))
    alert('Summary table copied to clipboard.')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Charts</h1>
      </div>
      <p className="muted">
        Reusable chart workspace for reporting and presentations. Counts include Critical, High, Medium and Low —
        Informational findings are excluded.
      </p>

      <div className="findings-filter card">
        <label>
          <span>Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as ScopeId)}>
            {SCOPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {scope === 'application' && (
          <>
            <label>
              <span>View by</span>
              <select value={viewBy} onChange={(e) => setViewBy(e.target.value as 'app' | 'code')}>
                <option value="app">Application</option>
                <option value="code">Project Code</option>
              </select>
            </label>
            {viewBy === 'app' ? (
              <label>
                <span>Application</span>
                <select value={appId} onChange={(e) => setAppId(e.target.value)}>
                  <option value="">— select an application —</option>
                  {db.applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                <span>Project Code</span>
                <select value={code} onChange={(e) => setCode(e.target.value)}>
                  <option value="">— select a project code —</option>
                  {codes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
      </div>

      {needsApp ? (
        <p className="muted">
          Select {viewBy === 'code' ? 'a project code' : 'an application'} above to build its chart.
        </p>
      ) : (
        <>
          <div className="card chart-workspace" ref={chartRef}>
            <SeverityBarChart title={title} data={counts} theme={theme} />
          </div>

          <div className="toolbar chart-actions">
            <button onClick={copyImage}>📋 Copy chart as image</button>
            <button onClick={exportPng}>🖼 Export PNG</button>
            <button onClick={exportPdf}>📄 Export PDF</button>
            <button onClick={copyTable}>📑 Copy summary table</button>
          </div>

          <div className="card">
            <h3>Severity Summary</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.map(([s, v]) => (
                    <tr key={s}>
                      <td>
                        <span className="chart-swatch" style={{ background: SEV_COLOR[s] }} /> {s}
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <b>Total</b>
                    </td>
                    <td>
                      <b>{total}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
