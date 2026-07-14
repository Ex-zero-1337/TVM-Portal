import { BrowserWindow } from 'electron'
import ExcelJS from 'exceljs'
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  ImageRun,
  type IParagraphOptions,
  type ITableCellOptions,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType
} from 'docx'
import fs from 'fs'
import path from 'path'
import type { Application, Assessment, EvidenceAttachment, Finding, Host, Severity, VaptRequest } from '../shared/types'
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
  request?: VaptRequest
  application?: Application
  findings: Finding[]
  hosts: Host[]
  hostName: (id: string) => string
  appName: (id: string) => string
  attachmentPath: (att: EvidenceAttachment) => string
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
    request,
    application: assessment?.applicationId ? apps.get(assessment.applicationId) : undefined,
    findings,
    hosts: hostList,
    hostName: (id) => {
      const h = hosts.get(id)
      return h ? h.hostname || h.ip : '—'
    },
    appName: (id) => apps.get(id)?.name ?? '—',
    attachmentPath: (att) => store.resolve(att.path),
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
    (d.assessment ? ` from assessment "${assessmentPeriodTitle(d)}"` : ' across the portfolio') +
    `. ${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issues were identified. ` +
    `${open} finding(s) remain open, of which ${d.sla.overdue} are past their remediation SLA. ` +
    `Current SLA compliance is ${d.sla.complianceRate}% with an average closure time of ${d.sla.avgClosureDays} day(s).`
  )
}



const REPORT_SEVERITIES = SEVERITIES.filter((severity) => severity !== 'Info') as Exclude<Severity, 'Info'>[]

const SEVERITY_XLSX_COLORS: Record<Exclude<Severity, 'Info'>, { fill: string; font: string }> = {
  Critical: { fill: 'FFDC2626', font: 'FFFFFFFF' },
  High: { fill: 'FFD97706', font: 'FFFFFFFF' },
  Medium: { fill: 'FFFFF2CC', font: 'FF111827' },
  Low: { fill: 'FF16A34A', font: 'FFFFFFFF' }
}

function reportFindings(d: ReportData): Finding[] {
  return d.findings.filter((f) => f.severity !== 'Info')
}

function assessmentAreaName(d: ReportData): string {
  switch (reportAssessmentKind(d)) {
    case 'web':
      return 'Web'
    case 'api':
      return 'API'
    case 'mobile':
      return 'Mobile'
    case 'source-code':
      return 'Source Code'
    case 'internal':
      return 'Internal'
    case 'external':
      return 'External'
    case 'internal-external':
      return 'Internal/External'
    case 'host':
      return 'Host'
    default:
      return assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? '')) || 'Assessment'
  }
}

function excelSubjectName(d: ReportData): string {
  return (d.application?.name || d.request?.systemName || '').trim()
}

function assessmentPeriodTitle(d: ReportData): string {
  const subject = excelSubjectName(d) || assessmentAreaName(d)
  const dateIso = d.assessment?.startDate || d.assessment?.endDate || d.generatedAt
  const date = new Date(dateIso)
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear()
  const quarter = Number.isNaN(date.getTime()) ? Math.floor(new Date().getMonth() / 3) + 1 : Math.floor(date.getMonth() / 3) + 1
  if (d.assessment?.timeframe === 'annual') return `Annual ${year} - ${subject}`
  if (d.assessment?.timeframe === 'quarterly') return `Q${quarter} Assessment - ${subject}`
  return [d.projectCode, subject].filter(Boolean).join(' - ') || subject
}

function excelBlank(value?: string | number): string | number {
  if (value === undefined || value === null) return ''
  const text = String(value).trim()
  return text === '—' ? '' : value
}

function excelDash(value?: string | number): string | number {
  const blank = excelBlank(value)
  return String(blank).trim() ? blank : '-'
}


function applyHeaderStyle(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB8C7D9' } },
      left: { style: 'thin', color: { argb: 'FFB8C7D9' } },
      bottom: { style: 'thin', color: { argb: 'FFB8C7D9' } },
      right: { style: 'thin', color: { argb: 'FFB8C7D9' } }
    }
  })
}


function applyHeaderRangeStyle(row: ExcelJS.Row, from = 1, to = 4): void {
  for (let col = from; col <= to; col++) {
    const cell = row.getCell(col)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
    cell.alignment = { vertical: 'middle', horizontal: col === from ? 'left' : 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB8C7D9' } },
      left: { style: 'thin', color: { argb: 'FFB8C7D9' } },
      bottom: { style: 'thin', color: { argb: 'FFB8C7D9' } },
      right: { style: 'thin', color: { argb: 'FFB8C7D9' } }
    }
  }
}

function applyDashboardCell(cell: ExcelJS.Cell, horizontal: 'left' | 'center' = 'left'): void {
  cell.alignment = { horizontal, vertical: 'middle', wrapText: true }
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
    left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
    bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
    right: { style: 'thin', color: { argb: 'FFD9E2EC' } }
  }
}

function addDashboardPairHeader(sheet: ExcelJS.Worksheet, left: string, right: string): void {
  const rowNumber = sheet.rowCount + 1
  sheet.addRow([left, right, '', ''])
  applyHeaderRangeStyle(sheet.getRow(rowNumber), 1, 4)
}

function addDashboardPairRow(sheet: ExcelJS.Worksheet, label: string, value: string | number, valueAlign: 'left' | 'center' = 'left'): void {
  const rowNumber = sheet.rowCount + 1
  sheet.addRow([label, value, '', ''])
  applyDashboardCell(sheet.getCell(`A${rowNumber}`), 'left')
  applyDashboardCell(sheet.getCell(`B${rowNumber}`), valueAlign)
  applyDashboardCell(sheet.getCell(`C${rowNumber}`), 'left')
  applyDashboardCell(sheet.getCell(`D${rowNumber}`), 'left')
}

function applyTableStyle(sheet: ExcelJS.Worksheet, headerRow = 1): void {
  applyHeaderStyle(sheet.getRow(headerRow))
  sheet.views = [{ state: 'frozen', ySplit: headerRow }]
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: 'top', wrapText: true }
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        right: { style: 'thin', color: { argb: 'FFD9E2EC' } }
      }
      if (rowNumber > headerRow && rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }
    })
  })
}

function applySeverityStyle(cell: ExcelJS.Cell, severity: Severity): void {
  if (severity === 'Info') return
  const tone = SEVERITY_XLSX_COLORS[severity]
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } }
  cell.font = { bold: true, color: { argb: tone.font } }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
}

// ---------------------------------------------------------------- Excel

async function writeExcel(d: ReportData, outputPath: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const findings = reportFindings(d)

  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 28 }, { width: 38 }, { width: 18 }, { width: 18 }]
  summary.getCell('A1').value = assessmentPeriodTitle(d)
  summary.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
  summary.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' }
  applyHeaderRangeStyle(summary.getRow(1), 1, 4)
  summary.getRow(1).height = 28

  summary.addRow([])
  summary.addRow(['Report Information', '', '', ''])
  applyHeaderRangeStyle(summary.getRow(3), 1, 4)
  addDashboardPairHeader(summary, 'Field', 'Details')
  const metaRows = [
    ['Project Code', excelDash(d.projectCode)],
    ['Application / System', excelDash(excelSubjectName(d))],
    ['Owner Name', excelDash(d.application?.owner)],
    ['Department', excelDash(d.request?.department || d.application?.businessUnit)],
    ['Assessment Type', excelDash(assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? '')))],
    ['Assessment Window', excelDash([d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(' to '))],
    ['Generated At', excelDash(d.generatedAt)]
  ] as [string, string | number][]
  for (const [label, value] of metaRows) addDashboardPairRow(summary, label, value, 'left')

  summary.addRow([])
  const severityHeaderRow = summary.rowCount + 1
  summary.addRow(['Severity Dashboard', '', '', ''])
  applyHeaderRangeStyle(summary.getRow(severityHeaderRow), 1, 4)
  const severityTableHeaderRow = summary.rowCount + 1
  summary.addRow(['Severity', 'Number of Finding', 'Open', 'Closed'])
  applyHeaderRangeStyle(summary.getRow(severityTableHeaderRow), 1, 4)
  for (const severity of REPORT_SEVERITIES) {
    const severityFindings = findings.filter((f) => f.severity === severity)
    const row = summary.addRow([
      severity,
      severityFindings.length,
      severityFindings.filter(isFindingOpen).length,
      severityFindings.filter((f) => !isFindingOpen(f)).length
    ])
    applySeverityStyle(row.getCell(1), severity)
    row.getCell(2).alignment = { horizontal: 'center' }
    row.getCell(3).alignment = { horizontal: 'center' }
    row.getCell(4).alignment = { horizontal: 'center' }
  }

  summary.addRow([])
  const slaHeaderRow = summary.rowCount + 1
  summary.addRow(['SLA Dashboard', '', '', ''])
  applyHeaderRangeStyle(summary.getRow(slaHeaderRow), 1, 4)
  addDashboardPairHeader(summary, 'Metric', 'Value')
  addDashboardPairRow(summary, 'Open Findings', d.sla.open, 'center')
  addDashboardPairRow(summary, 'Closed Findings', d.sla.closed, 'center')
  addDashboardPairRow(summary, 'Overdue Findings', d.sla.overdue, 'center')
  addDashboardPairRow(summary, 'SLA Compliance', `${d.sla.complianceRate}%`, 'center')
  addDashboardPairRow(summary, 'Average Closure Days', d.sla.avgClosureDays, 'center')

  summary.addRow([])
  const execHeaderRow = summary.rowCount + 1
  summary.addRow(['Executive Summary', '', '', ''])
  applyHeaderRangeStyle(summary.getRow(execHeaderRow), 1, 4)
  summary.addRow([execSummaryText({ ...d, findings })])
  summary.getCell(`A${summary.rowCount}`).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' }
  for (let col = 2; col <= 4; col++) applyDashboardCell(summary.getRow(summary.rowCount).getCell(col), 'left')
  summary.getRow(summary.rowCount).height = 54
  summary.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        right: { style: 'thin', color: { argb: 'FFD9E2EC' } }
      }
      cell.alignment = { ...(cell.alignment ?? {}), vertical: 'top', wrapText: true }
    })
  })

  const tracker = wb.addWorksheet('Report Tracker')
  tracker.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Project Code', key: 'projectCode', width: 20 },
    { header: 'Application', key: 'app', width: 24 },
    { header: 'Finding', key: 'title', width: 42 },
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'CVSS', key: 'cvss', width: 8 },
    { header: 'Description', key: 'description', width: 55 },
    { header: 'Affected Asset', key: 'asset', width: 34 },
    { header: 'Host', key: 'host', width: 22 },
    { header: 'Affected Endpoint', key: 'endpoint', width: 28 },
    { header: 'Affected Parameter', key: 'parameter', width: 20 },
    { header: 'Recommendation', key: 'recommendation', width: 60 },
    { header: 'Proof of Concept', key: 'poc', width: 55 },
    { header: 'OWASP', key: 'owasp', width: 22 },
    { header: 'Discovered', key: 'discovered', width: 14 }
  ]
  for (const [index, f] of findings.entries()) {
    tracker.addRow({
      id: 'F-' + String(index + 1).padStart(3, '0'),
      projectCode: excelBlank(f.projectCode || d.projectCode),
      app: excelBlank(d.appName(f.applicationId)),
      title: excelBlank(f.title),
      severity: excelBlank(f.severity),
      status: excelBlank(f.status),
      cvss: excelBlank(f.cvss || ''),
      description: excelBlank(f.description),
      asset: excelBlank(f.affectedAsset || f.endpoint || (f.hostId ? d.hostName(f.hostId) : '')),
      host: excelBlank(f.hostId ? d.hostName(f.hostId) : ''),
      endpoint: excelBlank(f.endpoint),
      parameter: excelBlank(f.parameter),
      recommendation: excelBlank(f.recommendation),
      poc: excelBlank([f.evidence, (f.attachments ?? []).map((a) => a.filename).join('; ')].filter(Boolean).join('\n')),
      owasp: excelBlank(f.owasp),
      discovered: excelBlank(f.discoveredDate)
    })
  }
  tracker.autoFilter = { from: 'A1', to: 'P1' }
  applyTableStyle(tracker)
  tracker.eachRow((row, rowNumber) => {
    if (rowNumber > 1) applySeverityStyle(row.getCell('severity'), row.getCell('severity').value as Severity)
  })

  const slaSheet = wb.addWorksheet('SLA Tracking')
  slaSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Finding', key: 'title', width: 45 },
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Discovered', key: 'discovered', width: 14 },
    { header: 'SLA Due', key: 'due', width: 14 },
    { header: 'Days Remaining', key: 'days', width: 16 },
    { header: 'Overdue', key: 'overdue', width: 10 },
    { header: 'Closed', key: 'closed', width: 14 }
  ]
  for (const [index, f] of findings.entries()) {
    slaSheet.addRow({
      id: 'F-' + String(index + 1).padStart(3, '0'),
      title: excelBlank(f.title),
      severity: excelBlank(f.severity),
      status: excelBlank(f.status),
      discovered: excelBlank(f.discoveredDate),
      due: excelBlank(f.slaDueDate),
      days: isFindingOpen(f) && f.slaDueDate ? slaDaysRemaining(f) : '',
      overdue: isOverdue(f) ? 'YES' : '',
      closed: excelBlank(f.closedDate)
    })
  }
  slaSheet.autoFilter = { from: 'A1', to: 'I1' }
  applyTableStyle(slaSheet)
  slaSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) applySeverityStyle(row.getCell('severity'), row.getCell('severity').value as Severity)
  })

  await wb.xlsx.writeFile(outputPath)
}
// ---------------------------------------------------------------- Word

