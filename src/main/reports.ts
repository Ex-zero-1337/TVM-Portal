import { BrowserWindow } from 'electron'
import ExcelJS from 'exceljs'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import fs from 'fs'
import path from 'path'
import type { Assessment, Finding, Host, Severity } from '../shared/types'
import { SEVERITIES } from '../shared/types'
import { isFindingOpen, isOverdue, slaDaysRemaining, slaStats } from '../shared/sla'
import { Store } from './store'

export interface ReportRequest {
  format: 'xlsx' | 'docx' | 'pdf'
  assessmentId?: string
  /** PDF only (§5.2.6): executive summary only, or the full technical report. */
  variant?: 'executive' | 'full'
  outputPath: string
}

interface ReportData {
  title: string
  projectCode: string
  generatedAt: string
  assessment?: Assessment
  findings: Finding[]
  hosts: Host[]
  hostName: (id: string) => string
  appName: (id: string) => string
  bySeverity: Record<Severity, number>
  sla: ReturnType<typeof slaStats>
  retestCounts: Record<string, number>
}

function collectData(store: Store, assessmentId?: string): ReportData {
  const assessment = assessmentId ? store.get('assessments', assessmentId) : undefined
  const request = assessment?.requestId ? store.get('requests', assessment.requestId) : undefined
  const findings = store
    .list('findings')
    .filter((f) => !assessmentId || f.assessmentId === assessmentId)
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
  const allHosts = store.list('hosts')
  const hostList = assessment ? allHosts.filter((h) => assessment.hostIds.includes(h.id)) : allHosts
  const hosts = new Map(allHosts.map((h) => [h.id, h]))
  const apps = new Map(store.list('applications').map((a) => [a.id, a]))

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>
  const retestCounts: Record<string, number> = { New: 0, Existing: 0, Retest: 0, Regression: 0, 'Context Change': 0 }
  for (const f of findings) {
    bySeverity[f.severity]++
    retestCounts[f.classification] = (retestCounts[f.classification] ?? 0) + 1
  }

  return {
    title: assessment ? `VAPT Report — ${assessment.name}` : 'TVM Portal — Portfolio Vulnerability Report',
    projectCode: request?.projectCode ?? '',
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    assessment,
    findings,
    hosts: hostList,
    hostName: (id) => {
      const h = hosts.get(id)
      return h ? h.hostname || h.ip : '—'
    },
    appName: (id) => apps.get(id)?.name ?? '—',
    bySeverity,
    sla: slaStats(findings),
    retestCounts
  }
}

/** "Annual 2025" style provenance for Existing findings (SRS v5 §5). */
function firstIdentifiedLabel(f: Finding): string {
  if (f.classification !== 'Existing' || !f.firstIdentifiedPeriod) return ''
  return [f.firstIdentifiedPeriod, f.firstIdentifiedProjectCode].filter(Boolean).join(' · ')
}

function execSummaryText(d: ReportData): string {
  const open = d.findings.filter(isFindingOpen).length
  return (
    `This report covers ${d.findings.length} finding(s)` +
    (d.assessment ? ` from assessment "${d.assessment.name}" (${d.assessment.type})` : ' across the portfolio') +
    `. ${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issues were identified. ` +
    `${open} finding(s) remain open, of which ${d.sla.overdue} are past their remediation SLA. ` +
    `Current SLA compliance is ${d.sla.complianceRate}% with an average closure time of ${d.sla.avgClosureDays} day(s).`
  )
}

// ---------------------------------------------------------------- Excel