function displayValue(value?: string | number): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function paragraph(text = '', options: Partial<IParagraphOptions> = {}): Paragraph {
  return new Paragraph({
    style: 'Normal',
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, size: 24 })],
    spacing: { after: 120 },
    ...options
  })
}

function blankLine(): Paragraph {
  return new Paragraph({ text: '', spacing: { before: 80, after: 80 } })
}

function headingTextRun(text: string, size: number): TextRun {
  return new TextRun({ text, bold: true, size })
}

function headingChildren(text: string, size: number, bookmarkId?: string): (TextRun | Bookmark)[] {
  const run = headingTextRun(text, size)
  return bookmarkId ? [new Bookmark({ id: bookmarkId, children: [run] })] : [run]
}

function heading1(text: string, bookmarkId?: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 340, after: 200 },
    children: headingChildren(text, 36, bookmarkId)
  })
}

function heading2(text: string, bookmarkId?: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 160 },
    children: headingChildren(text, 28, bookmarkId)
  })
}

function tocTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 160 },
    children: [new TextRun({ text, bold: true, size: 40 })]
  })
}

function reportDate(d: ReportData): string {
  return d.generatedAt.split(' ')[0] || d.generatedAt
}

function applicationName(d: ReportData): string {
  return d.application?.name || d.request?.systemName || d.assessment?.name || ''
}

type ReportAssessmentKind = 'web' | 'api' | 'mobile' | 'source-code' | 'internal' | 'external' | 'internal-external' | 'host' | 'retest'

function normalizeAssessmentKind(...values: unknown[]): ReportAssessmentKind | undefined {
  for (const value of values) {
    const raw = String(value ?? '').trim()
    if (!raw) continue
    const text = raw.toLowerCase().replace(/[\s_\-/]+/g, ' ')
    if (text.includes('source code') || text.includes('code review') || text.includes('secure code') || text.includes('sast') || text.includes('static application security')) return 'source-code'
    if (text === 'web' || text.includes('web application') || text.includes('wapt')) return 'web'
    if (text === 'api' || text.includes('api security') || text.includes('api assessment')) return 'api'
    if (text.includes('mobile') || text.includes('mapt')) return 'mobile'
    if (text.includes('internal external') || text.includes('internal / external')) return 'internal-external'
    if (text.includes('external') || text.includes(' eva') || text === 'eva' || text.includes('external va')) return 'external'
    if (text.includes('internal') || text.includes(' iva') || text === 'iva' || text.includes('internal va')) return 'internal'
    if (text === 'host' || text.includes('host va') || text.includes('host vulnerability')) return 'host'
    if (text.includes('retest')) return 'retest'
    if (text === 'web application') return 'web'
  }
  return undefined
}

function reportAssessmentKind(d: ReportData): ReportAssessmentKind | undefined {
  return normalizeAssessmentKind(
    d.assessment?.type,
    d.request?.assessmentType,
    d.request?.source?.typeOfSystem,
    d.assessment?.category,
    d.assessment?.name,
    d.request?.title
  )
}

function reportTitle(d: ReportData): string {
  switch (reportAssessmentKind(d)) {
    case 'web':
      return 'Web Application Penetration Testing (WAPT) Report'
    case 'api':
      return 'API Security Assessment Report'
    case 'mobile':
      return 'Mobile Application Penetration Testing (MAPT) Report'
    case 'source-code':
      return 'Source Code Security Review Report'
    case 'internal':
      return 'Internal Vulnerability Assessment (IVA) Report'
    case 'external':
      return 'External Vulnerability Assessment (EVA) Report'
    case 'internal-external':
      return 'Internal / External Vulnerability Assessment Report'
    case 'host':
      return 'Host Vulnerability Assessment Report'
    case 'retest':
      return 'Security Retest Report'
    default:
      return d.assessment || d.request ? 'Security Assessment Report' : 'Portfolio Vulnerability Report'
  }
}

function executiveReportTitle(d: ReportData): string {
  return reportTitle(d).replace(/ Report$/, ' Executive Summary Report')
}

function coverTextParagraph(text: string, size: number, bold = false, after = 0): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: 360, after },
    children: [new TextRun({ text, bold, size })]
  })
}

function coverSubjectParagraphs(d: ReportData): Paragraph[] {
  const appName = applicationName(d)
  const lines = d.projectCode ? [d.projectCode, appName].filter(Boolean) : [appName || detailValue('')]
  return lines.map((line, index) => coverTextParagraph(line, 44, true, index === lines.length - 1 ? 0 : 90))
}

function coverLogo(): Paragraph | undefined {
  const candidates = [
    path.join(process.cwd(), 'image', 'bankislam-logo.png'),
    path.join(__dirname, '..', '..', 'image', 'bankislam-logo.png')
  ]
  const logoPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!logoPath) return undefined
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 320 },
    children: [
      new ImageRun({
        type: 'png',
        data: fs.readFileSync(logoPath),
        transformation: { width: 680, height: 234 },
        altText: { title: 'Bank Islam Logo', description: 'Bank Islam logo', name: 'Bank Islam Logo' }
      })
    ]
  })
}

function assessmentTypeLabel(type?: string, fallback?: string): string {
  switch (normalizeAssessmentKind(type, fallback)) {
    case 'web':
      return 'Web Application Testing'
    case 'api':
      return 'API Security Assessment'
    case 'mobile':
      return 'Mobile Application Testing'
    case 'source-code':
      return 'Source Code Security Review'
    case 'internal':
      return 'Internal Vulnerability Assessment'
    case 'external':
      return 'External Vulnerability Assessment'
    case 'internal-external':
      return 'Internal / External Vulnerability Assessment'
    case 'host':
      return 'Host Vulnerability Assessment'
    case 'retest':
      return 'Security Retest'
    default:
      return type || fallback || ''
  }
}

function subsection(text: string, bookmarkId?: string): Paragraph {
  return heading2(text, bookmarkId)
}

function numberedLine(text: string): Paragraph {
  return new Paragraph({
    style: 'Normal',
    numbering: { reference: 'owasp-roman', level: 0 },
    spacing: { after: 70 },
    children: [new TextRun({ text, size: 24 })]
  })
}

type TocEntry = { id: string; title: string; level: 1 | 2; page: number }

function tocEntries(findings: Finding[]): TocEntry[] {
  return [
    { id: 'toc_document_control', title: 'Document Control', level: 1, page: 2 },
    { id: 'toc_executive_summary', title: '1 Executive Summary', level: 1, page: 4 },
    { id: 'toc_executive_introduction', title: '1.1 Introduction', level: 2, page: 4 },
    { id: 'toc_background_information', title: '1.2 Background Information', level: 2, page: 4 },
    { id: 'toc_reference_standards', title: '1.3 Reference Standards', level: 2, page: 4 },
    { id: 'toc_purpose_of_testing', title: '1.4 Purpose of Testing', level: 2, page: 4 },
    { id: 'toc_summary_technical_findings', title: '2 Summary of Technical Findings', level: 1, page: 5 },
    { id: 'toc_summary_introduction', title: '2.1 Introduction', level: 2, page: 5 },
    { id: 'toc_project_scope', title: '2.2 Project Scope', level: 2, page: 5 },
    { id: 'toc_summary_findings', title: '2.3 Summary of Findings', level: 2, page: 5 },
    { id: 'toc_detailed_technical_findings', title: '3 Detailed Technical Findings', level: 1, page: 6 },
    ...findings.map((finding, index) => ({ id: `toc_finding_${index + 1}`, title: `3.${index + 1} ${finding.title}`, level: 2 as const, page: 6 }))
  ]
}

function tocField(findings: Finding[]): TableOfContents {
  return new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-2',
    hideTabAndPageNumbersInWebView: true,
    cachedEntries: tocEntries(findings).map((entry) => ({ title: entry.title, level: entry.level, page: entry.page, href: entry.id })),
    beginDirty: true
  })
}


function referenceRiskIntro(d: ReportData): string {
  switch (reportAssessmentKind(d)) {
    case 'web':
      return 'The assessment is aligned to the latest OWASP Top 10:2025 application security risk categories where applicable:'
    case 'api':
      return 'The assessment is aligned to the OWASP API Security Top 10 2023 risk categories where applicable:'
    case 'mobile':
      return 'The assessment is aligned to the OWASP Mobile Top 10 2024 risk categories and OWASP MASVS guidance where applicable:'
    case 'source-code':
      return 'The review is aligned to secure code review references and common software weakness categories where applicable:'
    case 'internal':
    case 'external':
    case 'internal-external':
    case 'host':
      return 'The assessment is aligned to vulnerability assessment and secure configuration reference areas where applicable:'
    default:
      return 'The assessment is aligned to general security assessment reference areas where a specific risk category is not available:'
  }
}

function referenceRiskCategories(d: ReportData): string[] {
  switch (reportAssessmentKind(d)) {
    case 'web':
      return [
        'A01:2025 - Broken Access Control',
        'A02:2025 - Security Misconfiguration',
        'A03:2025 - Software Supply Chain Failures',
        'A04:2025 - Cryptographic Failures',
        'A05:2025 - Injection',
        'A06:2025 - Insecure Design',
        'A07:2025 - Authentication Failures',
        'A08:2025 - Software or Data Integrity Failures',
        'A09:2025 - Security Logging and Alerting Failures',
        'A10:2025 - Mishandling of Exceptional Conditions'
      ]
    case 'api':
      return [
        'API1:2023 - Broken Object Level Authorization',
        'API2:2023 - Broken Authentication',
        'API3:2023 - Broken Object Property Level Authorization',
        'API4:2023 - Unrestricted Resource Consumption',
        'API5:2023 - Broken Function Level Authorization',
        'API6:2023 - Unrestricted Access to Sensitive Business Flows',
        'API7:2023 - Server Side Request Forgery',
        'API8:2023 - Security Misconfiguration',
        'API9:2023 - Improper Inventory Management',
        'API10:2023 - Unsafe Consumption of APIs'
      ]
    case 'mobile':
      return [
        'M1:2024 - Improper Credential Usage',
        'M2:2024 - Inadequate Supply Chain Security',
        'M3:2024 - Insecure Authentication/Authorization',
        'M4:2024 - Insufficient Input/Output Validation',
        'M5:2024 - Insecure Communication',
        'M6:2024 - Inadequate Privacy Controls',
        'M7:2024 - Insufficient Binary Protections',
        'M8:2024 - Security Misconfiguration',
        'M9:2024 - Insecure Data Storage',
        'M10:2024 - Insufficient Cryptography'
      ]
    case 'source-code':
      return [
        'OWASP ASVS - Architecture, authentication, session, access control, validation, cryptography, error handling, logging, API, and configuration controls',
        'CWE Top 25 - Common and impactful software weakness classes',
        'Input validation and output encoding weaknesses',
        'Authentication, authorisation, and session management logic flaws',
        'Cryptographic implementation and secrets-handling weaknesses',
        'Dependency, supply chain, and insecure component usage',
        'Error handling, logging, and security monitoring gaps',
        'Secure configuration and environment-specific assumptions'
      ]
    case 'internal':
      return [
        'CVE/CWE mapping and vulnerability validation',
        'CVSS severity scoring and technical risk prioritisation',
        'Patch status, unsupported software, and vulnerable service versions',
        'Weak configuration, insecure protocols, and unnecessary services',
        'Credential, privilege, and access-control exposure',
        'Network segmentation and lateral-movement exposure',
        'CIS Controls / CIS Benchmarks secure configuration alignment where applicable'
      ]
    case 'external':
      return [
        'CVE/CWE mapping and vulnerability validation',
        'CVSS severity scoring and external exposure prioritisation',
        'Internet-facing service exposure and perimeter configuration',
        'TLS/SSL, certificate, and weak encryption findings',
        'Unsupported software, missing patches, and exposed vulnerable services',
        'Unnecessary public exposure, information disclosure, and attack surface reduction',
        'CIS Controls / CIS Benchmarks secure configuration alignment where applicable'
      ]
    case 'internal-external':
      return [
        'CVE/CWE mapping and vulnerability validation',
        'CVSS severity scoring and risk prioritisation',
        'Internal network exposure, segmentation, and lateral-movement risk',
        'External attack surface, perimeter configuration, and internet-facing exposure',
        'Patch status, unsupported software, insecure services, and weak protocols',
        'Secure configuration alignment using CIS Controls / CIS Benchmarks where applicable'
      ]
    case 'host':
      return [
        'CVE/CWE mapping and vulnerability validation',
        'CVSS severity scoring and host-level risk prioritisation',
        'Operating system and installed software patch status',
        'Service exposure, insecure protocols, and unnecessary listening services',
        'Host hardening, account configuration, and privilege exposure',
        'CIS Benchmarks / secure configuration alignment where applicable'
      ]
    default:
      return [
        'CVE/CWE mapping and vulnerability validation where applicable',
        'CVSS severity scoring and remediation prioritisation',
        'Secure configuration and hardening review',
        'Authentication, authorisation, and access-control review',
        'Patch status, dependency, and vulnerable component review',
        'Evidence-based remediation guidance and closure tracking'
      ]
  }
}

function referenceRiskParagraphs(d: ReportData): Paragraph[] {
  return referenceRiskCategories(d).map((category) => numberedLine(category))
}

function assessmentDisplayName(d: ReportData): string {
  return [d.projectCode, applicationName(d)].filter(Boolean).join(' - ') || d.assessment?.name || d.request?.title || 'Security Assessment'
}

function executiveIntroductionParagraph(d: ReportData, findings: Finding[]): Paragraph {
  const open = findings.filter(isFindingOpen).length
  const assessment = d.assessment || d.request
  const assessmentLabel = assessmentDisplayName(d)
  const suffix = `${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issue(s) were identified, and ${open} finding(s) remain open. The report presents the agreed testing scope, validated security weaknesses, risk context, and practical recommendations to support remediation and management decision-making.`
  return new Paragraph({
    style: 'Normal',
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    children: assessment
      ? [
          new TextRun({ text: `This report covers ${findings.length} finding(s) from assessment "`, size: 24 }),
          new TextRun({ text: assessmentLabel, bold: true, size: 24 }),
          new TextRun({ text: `". ${suffix}`, size: 24 })
        ]
      : [new TextRun({ text: `This report covers ${findings.length} finding(s) across the assessed portfolio. ${suffix}`, size: 24 })]
  })
}

function isReportContextNoise(value: string): boolean {
  const text = value.toLowerCase()
  return text.startsWith('auto-created for adhoc') || text.includes('srs v6.2')
}

function backgroundContext(d: ReportData): string {
  const detail = [d.application?.description, d.request?.scope, d.assessment?.notes, d.request?.notes]
    .map((value) => displayValue(value).trim())
    .find((value) => value && !isReportContextNoise(value))
  return detail ? `The assessment context provided for this report is: ${detail}. ` : ''
}

function backgroundInformation(d: ReportData): string {
  const context = backgroundContext(d)
  switch (reportAssessmentKind(d)) {
    case 'web':
      return `${context}Web applications are commonly targeted through weaknesses in access control, authentication, session management, input validation, business logic, configuration, and third-party components. This assessment focuses on identifying web application weaknesses that could affect confidentiality, integrity, availability, or business operations.`
    case 'api':
      return `${context}APIs expose application functionality and data through structured interfaces that are frequently consumed by web, mobile, partner, and system integrations. This assessment focuses on API-specific risks such as broken object-level authorisation, weak authentication, excessive data exposure, injection, rate-limit gaps, insecure configuration, and insufficient logging or monitoring.`
    case 'mobile':
      return `${context}Mobile applications introduce security considerations across client-side storage, platform permissions, authentication flows, transport security, tamper resistance, backend communication, and session handling. This assessment focuses on weaknesses that may expose user data, weaken transaction integrity, or create unauthorised access paths through the mobile application or its supporting services.`
    case 'source-code':
      return `${context}Source code security review focuses on identifying weaknesses in implementation before or alongside runtime testing. The review considers insecure coding patterns, input handling, authentication and authorisation logic, cryptographic usage, secrets handling, error handling, dependency usage, and security control implementation that may introduce exploitable vulnerabilities.`
    case 'internal':
      return `${context}Internal vulnerability assessment evaluates assets that are reachable from within the organisation's network or trusted zones. The assessment focuses on weaknesses such as outdated software, missing patches, weak configuration, unnecessary services, insecure protocols, excessive exposure between network segments, and control gaps that could support lateral movement or privilege escalation.`
    case 'external':
      return `${context}External vulnerability assessment evaluates internet-facing or externally reachable assets from an attacker-facing perspective. The assessment focuses on exposed services, perimeter configuration, outdated software, weak encryption, unnecessary public exposure, and vulnerabilities that could be discovered or exploited without internal network access.`
    case 'internal-external':
      return `${context}Internal and external vulnerability assessment evaluates the security posture of in-scope infrastructure across both trusted network zones and externally reachable attack surfaces. The assessment focuses on identifying exposed weaknesses, configuration gaps, outdated software, insecure services, and prioritised remediation actions based on technical risk and business exposure.`
    case 'host':
      return `${context}Host vulnerability assessment evaluates the security posture of individual servers, endpoints, or network hosts. The assessment focuses on operating system and service vulnerabilities, patch status, insecure configuration, weak protocols, unnecessary services, local exposure, and host-level hardening gaps that may increase compromise or operational risk.`
    default:
      return `${context}This assessment evaluates the security posture of the in-scope application, system, hosts, endpoints, or supporting components. Where a specific testing category is not available, the background is treated as a general security assessment context focused on validated weaknesses, business risk, operational resilience, and remediation priorities.`
  }
}