async function writeExcel(d: ReportData, outputPath: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()

  const summary = wb.addWorksheet('Summary')
  summary.addRow([d.title]).font = { bold: true, size: 14 }
  summary.addRow([`Generated ${d.generatedAt}`])
  summary.addRow([])
  summary.addRow(['Executive Summary']).font = { bold: true }
  summary.addRow([execSummaryText(d)])
  summary.addRow([])
  summary.addRow(['Findings by Severity']).font = { bold: true }
  for (const s of SEVERITIES) summary.addRow([s, d.bySeverity[s]])
  summary.addRow([])
  summary.addRow(['SLA Summary']).font = { bold: true }
  summary.addRow(['Open', d.sla.open])
  summary.addRow(['Closed', d.sla.closed])
  summary.addRow(['Overdue', d.sla.overdue])
  summary.addRow(['Compliance rate', `${d.sla.complianceRate}%`])
  summary.addRow(['Avg closure (days)', d.sla.avgClosureDays])
  summary.addRow([])
  summary.addRow(['Retest Summary']).font = { bold: true }
  for (const [k, v] of Object.entries(d.retestCounts)) summary.addRow([k, v])
  summary.getColumn(1).width = 40

  const sheet = wb.addWorksheet('Findings')
  sheet.columns = [
    { header: 'Title', key: 'title', width: 45 },
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'CVSS', key: 'cvss', width: 7 },
    { header: 'Project Code', key: 'projectCode', width: 22 },
    { header: 'Application', key: 'app', width: 22 },
    { header: 'Host', key: 'host', width: 22 },
    { header: 'Port', key: 'port', width: 8 },
    { header: 'Endpoint', key: 'endpoint', width: 25 },
    { header: 'CVE', key: 'cve', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Classification', key: 'classification', width: 14 },
    { header: 'First Identified', key: 'firstIdentified', width: 18 },
    { header: 'Discovered', key: 'discovered', width: 12 },
    { header: 'SLA Due', key: 'sla', width: 12 },
    { header: 'Overdue', key: 'overdue', width: 9 },
    { header: 'Recommendation', key: 'rec', width: 60 }
  ]
  sheet.getRow(1).font = { bold: true }
  for (const f of d.findings) {
    sheet.addRow({
      title: f.title,
      severity: f.severity,
      cvss: f.cvss || '',
      projectCode: f.projectCode || '',
      app: d.appName(f.applicationId),
      host: d.hostName(f.hostId),
      port: f.port,
      endpoint: f.endpoint,
      cve: f.cve,
      status: f.status,
      classification: f.classification,
      firstIdentified: firstIdentifiedLabel(f),
      discovered: f.discoveredDate,
      sla: f.slaDueDate,
      overdue: isOverdue(f) ? 'YES' : '',
      rec: f.recommendation
    })
  }
  sheet.autoFilter = { from: 'A1', to: 'P1' }

  const slaSheet = wb.addWorksheet('SLA Tracking')
  slaSheet.columns = [
    { header: 'Title', key: 'title', width: 45 },
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Discovered', key: 'discovered', width: 12 },
    { header: 'SLA Due', key: 'due', width: 12 },
    { header: 'Days Remaining', key: 'days', width: 15 },
    { header: 'Overdue', key: 'overdue', width: 9 },
    { header: 'Closed', key: 'closed', width: 12 }
  ]
  slaSheet.getRow(1).font = { bold: true }
  for (const f of d.findings) {
    slaSheet.addRow({
      title: f.title,
      severity: f.severity,
      status: f.status,
      discovered: f.discoveredDate,
      due: f.slaDueDate,
      days: isFindingOpen(f) && f.slaDueDate ? slaDaysRemaining(f) : '',
      overdue: isOverdue(f) ? 'YES' : '',
      closed: f.closedDate
    })
  }
  slaSheet.autoFilter = { from: 'A1', to: 'H1' }

  const hostSheet = wb.addWorksheet('Host Mapping')
  hostSheet.columns = [
    { header: 'IP Address', key: 'ip', width: 16 },
    { header: 'Hostname', key: 'hostname', width: 26 },
    { header: 'Application', key: 'app', width: 22 },
    { header: 'Environment', key: 'env', width: 13 },
    { header: 'Exposure', key: 'exposure', width: 10 },
    { header: 'Source Import', key: 'source', width: 30 },
    { header: 'Findings', key: 'count', width: 10 }
  ]
  hostSheet.getRow(1).font = { bold: true }
  for (const h of d.hosts) {
    hostSheet.addRow({
      ip: h.ip,
      hostname: h.hostname,
      app: d.appName(h.applicationId),
      env: h.environment,
      exposure: h.exposure,
      source: h.sourceFile || 'manual',
      count: d.findings.filter((f) => f.hostId === h.id).length
    })
  }

  const sevSheet = wb.addWorksheet('Severity Distribution')
  sevSheet.addRow(['Severity', 'Count', 'Share']).font = { bold: true }
  const total = d.findings.length || 1
  for (const s of SEVERITIES) {
    sevSheet.addRow([s, d.bySeverity[s], `${Math.round((d.bySeverity[s] / total) * 100)}%`])
  }
  sevSheet.getColumn(1).width = 14

  await wb.xlsx.writeFile(outputPath)
}

// ---------------------------------------------------------------- Word

async function writeDocx(d: ReportData, outputPath: string): Promise<void> {
  const kv = (rows: [string, string | number][]) =>
    new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      rows: rows.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: k, bold: true })] })] }),
              new TableCell({ children: [new Paragraph(String(v))] })
            ]
          })
      )
    })

  const findingBlocks = d.findings.flatMap((f) => [
    new Paragraph({ heading: HeadingLevel.HEADING_2, text: `${f.severity}: ${f.title}` }),
    kv([
      ['Application', d.appName(f.applicationId)],
      ['Project Code', f.projectCode || '—'],
      ['Host', `${d.hostName(f.hostId)}${f.port ? ':' + f.port : ''}`],
      ['Endpoint', f.endpoint || '—'],
      ['CVSS', f.cvss || '—'],
      ['CVE', f.cve || '—'],
      ['Status', f.status],
      ['Classification', firstIdentifiedLabel(f) ? `Existing • First Identified: ${firstIdentifiedLabel(f)}` : f.classification],
      ['SLA due', f.slaDueDate || '—']
    ]),
    new Paragraph({ children: [new TextRun({ text: 'Description', bold: true })], spacing: { before: 200 } }),
    new Paragraph(f.description || '—'),
    new Paragraph({ children: [new TextRun({ text: 'Evidence', bold: true })], spacing: { before: 200 } }),
    new Paragraph(f.evidence || '—'),
    new Paragraph({ children: [new TextRun({ text: 'Recommendation', bold: true })], spacing: { before: 200 } }),
    new Paragraph({ text: f.recommendation || '—', spacing: { after: 400 } })
  ])

  const doc = new Document({
    features: { updateFields: true },
    sections: [
      {
        children: [
          // Cover page (§5.2.5) — project code front and centre.
          new Paragraph({ spacing: { before: 3000 } }),
          new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, text: d.title }),
          ...(d.projectCode
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: d.projectCode, bold: true, size: 36 })]
                })
              ]
            : []),
          new Paragraph({ alignment: AlignmentType.CENTER, text: `Generated ${d.generatedAt}` }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Table of Contents' }),
          new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: '1. Executive Summary' }),
          new Paragraph(execSummaryText(d)),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: '2. Risk Summary' }),
          kv(SEVERITIES.map((s) => [s, d.bySeverity[s]])),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: '3. SLA Summary' }),
          kv([
            ['Open findings', d.sla.open],
            ['Closed findings', d.sla.closed],
            ['Overdue findings', d.sla.overdue],
            ['Compliance rate', `${d.sla.complianceRate}%`],
            ['Average closure time', `${d.sla.avgClosureDays} days`]
          ]),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: '4. Retest Summary' }),
          kv(Object.entries(d.retestCounts) as [string, number][]),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: '5. Technical Findings' }),
          ...findingBlocks,
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Appendix A. Host Mapping' }),
          kv(d.hosts.map((h) => [h.ip || h.hostname, `${h.hostname} · ${h.exposure} · ${h.sourceFile || 'manual'}`])),
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Appendix B. SLA Reference' }),
          kv([
            ['Critical', '30 days'],
            ['High', '60 days'],
            ['Medium', '90 days'],
            ['Low', '180 days']
          ])
        ]
      }
    ]
  })
  fs.writeFileSync(outputPath, await Packer.toBuffer(doc))
}

// ---------------------------------------------------------------- PDF