function purposeOfTesting(d: ReportData): string {
  const statedPurpose = displayValue(d.request?.purpose).trim()
  const scope = displayValue(d.request?.scope).trim()
  const driver = statedPurpose ? `The stated business driver for this activity is ${statedPurpose}. ` : ''
  const scopeText = scope ? `Testing is performed within the agreed scope: ${scope}. ` : 'Testing is performed within the agreed in-scope application, system, host, endpoint, or supporting component boundaries. '
  const releaseContext = 'The testing supports new system onboarding, system updates, release readiness, change assurance, or continued operation by identifying security weaknesses before they can materially affect users, data, services, or business processes. '
  switch (reportAssessmentKind(d)) {
    case 'web':
      return `${driver}The purpose of this web application security testing is to evaluate the security posture of the in-scope web application and supporting components. ${scopeText}${releaseContext}Testing focuses on validating exposure to common web application risks such as access control flaws, authentication and session weaknesses, injection, insecure configuration, sensitive data exposure, business logic abuse, and vulnerable dependencies. The outcome provides evidence-based findings and practical remediation guidance for risk-based prioritisation.`
    case 'api':
      return `${driver}The purpose of this API security testing is to evaluate the security posture of the in-scope APIs, endpoints, data flows, and supporting services. ${scopeText}${releaseContext}Testing focuses on authorisation, authentication, object and function-level access control, input handling, rate limiting, sensitive data exposure, unsafe API consumption, and configuration weaknesses. The outcome helps teams reduce integration risk and strengthen API control coverage.`
    case 'mobile':
      return `${driver}The purpose of this mobile application security testing is to evaluate the in-scope mobile application, its platform interactions, local data handling, network communication, authentication flows, and backend integration points. ${scopeText}${releaseContext}Testing focuses on risks such as insecure storage, weak communication protection, insufficient authentication or authorisation, credential handling, input/output validation, privacy controls, binary protection, and backend service exposure.`
    case 'source-code':
      return `${driver}The purpose of this source code security review is to evaluate whether the in-scope codebase implements security controls correctly and avoids common insecure coding patterns. ${scopeText}${releaseContext}The review focuses on authentication and authorisation logic, input validation, output handling, cryptography, secrets management, dependency usage, error handling, logging, configuration assumptions, and security-relevant business logic before or alongside runtime testing.`
    case 'internal':
      return `${driver}The purpose of this internal vulnerability assessment is to evaluate the security posture of assets reachable from internal or trusted network zones. ${scopeText}${releaseContext}Testing focuses on missing patches, outdated services, insecure configuration, weak protocols, unnecessary services, credential or privilege exposure, segmentation weaknesses, and conditions that could support lateral movement or operational impact.`
    case 'external':
      return `${driver}The purpose of this external vulnerability assessment is to evaluate the security posture of internet-facing or externally reachable assets from an attacker-facing perspective. ${scopeText}${releaseContext}Testing focuses on exposed services, perimeter configuration, outdated software, weak encryption, unnecessary public exposure, information disclosure, and vulnerabilities that could be discovered or exploited without internal network access.`
    case 'internal-external':
      return `${driver}The purpose of this internal and external vulnerability assessment is to evaluate the security posture of in-scope assets across both trusted network zones and externally reachable attack surfaces. ${scopeText}${releaseContext}Testing focuses on patch status, exposed services, insecure protocols, weak configuration, perimeter exposure, segmentation risk, and prioritised remediation across internal and external perspectives.`
    case 'host':
      return `${driver}The purpose of this host vulnerability assessment is to evaluate the security posture of in-scope servers, endpoints, or network hosts. ${scopeText}${releaseContext}Testing focuses on operating system and software patch status, service exposure, insecure protocols, unnecessary listening services, host hardening, account configuration, privilege exposure, and host-level configuration weaknesses.`
    default:
      return `${driver}The purpose of this security testing is to evaluate the security posture of the in-scope application, system, hosts, endpoints, and supporting components. ${scopeText}${releaseContext}Testing is performed to identify vulnerabilities, validate likelihood and impact, provide evidence for remediation, and support risk-based prioritisation before production use, release, update, or continued operation.`
  }
}

function detailValue(value?: string | number): string {
  const text = displayValue(value).trim()
  return text || 'no value/details'
}

function shouldShowSlaDue(d: ReportData): boolean {
  return d.assessment?.timeframe === 'quarterly' || d.assessment?.timeframe === 'annual'
}

function detailSection(title: string, value?: string | number): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun({ text: `${title}:`, bold: true, size: 24 })], spacing: { before: 180, after: 60 } }),
    paragraph(detailValue(value), { spacing: { after: 180 } })
  ]
}

function cm(value: number): number {
  return Math.round(value * 567)
}

const SEVERITY_DOCX_COLORS: Record<Exclude<Severity, 'Info'>, { fill: string; font: string }> = {
  Critical: { fill: 'DC2626', font: 'FFFFFF' },
  High: { fill: 'D97706', font: 'FFFFFF' },
  Medium: { fill: 'FACC15', font: '111827' },
  Low: { fill: '16A34A', font: 'FFFFFF' }
}

function tableParagraph(children: TextRun[], alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]): Paragraph {
  return new Paragraph({ alignment, spacing: { before: 0, after: 0 }, children })
}

function tableCell(text: string | number, bold = false, options: Partial<ITableCellOptions> = {}): TableCell {
  return new TableCell({
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    verticalAlign: VerticalAlignTable.CENTER,
    ...options,
    children: [
      tableParagraph(
        [new TextRun({ text: displayValue(text), bold, size: 24, color: options.shading ? SEVERITY_DOCX_COLORS[text as Exclude<Severity, 'Info'>]?.font : undefined })],
        options.shading ? AlignmentType.CENTER : undefined
      )
    ]
  })
}

function centeredCell(text: string | number, bold = false, options: Partial<ITableCellOptions> = {}): TableCell {
  return new TableCell({
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    verticalAlign: VerticalAlignTable.CENTER,
    ...options,
    children: [tableParagraph([new TextRun({ text: displayValue(text), bold, size: 24 })], AlignmentType.CENTER)]
  })
}

function headerCell(text: string, options: Partial<ITableCellOptions> = {}): TableCell {
  return new TableCell({
    shading: { fill: '1F4E78' },
    ...options,
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [tableParagraph([new TextRun({ text, bold: true, color: 'FFFFFF', size: 24 })], AlignmentType.CENTER)]
  })
}

function severityCell(severity: Severity, options: Partial<ITableCellOptions> = {}): TableCell {
  if (severity === 'Info') return tableCell(severity, true, options)
  return tableCell(severity, true, { ...options, shading: { fill: SEVERITY_DOCX_COLORS[severity].fill } })
}

const DOCX_TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'C9D3DF' }
const DOCX_METADATA_TABLE_WIDTHS = [cm(4.6), cm(11.9)]
const DOCX_SUMMARY_TABLE_WIDTHS = [cm(4), cm(4.5), cm(4.5)]
const DOCX_TECHNICAL_TABLE_WIDTHS = [cm(2.8), cm(5.4), cm(2.8), cm(5.4)]

function docxTableBorders() {
  return {
    top: DOCX_TABLE_BORDER,
    bottom: DOCX_TABLE_BORDER,
    left: DOCX_TABLE_BORDER,
    right: DOCX_TABLE_BORDER,
    insideHorizontal: DOCX_TABLE_BORDER,
    insideVertical: DOCX_TABLE_BORDER
  }
}

function kvLabelCell(text: string): TableCell {
  return new TableCell({
    width: { size: DOCX_METADATA_TABLE_WIDTHS[0], type: WidthType.DXA },
    shading: { fill: 'EEF2F7' },
    margins: { top: 130, bottom: 130, left: 140, right: 140 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [
      tableParagraph([new TextRun({ text, bold: true, size: 24, color: '1F2937' })], AlignmentType.LEFT)
    ]
  })
}

function kvValueCell(text: string | number): TableCell {
  return new TableCell({
    width: { size: DOCX_METADATA_TABLE_WIDTHS[1], type: WidthType.DXA },
    margins: { top: 130, bottom: 130, left: 160, right: 160 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [tableParagraph([new TextRun({ text: displayValue(text) || '-', size: 24, color: '111827' })])]
  })
}

function kvTable(rows: [string, string | number][], width = 100, alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.CENTER): Table {
  const safeRows = rows.length > 0 ? rows : [['', ''] as [string, string]]
  return new Table({
    width: { size: width, type: WidthType.PERCENTAGE },
    alignment,
    layout: TableLayoutType.FIXED,
    columnWidths: DOCX_METADATA_TABLE_WIDTHS,
    borders: docxTableBorders(),
    rows: safeRows.map(
      ([k, v]) =>
        new TableRow({
          children: [kvLabelCell(k), kvValueCell(v)]
        })
    )
  })
}

function projectScopeTable(rows: [string, string | number][]): Table {
  return new Table({
    width: { size: cm(15), type: WidthType.DXA },
    alignment: AlignmentType.CENTER,
    layout: TableLayoutType.AUTOFIT,
    columnWidths: [cm(5), cm(10)],
    borders: docxTableBorders(),
    rows: rows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: cm(5), type: WidthType.DXA },
              shading: { fill: 'EEF2F7' },
              margins: { top: 130, bottom: 130, left: 140, right: 140 },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [tableParagraph([new TextRun({ text: k, bold: true, size: 24, color: '1F2937' })])]
            }),
            new TableCell({
              width: { size: cm(10), type: WidthType.DXA },
              margins: { top: 130, bottom: 130, left: 160, right: 160 },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [tableParagraph([new TextRun({ text: displayValue(v) || '-', size: 24, color: '111827' })])]
            })
          ]
        })
    )
  })
}

function summaryChart(d: ReportData, findings: Finding[]): Paragraph {
  const appName = applicationName(d) || 'Application'
  const rows = REPORT_SEVERITIES.map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length }))
  const max = Math.max(1, ...rows.map((row) => row.count))
  const chartWidth = 700
  const chartHeight = 260
  const barMaxWidth = 420
  const svgRows = rows
    .map((row, index) => {
      const y = 78 + index * 38
      const color = `#${SEVERITY_DOCX_COLORS[row.severity].fill}`
      const barWidth = Math.max(8, Math.round((row.count / max) * barMaxWidth))
      return `<text x="40" y="${y + 17}" font-family="Arial" font-size="16" fill="#111827">${row.severity}</text><rect x="145" y="${y}" width="${barWidth}" height="22" rx="3" fill="${color}"/><text x="${155 + barWidth}" y="${y + 17}" font-family="Arial" font-size="16" font-weight="700" fill="#111827">${row.count}</text>`
    })
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="40" y="42" font-family="Arial" font-size="20" font-weight="700" fill="#0F172A">${appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>${svgRows}</svg>`
  const fallback = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzE3WQAAAABJRU5ErkJggg==', 'base64')
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 180 },
    children: [
      new ImageRun({
        type: 'svg',
        data: Buffer.from(svg, 'utf-8'),
        fallback: { type: 'png', data: fallback },
        transformation: { width: 520, height: 193 },
        altText: { title: `Summary of Findings - ${appName}`, description: `Severity chart for ${appName}`, name: 'Summary of Findings Chart' }
      })
    ]
  })
}

function severitySummaryTable(d: ReportData, findings: Finding[]): Table {
  return new Table({
    width: { size: DOCX_SUMMARY_TABLE_WIDTHS.reduce((total, columnWidth) => total + columnWidth, 0), type: WidthType.DXA },
    alignment: AlignmentType.CENTER,
    layout: TableLayoutType.FIXED,
    columnWidths: DOCX_SUMMARY_TABLE_WIDTHS,
    borders: docxTableBorders(),
    rows: [
      new TableRow({
        children: [
          headerCell('Severity', { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[0], type: WidthType.DXA } }),
          headerCell('Number of Finding', { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[1], type: WidthType.DXA } }),
          headerCell('Status Finding', { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[2], type: WidthType.DXA } })
        ]
      }),
      ...REPORT_SEVERITIES.map((severity) => {
        const severityFindings = findings.filter((f) => f.severity === severity)
        return new TableRow({
          children: [
            severityCell(severity, { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[0], type: WidthType.DXA } }),
            centeredCell(severityFindings.length, false, { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[1], type: WidthType.DXA } }),
            centeredCell(`Open: ${severityFindings.filter(isFindingOpen).length} / Closed: ${severityFindings.filter((f) => !isFindingOpen(f)).length}`, false, { width: { size: DOCX_SUMMARY_TABLE_WIDTHS[2], type: WidthType.DXA } })
          ]
        })
      })
    ]
  })
}

function metaLabelCell(text: string): TableCell {
  return new TableCell({
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS[0], type: WidthType.DXA },
    shading: { fill: 'EEF2F7' },
    margins: { top: 130, bottom: 130, left: 140, right: 140 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [
      tableParagraph([new TextRun({ text, bold: true, size: 24, color: '1F2937' })], AlignmentType.LEFT)
    ]
  })
}

function metaValueCell(text: string | number): TableCell {
  return new TableCell({
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS[1], type: WidthType.DXA },
    margins: { top: 130, bottom: 130, left: 160, right: 160 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [tableParagraph([new TextRun({ text: detailValue(text), size: 24, color: '111827' })])]
  })
}
function metaValueWideCell(text: string | number): TableCell {
  return new TableCell({
    columnSpan: 3,
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS.slice(1).reduce((total, columnWidth) => total + columnWidth, 0), type: WidthType.DXA },
    margins: { top: 130, bottom: 130, left: 160, right: 160 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [tableParagraph([new TextRun({ text: detailValue(text), size: 24, color: '111827' })])]
  })
}


function findingSeverityHeaderCell(severity: Severity): TableCell {
  const color = severity === 'Info' ? { fill: '6B7280', font: 'FFFFFF' } : SEVERITY_DOCX_COLORS[severity]
  return new TableCell({
    columnSpan: 4,
    width: { size: DOCX_TECHNICAL_TABLE_WIDTHS.reduce((total, columnWidth) => total + columnWidth, 0), type: WidthType.DXA },
    shading: { fill: color.fill },
    margins: { top: 150, bottom: 150, left: 140, right: 140 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [
      tableParagraph([new TextRun({ text: severity, bold: true, color: color.font, size: 24 })], AlignmentType.LEFT)
    ]
  })
}

function findingTechnicalTable(d: ReportData, f: Finding): Table {
  const host = `${d.hostName(f.hostId)}${f.port ? ':' + f.port : ''}`
  const classification = firstIdentifiedLabel(f) ? `Existing - First Identified: ${firstIdentifiedLabel(f)}` : f.classification
  const slaDue = `${f.slaDueDate || ''}${isOverdue(f) ? ' (OVERDUE)' : ''}`
  const statusRow = shouldShowSlaDue(d)
    ? new TableRow({ children: [metaLabelCell('Status'), metaValueCell(f.status), metaLabelCell('SLA due'), metaValueCell(slaDue)] })
    : new TableRow({ children: [metaLabelCell('Status'), metaValueWideCell(f.status)] })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
    layout: TableLayoutType.FIXED,
    columnWidths: DOCX_TECHNICAL_TABLE_WIDTHS,
    borders: docxTableBorders(),
    rows: [
      new TableRow({ children: [findingSeverityHeaderCell(f.severity)] }),
      new TableRow({ children: [metaLabelCell('Host'), metaValueCell(host), metaLabelCell('Application'), metaValueCell(d.appName(f.applicationId))] }),
      new TableRow({ children: [metaLabelCell('CVSS'), metaValueCell(f.cvss || ''), metaLabelCell('CVE'), metaValueCell(f.cve || '')] }),
      new TableRow({ children: [metaLabelCell('Project Code'), metaValueCell(f.projectCode || d.projectCode || ''), metaLabelCell('Classification'), metaValueCell(classification)] }),
      statusRow
    ]
  })
}

function caption(text: string): Paragraph {
  return new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, italics: true, size: 24 })], spacing: { before: 100, after: 220 } })
}

function evidenceChildren(d: ReportData, f: Finding): (Paragraph | Table)[] {
  const evidenceText = detailValue(f.evidence)
  const hasEvidence = displayValue(f.evidence).trim().length > 0
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: 'Proof of Concept / Evidence', bold: true, size: 24 })], spacing: { before: 180, after: 80 } }),
    paragraph(evidenceText, { alignment: hasEvidence ? AlignmentType.JUSTIFIED : AlignmentType.LEFT })
  ]
  const attachments = f.attachments ?? []
  const attachmentRows: [string, string][] = []
  for (const att of attachments) {
    const absolute = d.attachmentPath(att)
    const ext = path.extname(att.filename).toLowerCase().replace('.', '')
    attachmentRows.push([att.filename, `${Math.round(att.size / 1024)} KB`])
    if (!['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext) || !fs.existsSync(absolute)) continue
    try {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: ext === 'jpeg' ? 'jpg' : (ext as 'png' | 'jpg' | 'gif' | 'bmp'),
              data: fs.readFileSync(absolute),
              transformation: { width: 500, height: 300 },
              altText: { title: att.filename, description: att.filename, name: att.filename }
            })
          ],
          spacing: { before: 120, after: 80 }
        })
      )
      children.push(caption(`Figure: ${att.filename}`))
    } catch {
      // Keep report generation resilient; attachment is still listed below.
    }
  }
  if (attachmentRows.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, text: 'Evidence Attachments' }))
    children.push(kvTable(attachmentRows, 76))
  }
  return children
}


function referenceStandardDetails(d: ReportData): [string, string][] {
  const common: [string, string][] = [
    ['CVSS', 'Used to support severity scoring and remediation prioritisation based on exploitability, impact, attack complexity, privileges required, user interaction, scope, and confidentiality/integrity/availability impact.'],
    ['CWE / CVE', 'Used where available to map findings to known weakness classes and publicly disclosed vulnerabilities, improving traceability and remediation clarity.'],
    ['Internal Security Policy / Remediation SLA', 'Used to align findings with organisational risk appetite, ownership, remediation target dates, and closure expectations.']
  ]
  switch (reportAssessmentKind(d)) {
    case 'web':
      return [
        ['OWASP Top 10:2025', 'Used as the primary application security risk reference for web application weaknesses such as access control, configuration, supply chain, cryptography, injection, design, authentication, integrity, logging, and exception-handling risks.'],
        ['OWASP ASVS', 'Used as a verification reference for web application security controls, including authentication, session management, access control, validation, cryptography, error handling, logging, API controls, and secure configuration where applicable.'],
        ...common
      ]
    case 'api':
      return [
        ['OWASP API Security Top 10 2023', 'Used as the primary API security risk reference for object-level authorisation, authentication, object property authorisation, resource consumption, function-level authorisation, sensitive business flows, SSRF, misconfiguration, inventory management, and unsafe API consumption.'],
        ['OWASP ASVS / API Controls', 'Used to guide API security control validation for authentication, authorisation, input validation, data protection, error handling, logging, and secure configuration where applicable.'],
        ...common
      ]
    case 'mobile':
      return [
        ['OWASP Mobile Top 10 2024', 'Used as the primary mobile risk reference for credential usage, supply chain security, authentication/authorisation, input/output validation, communication, privacy controls, binary protection, configuration, data storage, and cryptography.'],
        ['OWASP MASVS', 'Used as a mobile application security verification reference covering storage, cryptography, authentication, network communication, platform interaction, code quality, resilience, privacy, and supporting controls where applicable.'],
        ...common
      ]
    case 'source-code':
      return [
        ['OWASP ASVS / Secure Code Review', 'Used to guide secure implementation review across architecture, authentication, session management, access control, validation, cryptography, error handling, logging, API controls, and configuration.'],
        ['CWE Top 25', 'Used to support mapping of implementation weaknesses to common and impactful software weakness classes.'],
        ...common
      ]
    case 'internal':
    case 'external':
    case 'internal-external':
    case 'host':
      return [
        ['CIS Controls / CIS Benchmarks', 'Used where applicable as a secure configuration and hardening reference for enterprise assets, software, services, and host-level controls.'],
        ['Vulnerability Assessment References', 'Used to guide validation of patch status, vulnerable services, insecure protocols, unnecessary exposure, weak configuration, and remediation prioritisation across in-scope assets.'],
        ...common
      ]
    default:
      return [
        ['General Security Assessment References', 'Used when a specific application, API, mobile, source-code, infrastructure, or host risk category is not available. The report applies vulnerability validation, secure configuration, CVE/CWE mapping, CVSS scoring, and risk-based remediation guidance where applicable.'],
        ...common
      ]
  }
}

async function writeDocx(d: ReportData, outputPath: string): Promise<void> {
  const docFindings = reportFindings(d)
  const purposeText = purposeOfTesting(d)
  const referenceDetails = referenceStandardDetails(d)

  const findingBlocks = docFindings.flatMap((f, index) => [
    heading2(`3.${index + 1} ${f.title}`, `toc_finding_${index + 1}`),
    findingTechnicalTable(d, f),
    ...detailSection('Description', f.description),
    ...detailSection('Affected URL', f.affectedAsset || f.endpoint),
    ...detailSection('Affected Parameter', f.parameter),
    ...evidenceChildren(d, f),
    ...detailSection('Recommendation', f.recommendation)
  ])
  const logoParagraph = coverLogo()

  const doc = new Document({
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { size: 24 },
          paragraph: { spacing: { after: 120 } }
        },
        heading1: {
          run: { bold: true, size: 36 },
          paragraph: { spacing: { before: 340, after: 200 } }
        },
        heading2: {
          run: { bold: true, size: 28 },
          paragraph: { spacing: { before: 260, after: 160 } }
        }
      },
      paragraphStyles: [
        { id: 'TOC1', name: 'TOC 1', basedOn: 'Normal', run: { bold: true, size: 24 }, paragraph: { spacing: { after: 80 } } },
        { id: 'TOC2', name: 'TOC 2', basedOn: 'Normal', run: { size: 24 }, paragraph: { indent: { left: 360 }, spacing: { after: 60 } } },
        { id: 'TOC3', name: 'TOC 3', basedOn: 'Normal', run: { size: 24 }, paragraph: { indent: { left: 720 }, spacing: { after: 60 } } }
      ]
    },
    numbering: {
      config: [
        {
          reference: 'owasp-roman',
          levels: [
            {
              level: 0,
              format: LevelFormat.LOWER_ROMAN,
              text: '%1.',
              alignment: AlignmentType.RIGHT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 }, spacing: { after: 70 } },
                run: { size: 24 }
              }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, right: 900, bottom: 900, left: 900 } }, titlePage: true },
        footers: {
          first: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Prepared by: Threat Vulnerability Management, GISGD', bold: true, size: 24 })] })]
          }),
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Page ', size: 24 }), new TextRun({ children: [PageNumber.CURRENT], size: 24 })] })]
          })
        },
        children: [
          new Paragraph({ spacing: { before: 760 } }),
          ...(logoParagraph ? [logoParagraph] : []),
          coverTextParagraph(reportTitle(d), 48, true),
          blankLine(),
          ...coverSubjectParagraphs(d),
          blankLine(),
          coverTextParagraph(reportDate(d), 32),
          new Paragraph({ children: [new PageBreak()] }),

          heading1('Document Control', 'toc_document_control'),
          blankLine(),
          kvTable([
            ['Document Title', reportTitle(d)],
            ['Project Code', d.projectCode],
            ['Application / System', d.application?.name || d.request?.systemName || ''],
            ['Owner Name', d.application?.owner || ''],
            ['Business Unit / Department', d.application?.businessUnit || d.request?.department || ''],
            ['Requested By', d.request?.requestedBy || ''],
            ['Tester', d.assessment?.tester || ''],
            ['Assessment Type', assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? ''))],
            ['Assessment Window', [d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(' to ')],
            ['Report Date', reportDate(d)]
          ], 86, AlignmentType.CENTER),
          new Paragraph({ children: [new PageBreak()] }),

          tocTitle('Table of Contents'),
          tocField(docFindings),
          new Paragraph({ children: [new PageBreak()] }),

          heading1('1 Executive Summary', 'toc_executive_summary'),
          subsection('1.1 Introduction', 'toc_executive_introduction'),
          executiveIntroductionParagraph(d, docFindings),
          blankLine(),
          subsection('1.2 Background Information', 'toc_background_information'),
          paragraph(backgroundInformation(d)),
          paragraph(referenceRiskIntro(d)),
          ...referenceRiskParagraphs(d),
          blankLine(),
          subsection('1.3 Reference Standards', 'toc_reference_standards'),
          kvTable(referenceDetails, 100),
          blankLine(),
          subsection('1.4 Purpose of Testing', 'toc_purpose_of_testing'),
          paragraph(purposeText),
          new Paragraph({ children: [new PageBreak()] }),
          heading1('2 Summary of Technical Findings', 'toc_summary_technical_findings'),
          subsection('2.1 Introduction', 'toc_summary_introduction'),
          paragraph('Testing activities include review of in-scope assets, vulnerability identification, validation of exploitable conditions, evidence capture, severity assessment, and remediation guidance. Findings are prioritised using technical severity, affected asset criticality, exploitability, and business impact.'),
          blankLine(),
          subsection('2.2 Project Scope', 'toc_project_scope'),
          projectScopeTable([
            ['In-Scope Application / System', d.application?.name || d.request?.systemName || ''],
            ['Environment', d.request?.environment || ''],
            ['Scope Description', d.request?.scope || ''],
            ['Hosts / Assets', d.hosts.map((h) => h.hostname || h.ip).filter(Boolean).join(', ')]
          ]),
          blankLine(),
          subsection('2.3 Summary of Findings', 'toc_summary_findings'),
          summaryChart(d, docFindings),
          caption(`Figure 1: Findings Summary - ${applicationName(d) || 'Application'}`),
          blankLine(),
          severitySummaryTable(d, docFindings),
          caption('Table 1: Summary of Findings by Severity'),
          new Paragraph({ children: [new PageBreak()] }),
          heading1('3 Detailed Technical Findings', 'toc_detailed_technical_findings'),
          paragraph(docFindings.length > 0 ? 'This section provides detailed information about the security weaknesses identified during the exercise, including descriptions of findings, relevant observations or proof of concept, and recommendations to mitigate each issue.' : 'This section provides detailed information about the security weaknesses identified during the exercise. No findings were recorded for this report scope.'),
          ...(findingBlocks.length > 0 ? findingBlocks : [paragraph('No findings were recorded for this report scope.')])
        ]
      }
    ]
  })
  fs.writeFileSync(outputPath, await Packer.toBuffer(doc))
}

// ---------------------------------------------------------------- PDF

const SEV_COLORS: Record<Severity, string> = {
  Critical: '#dc2626',
  High: '#d97706',
  Medium: '#facc15',
  Low: '#16a34a',
  Info: '#6b7280'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function htmlText(value?: string | number): string {
  return esc(displayValue(value))
}

function htmlDetail(value?: string | number): string {
  return esc(detailValue(value)).replace(/\r?\n/g, '<br>')
}

function pdfLogoDataUri(): string {
  const candidates = [
    path.join(process.cwd(), 'image', 'bankislam-logo.png'),
    path.join(__dirname, '..', '..', 'image', 'bankislam-logo.png')
  ]
  const logoPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!logoPath) return ''
  return `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
}