const SEV_COLORS: Record<Severity, string> = {
  Critical: '#b91c1c',
  High: '#ea580c',
  Medium: '#ca8a04',
  Low: '#2563eb',
  Info: '#6b7280'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function reportHtml(d: ReportData, variant: 'executive' | 'full'): string {
  const sevRows = SEVERITIES.map(
    (s) => `<tr><td><span class="sev" style="background:${SEV_COLORS[s]}">${s}</span></td><td>${d.bySeverity[s]}</td></tr>`
  ).join('')
  const findingRows = d.findings
    .map(
      (f) => `
    <div class="finding">
      <h3><span class="sev" style="background:${SEV_COLORS[f.severity]}">${f.severity}</span> ${esc(f.title)}</h3>
      <table class="meta">
        <tr><td>Host</td><td>${esc(d.hostName(f.hostId))}${f.port ? ':' + esc(f.port) : ''}</td>
            <td>Application</td><td>${esc(d.appName(f.applicationId))}</td></tr>
        <tr><td>CVSS</td><td>${f.cvss || '—'}</td><td>CVE</td><td>${esc(f.cve) || '—'}</td></tr>
        <tr><td>Project Code</td><td>${esc(f.projectCode || '') || '—'}</td>
            <td>Classification</td><td>${firstIdentifiedLabel(f) ? `Existing • First Identified: ${esc(firstIdentifiedLabel(f))}` : f.classification}</td></tr>
        <tr><td>Status</td><td>${f.status}</td><td>SLA due</td><td>${f.slaDueDate || '—'}${isOverdue(f) ? ' <b style="color:#b91c1c">(OVERDUE)</b>' : ''}</td></tr>
      </table>
      <p><b>Description:</b> ${esc(f.description) || '—'}</p>
      <p><b>Recommendation:</b> ${esc(f.recommendation) || '—'}</p>
    </div>`
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#111;margin:40px;font-size:12px}
    h1{font-size:22px;border-bottom:3px solid #111;padding-bottom:8px}
    h2{font-size:16px;margin-top:28px}
    h3{font-size:13px;margin:0 0 6px}
    table{border-collapse:collapse;width:100%;margin:8px 0}
    td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}
    .sev{color:#fff;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:600}
    .finding{border:1px solid #ddd;border-radius:6px;padding:12px;margin:12px 0;page-break-inside:avoid}
    .meta td:nth-child(odd){font-weight:600;width:12%;background:#f5f5f5}
  </style></head><body>
    <h1>${esc(d.title)}</h1>
    ${d.projectCode ? `<p><b>Project Code:</b> ${esc(d.projectCode)}</p>` : ''}
    <p>Generated ${d.generatedAt}${variant === 'executive' ? ' · Executive Summary edition' : ''}</p>
    <h2>1. Executive Summary</h2><p>${esc(execSummaryText(d))}</p>
    <h2>2. Risk Summary</h2><table>${sevRows}</table>
    <h2>3. SLA Summary</h2>
    <table>
      <tr><td>Open</td><td>${d.sla.open}</td></tr>
      <tr><td>Closed</td><td>${d.sla.closed}</td></tr>
      <tr><td>Overdue</td><td>${d.sla.overdue}</td></tr>
      <tr><td>Compliance rate</td><td>${d.sla.complianceRate}%</td></tr>
      <tr><td>Average closure time</td><td>${d.sla.avgClosureDays} days</td></tr>
    </table>
    <h2>4. Retest Summary</h2>
    <table>${Object.entries(d.retestCounts)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join('')}</table>
    ${variant === 'full' ? `<h2>5. Technical Findings</h2>${findingRows || '<p>No findings.</p>'}` : ''}
  </body></html>`
}

async function writePdf(d: ReportData, outputPath: string, variant: 'executive' | 'full'): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHtml(d, variant)))
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    fs.writeFileSync(outputPath, pdf)
  } finally {
    win.destroy()
  }
}

export async function generateReport(store: Store, req: ReportRequest): Promise<string> {
  const data = collectData(store, req.assessmentId)
  fs.mkdirSync(path.dirname(req.outputPath), { recursive: true })
  if (req.format === 'xlsx') await writeExcel(data, req.outputPath)
  else if (req.format === 'docx') await writeDocx(data, req.outputPath)
  else await writePdf(data, req.outputPath, req.variant ?? 'full')
  return req.outputPath
}