function pdfDocumentControlRows(d: ReportData): [string, string | number][] {
  return [
    ['Document Title', reportTitle(d)],
    ['Project Code', d.projectCode],
    ['Application / System', d.application?.name || d.request?.systemName || ''],
    ['Owner Name', d.application?.owner || ''],
    ['Business Unit / Department', d.application?.businessUnit || d.request?.department || ''],
    ['Requested By', d.request?.requestedBy || ''],
    ['Tester', d.assessment?.tester || ''],
    ['Assessment Type', assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? ''))],
    ['Assessment Window', [d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(' to ')],
    ['Report Date', reportDate(d)]
  ]
}

function pdfProjectScopeRows(d: ReportData): [string, string | number][] {
  return [
    ['In-Scope Application / System', d.application?.name || d.request?.systemName || ''],
    ['Environment', d.request?.environment || ''],
    ['Scope Description', d.request?.scope || ''],
    ['Hosts / Assets', d.hosts.map((h) => h.hostname || h.ip).filter(Boolean).join(', ')]
  ]
}

function pdfKvTable(rows: [string, string | number][], className = 'kv-table'): string {
  return `<table class="${className}"><tbody>${rows
    .map(([label, value]) => `<tr><th>${htmlText(label)}</th><td>${htmlText(displayValue(value) || '-')}</td></tr>`)
    .join('')}</tbody></table>`
}

function pdfExecutiveIntroduction(d: ReportData, findings: Finding[]): string {
  const open = findings.filter(isFindingOpen).length
  const assessment = d.assessment || d.request
  const suffix = `${d.bySeverity.Critical} critical and ${d.bySeverity.High} high severity issue(s) were identified, and ${open} finding(s) remain open. The report presents the agreed testing scope, validated security weaknesses, risk context, and practical recommendations to support remediation and management decision-making.`
  if (!assessment) return `This report covers ${findings.length} finding(s) across the assessed portfolio. ${suffix}`
  return `This report covers ${findings.length} finding(s) from assessment "<strong>${htmlText(assessmentDisplayName(d))}</strong>". ${htmlText(suffix)}`
}

function pdfReferenceCategories(d: ReportData): string {
  return `<ol class="roman-list">${referenceRiskCategories(d).map((item) => `<li>${htmlText(item)}</li>`).join('')}</ol>`
}

function pdfReferenceStandards(d: ReportData): string {
  return `<table class="reference-table"><tbody>${referenceStandardDetails(d)
    .map(([standard, detail]) => `<tr><th>${htmlText(standard)}</th><td>${htmlText(detail)}</td></tr>`)
    .join('')}</tbody></table>`
}

function pdfSummaryChart(d: ReportData, findings: Finding[]): string {
  const rows = REPORT_SEVERITIES.map((severity) => ({ severity, count: findings.filter((f) => f.severity === severity).length }))
  const max = Math.max(1, ...rows.map((row) => row.count))
  return `<div class="chart" aria-label="Findings summary chart">
    <div class="chart-title">${htmlText(applicationName(d) || 'Application')}</div>
    ${rows
      .map((row) => {
        const width = Math.max(4, Math.round((row.count / max) * 100))
        return `<div class="bar-row"><div class="bar-label">${row.severity}</div><div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${SEV_COLORS[row.severity]}"></div></div><div class="bar-value">${row.count}</div></div>`
      })
      .join('')}
  </div>`
}

function pdfSeveritySummaryTable(findings: Finding[]): string {
  return `<table class="summary-table"><thead><tr><th>Severity</th><th>Number of Finding</th><th>Status Finding</th></tr></thead><tbody>${REPORT_SEVERITIES
    .map((severity) => {
      const severityFindings = findings.filter((f) => f.severity === severity)
      const open = severityFindings.filter(isFindingOpen).length
      const closed = severityFindings.filter((f) => !isFindingOpen(f)).length
      const color = SEV_COLORS[severity]
      const textColor = severity === 'Medium' ? '#111827' : '#ffffff'
      return `<tr><td class="severity-cell" style="background:${color};color:${textColor}">${severity}</td><td class="center-cell">${severityFindings.length}</td><td class="center-cell">Open: ${open} / Closed: ${closed}</td></tr>`
    })
    .join('')}</tbody></table>`
}

function pdfFindingMetaTable(d: ReportData, f: Finding): string {
  const host = `${d.hostName(f.hostId)}${f.port ? ':' + f.port : ''}`
  const classification = firstIdentifiedLabel(f) ? `Existing - First Identified: ${firstIdentifiedLabel(f)}` : f.classification
  const slaDue = `${f.slaDueDate || ''}${isOverdue(f) ? ' (OVERDUE)' : ''}`
  const statusRow = shouldShowSlaDue(d)
    ? `<tr><th>Status</th><td>${htmlDetail(f.status)}</td><th>SLA due</th><td>${htmlDetail(slaDue)}</td></tr>`
    : `<tr><th>Status</th><td colspan="3">${htmlDetail(f.status)}</td></tr>`
  return `<table class="technical-table"><tbody>
    <tr><th colspan="4" class="technical-severity" style="background:${SEV_COLORS[f.severity]};color:${f.severity === 'Medium' ? '#111827' : '#ffffff'}">${htmlText(f.severity)}</th></tr>
    <tr><th>Host</th><td>${htmlDetail(host)}</td><th>Application</th><td>${htmlDetail(d.appName(f.applicationId))}</td></tr>
    <tr><th>CVSS</th><td>${htmlDetail(f.cvss || '')}</td><th>CVE</th><td>${htmlDetail(f.cve || '')}</td></tr>
    <tr><th>Project Code</th><td>${htmlDetail(f.projectCode || d.projectCode || '')}</td><th>Classification</th><td>${htmlDetail(classification)}</td></tr>
    ${statusRow}
  </tbody></table>`
}

function pdfAttachmentDataUri(d: ReportData, att: EvidenceAttachment): string {
  const absolute = d.attachmentPath(att)
  const ext = path.extname(att.filename).toLowerCase().replace('.', '')
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'png' ? 'image/png' : ''
  if (!mime || !fs.existsSync(absolute)) return ''
  try {
    return `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`
  } catch {
    return ''
  }
}

function pdfEvidenceHtml(d: ReportData, f: Finding): string {
  const attachments = f.attachments ?? []
  const images = attachments
    .map((att) => ({ att, uri: pdfAttachmentDataUri(d, att) }))
    .filter((item) => item.uri)
    .map((item) => `<figure class="evidence-image"><img src="${item.uri}" alt="${htmlText(item.att.filename)}"><figcaption>${htmlText(item.att.filename)}</figcaption></figure>`)
    .join('')
  const attachmentTable = attachments.length
    ? `<table class="attachment-table"><thead><tr><th>Attachment</th><th>Size</th></tr></thead><tbody>${attachments
        .map((att) => `<tr><td>${htmlText(att.filename)}</td><td>${Math.round(att.size / 1024)} KB</td></tr>`)
        .join('')}</tbody></table>`
    : ''
  return `<div class="detail-block"><h4>Proof of Concept / Evidence:</h4><p>${htmlDetail(f.evidence)}</p>${images}${attachmentTable}</div>`
}

function pdfFindingDetails(d: ReportData, f: Finding, index: number): string {
  return `<section class="finding-section">
    <h2 id="pdf_finding_${index + 1}">3.${index + 1} ${htmlText(f.title)}</h2>
    ${pdfFindingMetaTable(d, f)}
    <div class="detail-block"><h4>Description:</h4><p>${htmlDetail(f.description)}</p></div>
    <div class="detail-block"><h4>Affected URL:</h4><p>${htmlDetail(f.affectedAsset || f.endpoint)}</p></div>
    <div class="detail-block"><h4>Affected Parameter:</h4><p>${htmlDetail(f.parameter)}</p></div>
    ${pdfEvidenceHtml(d, f)}
    <div class="detail-block"><h4>Recommendation:</h4><p>${htmlDetail(f.recommendation)}</p></div>
  </section>`
}


function businessValue(value?: string | number): string {
  const text = displayValue(value).trim()
  return text || 'no info'
}

function highestSeverity(findings: Finding[]): Exclude<Severity, 'Info'> | 'Satisfactory' {
  const openFindings = findings.filter(isFindingOpen)
  const source = openFindings.length > 0 ? openFindings : findings
  for (const severity of REPORT_SEVERITIES) {
    if (source.some((finding) => finding.severity === severity)) return severity
  }
  return 'Satisfactory'
}

function overallRisk(d: ReportData, findings: Finding[]): { rating: Exclude<Severity, 'Info'> | 'Satisfactory'; reason: string } {
  const rating = highestSeverity(findings)
  const open = findings.filter(isFindingOpen)
  if (rating === 'Satisfactory') return { rating, reason: 'No reportable security findings were recorded for the assessed scope.' }
  const count = open.filter((finding) => finding.severity === rating).length || findings.filter((finding) => finding.severity === rating).length
  const statusText = open.length > 0 ? `${open.length} finding(s) remain open` : 'all recorded findings are remediated or closed'
  return { rating, reason: `${count} ${rating.toLowerCase()} severity finding(s) drive the rating, and ${statusText}.` }
}

function businessImpactText(f: Finding): string {
  switch (f.severity) {
    case 'Critical':
      return 'This issue could create a material business impact, including unauthorised access, data exposure, service disruption, or compromise of critical functions.'
    case 'High':
      return 'This issue could expose sensitive data, weaken key controls, or allow a meaningful security compromise if exploited.'
    case 'Medium':
      return 'This issue may increase security risk and could support further attack steps when combined with other weaknesses.'
    case 'Low':
      return 'This issue has limited direct business impact but should be corrected to improve control maturity and reduce avoidable exposure.'
    default:
      return 'This item is informational and should be reviewed for awareness or improvement planning.'
  }
}

function executiveRecommendation(d: ReportData, findings: Finding[]): string {
  const rating = overallRisk(d, findings).rating
  const openCritical = findings.some((finding) => finding.severity === 'Critical' && isFindingOpen(finding))
  const openHigh = findings.some((finding) => finding.severity === 'High' && isFindingOpen(finding))
  if (openCritical) return 'Not recommended for production until critical findings are remediated, retested, and formally accepted by the responsible risk owner.'
  if (openHigh) return 'Can proceed only after high-priority remediation is completed or formally risk accepted, followed by targeted retesting.'
  if (findings.some(isFindingOpen)) return 'Can proceed after planned remediation of remaining findings, with risk owner agreement on any accepted residual risk.'
  if (rating === 'Satisfactory') return 'Can proceed to production from a security assessment perspective, subject to normal operational approvals.'
  return 'Can proceed after remediation has been confirmed and any remaining residual risk has been accepted.'
}

function executiveOverviewRows(d: ReportData): [string, string | number][] {
  return [
    ['Application / System', businessValue(applicationName(d) || d.request?.systemName)],
    ['Assessment Type', businessValue(assessmentTypeLabel(d.assessment?.type || d.request?.assessmentType, d.assessment?.category || String(d.request?.source?.typeOfSystem ?? '')))],
    ['Testing Period', businessValue([d.assessment?.startDate, d.assessment?.endDate].filter(Boolean).join(' to '))],
    ['Environment', businessValue(d.request?.environment)],
    ['Scope', businessValue(d.request?.scope)],
    ['Limitations', 'no info']
  ]
}

function executiveFindingsSummaryTable(findings: Finding[]): string {
  return `<table class="summary-table executive-summary-table"><thead><tr><th>Severity</th><th>Total</th><th>Open</th><th>Remediated</th></tr></thead><tbody>${REPORT_SEVERITIES
    .map((severity) => {
      const severityFindings = findings.filter((finding) => finding.severity === severity)
      const open = severityFindings.filter(isFindingOpen).length
      const remediated = severityFindings.length - open
      const color = SEV_COLORS[severity]
      const textColor = severity === 'Medium' ? '#111827' : '#ffffff'
      return `<tr><td class="severity-cell" style="background:${color};color:${textColor}">${severity}</td><td class="center-cell">${severityFindings.length}</td><td class="center-cell">${open}</td><td class="center-cell">${remediated}</td></tr>`
    })
    .join('')}</tbody></table>`
}

function executiveKeyRisks(d: ReportData, findings: Finding[]): string {
  const keyFindings = [...findings]
    .sort((a, b) => {
      const openDelta = Number(isFindingOpen(b)) - Number(isFindingOpen(a))
      return openDelta || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    })
    .slice(0, 5)
  if (keyFindings.length === 0) return '<p>No key business risks were identified from the available findings.</p>'
  return keyFindings
    .map((finding, index) => `<div class="key-risk"><h2 id="pdf_key_risk_${index + 1}" class="key-risk-heading">5.${index + 1} ${htmlText(finding.title)}</h2><table class="kv-table"><tbody>
      <tr><th>Issue</th><td>${htmlDetail(finding.description || finding.title)}</td></tr>
      <tr><th>Business Impact</th><td>${htmlText(businessImpactText(finding))}</td></tr>
      <tr><th>Current Status</th><td>${htmlText(finding.status || 'no info')}</td></tr>
      <tr><th>Action Required</th><td>${htmlDetail(finding.recommendation || 'Remediate the issue, validate the fix, and update the finding status.')}</td></tr>
    </tbody></table></div>`)
    .join('')
}

function executiveRemediationPriority(d: ReportData, findings: Finding[]): string {
  const open = findings.filter(isFindingOpen)
  if (open.length === 0) return 'No open remediation actions are recorded. The application or system owner should maintain normal security monitoring and evidence retention.'
  const firstSeverity = highestSeverity(open)
  const owner = businessValue(d.application?.owner || d.application?.businessUnit || d.request?.department)
  const firstTarget = open
    .filter((finding) => firstSeverity === 'Satisfactory' || finding.severity === firstSeverity)
    .map((finding) => finding.slaDueDate)
    .filter(Boolean)
    .sort()[0]
  return `Fix ${String(firstSeverity).toLowerCase()} severity open findings first, followed by high, medium, and low items. The responsible owner is ${owner}. Expected completion target is ${firstTarget || 'to be confirmed'}.`
}

function executiveRetestStatus(findings: Finding[]): string {
  const retestFindings = findings.filter((finding) => finding.classification === 'Retest')
  const open = findings.filter(isFindingOpen)
  if (retestFindings.length === 0) return `No retest result is recorded in the available report data. ${open.length} finding(s) remain open.`
  return `${retestFindings.length} finding(s) are marked for retest. ${open.length} finding(s) remain open and require closure evidence or formal risk acceptance.`
}

function executiveScopeLimitations(d: ReportData): string {
  const included = businessValue(d.request?.scope || d.hosts.map((host) => host.hostname || host.ip).filter(Boolean).join(', '))
  const unavailable = 'no info'
  return `Included scope: ${included}. Excluded, unavailable, or not-tested items: ${unavailable}.`
}

function executiveReportBody(d: ReportData, findings: Finding[]): string {
  const risk = overallRisk(d, findings)
  const open = findings.filter(isFindingOpen).length
  return `<section class="executive-report">
      <h1 id="pdf_executive_summary">1 Executive Summary</h1>
      <p>This executive report summarises the security assessment for ${htmlText(businessValue(applicationName(d)))}. Testing covered the agreed scope and recorded ${findings.length} reportable finding(s), with ${open} currently open. The overall result is ${risk.rating}. Action is ${open > 0 ? 'required to address the remaining findings and reduce business risk.' : 'not currently required beyond normal monitoring and governance.'}</p>
      <p>The main risk is driven by ${htmlText(risk.reason)} Management should ensure that remediation owners, target dates, and retest evidence are tracked until closure.</p>

      <h1 id="pdf_assessment_overview">2 Assessment Overview</h1>
      ${pdfKvTable(executiveOverviewRows(d), 'scope-table')}

      <h1 id="pdf_overall_risk_rating">3 Overall Risk Rating</h1>
      <table class="risk-rating-table"><tbody><tr><th>Overall Rating</th><td class="risk-rating risk-${risk.rating.toLowerCase()}">${risk.rating}</td></tr><tr><th>Reason</th><td>${htmlText(risk.reason)}</td></tr></tbody></table>

      <h1 id="pdf_findings_summary">4 Findings Summary</h1>
      ${executiveFindingsSummaryTable(findings)}
      ${pdfSummaryChart(d, findings)}
      <p class="caption">Figure 1: Findings Summary - ${htmlText(applicationName(d) || 'Application')}</p>

      <h1 id="pdf_key_risks">5 Key Risks</h1>
      ${executiveKeyRisks(d, findings)}

      <h1 id="pdf_remediation_priority">6 Remediation Priority</h1>
      <p>${htmlText(executiveRemediationPriority(d, findings))}</p>

      <h1 id="pdf_retest_status">7 Retest Status</h1>
      <p>${htmlText(executiveRetestStatus(findings))}</p>

      <h1 id="pdf_conclusion">8 Conclusion</h1>
      <p>${htmlText(executiveRecommendation(d, findings))}</p>

      <h1 id="pdf_scope_limitations">9 Scope and Limitations</h1>
      <p>${htmlText(executiveScopeLimitations(d))}</p>
    </section>`
}

function pdfTocRows(variant: 'executive' | 'full', findings: Finding[]): { title: string; page: string; level: 1 | 2; href: string }[] {
  if (variant === 'executive') {
    return [
      { title: 'Document Control', page: '2', level: 1, href: 'pdf_document_control' },
      { title: '1 Executive Summary', page: '4', level: 1, href: 'pdf_executive_summary' },
      { title: '2 Assessment Overview', page: '4', level: 1, href: 'pdf_assessment_overview' },
      { title: '3 Overall Risk Rating', page: '4', level: 1, href: 'pdf_overall_risk_rating' },
      { title: '4 Findings Summary', page: '4', level: 1, href: 'pdf_findings_summary' },
      { title: '5 Key Risks', page: '5', level: 1, href: 'pdf_key_risks' },
      ...findings.slice(0, 5).map((finding, index) => ({ title: `5.${index + 1} ${finding.title}`, page: '5', level: 2 as const, href: `pdf_key_risk_${index + 1}` })),
      { title: '6 Remediation Priority', page: '5', level: 1, href: 'pdf_remediation_priority' },
      { title: '7 Retest Status', page: '5', level: 1, href: 'pdf_retest_status' },
      { title: '8 Conclusion', page: '5', level: 1, href: 'pdf_conclusion' },
      { title: '9 Scope and Limitations', page: '5', level: 1, href: 'pdf_scope_limitations' }
    ]
  }
  const rows: { title: string; page: string; level: 1 | 2; href: string }[] = [
    { title: 'Document Control', page: '2', level: 1, href: 'pdf_document_control' },
    { title: '1 Executive Summary', page: '4', level: 1, href: 'pdf_executive_summary' },
    { title: '1.1 Introduction', page: '4', level: 2, href: 'pdf_executive_introduction' },
    { title: '1.2 Background Information', page: '4', level: 2, href: 'pdf_background_information' },
    { title: '1.3 Reference Standards', page: '4', level: 2, href: 'pdf_reference_standards' },
    { title: '1.4 Purpose of Testing', page: '4', level: 2, href: 'pdf_purpose_of_testing' },
    { title: '2 Summary of Technical Findings', page: '5', level: 1, href: 'pdf_summary_technical_findings' },
    { title: '2.1 Introduction', page: '5', level: 2, href: 'pdf_summary_introduction' },
    { title: '2.2 Project Scope', page: '5', level: 2, href: 'pdf_project_scope' },
    { title: '2.3 Summary of Findings', page: '5', level: 2, href: 'pdf_summary_findings' },
    { title: '3 Detailed Technical Findings', page: '6', level: 1, href: 'pdf_detailed_technical_findings' },
    ...findings.map((finding, index) => ({ title: `3.${index + 1} ${finding.title}`, page: '6', level: 2 as const, href: `pdf_finding_${index + 1}` }))
  ]
  return rows
}


function pdfTableOfContents(variant: 'executive' | 'full', findings: Finding[]): string {
  return `<section class="page toc-page"><h1 class="toc-title">Table of Contents</h1><table class="toc-table"><tbody>${pdfTocRows(variant, findings)
    .map((entry) => `<tr class="toc-level-${entry.level}"><td><a href="#${entry.href}">${htmlText(entry.title)}</a></td><td><a href="#${entry.href}">${entry.page}</a></td></tr>`)
    .join('')}</tbody></table></section>`
}


function reportHtml(d: ReportData, variant: 'executive' | 'full'): string {
  const findings = reportFindings(d)
  const logo = pdfLogoDataUri()
  const coverLines = d.projectCode ? [d.projectCode, applicationName(d)].filter(Boolean) : [applicationName(d) || detailValue('')]
  const findingDetails = findings.map((finding, index) => pdfFindingDetails(d, finding, index)).join('')
  const technicalSection = variant === 'full'
    ? `<section class="page technical-start"><h1 id="pdf_detailed_technical_findings">3 Detailed Technical Findings</h1><p>${findings.length > 0 ? 'This section provides detailed information about the security weaknesses identified during the exercise, including descriptions of findings, relevant observations or proof of concept, and recommendations to mitigate each issue.' : 'This section provides detailed information about the security weaknesses identified during the exercise. No findings were recorded for this report scope.'}</p>${findingDetails || '<p>No findings were recorded for this report scope.</p>'}</section>`
    : ''
  const fullReportBody = `<section>
      <h1 id="pdf_executive_summary">1 Executive Summary</h1>
      <h2 id="pdf_executive_introduction">1.1 Introduction</h2>
      <p>${pdfExecutiveIntroduction(d, findings)}</p>
      <div class="section-gap"></div>
      <h2 id="pdf_background_information">1.2 Background Information</h2>
      <p>${htmlText(backgroundInformation(d))}</p>
      <p>${htmlText(referenceRiskIntro(d))}</p>
      ${pdfReferenceCategories(d)}
      <div class="section-gap"></div>
      <h2 id="pdf_reference_standards">1.3 Reference Standards</h2>
      ${pdfReferenceStandards(d)}
      <div class="section-gap"></div>
      <h2 id="pdf_purpose_of_testing">1.4 Purpose of Testing</h2>
      <p>${htmlText(purposeOfTesting(d))}</p>
    </section>

    <section class="summary-start">
      <h1 id="pdf_summary_technical_findings">2 Summary of Technical Findings</h1>
      <h2 id="pdf_summary_introduction">2.1 Introduction</h2>
      <p>Testing activities include review of in-scope assets, vulnerability identification, validation of exploitable conditions, evidence capture, severity assessment, and remediation guidance. Findings are prioritised using technical severity, affected asset criticality, exploitability, and business impact.</p>
      <div class="section-gap"></div>
      <h2 id="pdf_project_scope">2.2 Project Scope</h2>
      ${pdfKvTable(pdfProjectScopeRows(d), 'scope-table')}
      <div class="section-gap"></div>
      <h2 id="pdf_summary_findings">2.3 Summary of Findings</h2>
      ${pdfSummaryChart(d, findings)}
      <p class="caption">Figure 1: Findings Summary - ${htmlText(applicationName(d) || 'Application')}</p>
      ${pdfSeveritySummaryTable(findings)}
      <p class="caption">Table 1: Summary of Findings by Severity</p>
    </section>`
  const reportBody = variant === 'executive' ? executiveReportBody(d, findings) : fullReportBody

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:22mm 18mm 18mm 18mm;@bottom-right{content:'Page ' counter(page);font-family:Arial,sans-serif;font-size:9pt;color:#4b5563}}
    *{box-sizing:border-box} body{font-family:Arial,'Segoe UI',sans-serif;color:#111827;margin:0;font-size:12pt;line-height:1.42;background:#fff} p{margin:0 0 10px;text-align:justify} h1{font-size:18pt;line-height:1.25;margin:0 0 14px;font-weight:700;color:#0f172a;page-break-after:avoid} h2{font-size:14pt;line-height:1.28;margin:22px 0 10px;font-weight:700;color:#0f172a;page-break-after:avoid} h4{font-size:12pt;margin:0 0 6px;font-weight:700;color:#111827}.page{page-break-after:always}.page:last-child{page-break-after:auto}.cover{min-height:250mm;display:flex;flex-direction:column;text-align:center;page-break-after:always}.cover-main{margin-top:20mm}.logo{width:18cm;max-width:100%;height:auto;margin:0 auto 18px;display:block}.cover-title{font-size:24pt;font-weight:700;line-height:1.5;margin:0 0 30px}.cover-subject{font-size:22pt;font-weight:700;line-height:1.5;margin:0 0 6px}.cover-date{font-size:16pt;line-height:1.5;margin-top:12px}.prepared{margin-top:auto;text-align:center;font-weight:700}.doc-control{width:86%;margin:12px auto 0}.kv-table,.reference-table,.scope-table,.summary-table,.technical-table,.attachment-table{border-collapse:collapse;margin:8px auto 14px;color:#111827}.kv-table th,.kv-table td,.reference-table th,.reference-table td,.scope-table th,.scope-table td,.summary-table th,.summary-table td,.technical-table th,.technical-table td,.attachment-table th,.attachment-table td{border:1px solid #c9d3df;padding:7px 9px;vertical-align:top;word-break:break-word}.kv-table th,.reference-table th,.scope-table th,.technical-table th{background:#eef2f7;color:#1f2937;text-align:left;font-weight:700}.kv-table td,.reference-table td,.scope-table td,.technical-table td{text-align:left}.reference-table,.scope-table{width:86%}.reference-table th{width:28%}.scope-table th{width:34%}.summary-table{width:74%;table-layout:fixed}.summary-table th{background:#1f4e78;color:#fff;text-align:center;font-weight:700}.summary-table td{text-align:left}.summary-table th:nth-child(2),.summary-table th:nth-child(3),.summary-table td:nth-child(2),.summary-table td:nth-child(3){width:4.5cm}.center-cell{text-align:center!important}.severity-cell{text-align:center!important;font-weight:700}.technical-table{width:100%;table-layout:fixed}.technical-table th{width:17%}.technical-table td{width:33%}.technical-severity{text-align:left!important;font-weight:700}.toc-title{font-size:20pt}.toc-table{width:100%;border-collapse:collapse;margin-top:12px}.toc-table td{border:0;padding:5px 0;font-size:12pt}.toc-table td:last-child{text-align:right;width:1.5cm}.toc-table a{color:#111827;text-decoration:none}.toc-level-1 td{font-weight:700;padding-top:9px}.toc-level-2 td:first-child{padding-left:18px;color:#374151}.roman-list{list-style-type:lower-roman;padding-left:32px;margin:8px 0 16px}.roman-list li{margin:0 0 5px;text-align:justify}.chart{width:74%;margin:0 auto 8px;border:1px solid #c9d3df;padding:14px 18px;background:#fff}.chart-title{text-align:center;font-weight:700;margin-bottom:12px}.bar-row{display:grid;grid-template-columns:90px 1fr 40px;gap:10px;align-items:center;margin:9px 0}.bar-label{font-weight:700}.bar-track{height:18px;background:#eef2f7;border-radius:3px;overflow:hidden}.bar-fill{height:18px}.bar-value{text-align:right;font-weight:700}.caption{text-align:center!important;font-style:italic;margin:4px 0 16px;color:#374151}.summary-start{page-break-before:always}.technical-start{page-break-before:always}.finding-section{margin-top:18px;page-break-inside:auto}.detail-block{margin:13px 0}.detail-block p{text-align:justify;white-space:normal}.evidence-image{margin:10px auto 12px;text-align:center;page-break-inside:avoid}.evidence-image img{max-width:100%;max-height:130mm;border:1px solid #c9d3df}.evidence-image figcaption{font-style:italic;color:#374151;margin-top:4px}.attachment-table{width:76%}.attachment-table th{background:#1f4e78;color:#fff;text-align:center}.muted{color:#6b7280}.section-gap{height:10px}.executive-report h1{margin-top:30px}.executive-report h1:first-child{margin-top:0}.key-risk{page-break-inside:avoid;margin:12px 0 18px}.key-risk-heading{font-size:14pt!important;margin:20px 0 8px!important;color:#0f172a}.risk-rating-table{width:74%;border-collapse:collapse;margin:8px auto 14px}.risk-rating-table th,.risk-rating-table td{border:1px solid #c9d3df;padding:8px 10px}.risk-rating-table th{width:34%;background:#eef2f7;text-align:left}.risk-rating{font-weight:700;text-align:center}.risk-critical{background:#dc2626;color:#fff}.risk-high{background:#d97706;color:#fff}.risk-medium{background:#facc15;color:#111827}.risk-low{background:#16a34a;color:#fff}.risk-satisfactory{background:#0f766e;color:#fff}.executive-summary-table th:nth-child(2),.executive-summary-table th:nth-child(3),.executive-summary-table td:nth-child(2),.executive-summary-table td:nth-child(3){width:auto}
  </style></head><body>
    <section class="cover">
      <div class="cover-main">
        ${logo ? `<img class="logo" src="${logo}" alt="Bank Islam Logo">` : ''}
        <div class="cover-title">${htmlText(variant === 'executive' ? executiveReportTitle(d) : reportTitle(d))}</div>
        ${coverLines.map((line) => `<div class="cover-subject">${htmlText(line)}</div>`).join('')}
        <div class="cover-date">${htmlText(reportDate(d))}</div>
      </div>
      <div class="prepared">Prepared by: Threat Vulnerability Management, GISGD</div>
    </section>

    <section class="page" id="pdf_document_control">
      <h1>Document Control</h1>
      <div class="section-gap"></div>
      <div class="doc-control">${pdfKvTable(pdfDocumentControlRows(d))}</div>
    </section>

    ${pdfTableOfContents(variant, findings)}

    ${reportBody}

    ${technicalSection}
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
