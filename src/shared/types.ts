export type RequestStatus =
  | 'New'
  | 'Pending Approval'
  | 'Approved'
  | 'Scheduled'
  | 'In Progress'
  | 'Reporting'
  | 'Delivered'
  | 'Closed'

export type AssessmentType = 'Web' | 'API' | 'Mobile' | 'Internal VA' | 'External VA' | 'Host VA' | 'Retest'
export type AssessmentCategory = 'web' | 'internal-external' | 'host'
export type Timeframe = 'annual' | 'quarterly' | 'adhoc'
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info'
export type Priority = 'Critical' | 'High' | 'Medium' | 'Low'
export type Environment = 'Production' | 'UAT' | 'Development' | 'Test' | 'Staging' | 'Unknown' | 'DR'
export type Exposure = 'internal' | 'external'
export type FindingStatus = 'Open' | 'In Remediation' | 'Resolved' | 'Risk Accepted' | 'Closed'
export type FindingClassification = 'New' | 'Existing' | 'Retest' | 'Regression' | 'Context Change'
export type InventoryStatus = 'Pending' | 'In Progress' | 'Completed'
export type AssessmentStatus = 'Planned' | 'In Progress' | 'Completed' | 'Cancelled'

export interface BaseEntity {
  id: string
  createdAt: string
  updatedAt: string
}

export interface VaptRequest extends BaseEntity {
  /** Primary identifier: VAPT-YYYYMMDD-HHMMSS (auto-generated or parsed from "[code] title"). */
  projectCode: string
  title: string
  applicationId: string
  scope: string
  environment: Environment
  assessmentType: AssessmentType
  priority: Priority
  status: RequestStatus
  targetDate: string
  requestedBy: string
  requesterEmail: string
  department: string
  systemName: string
  targetUatDate: string
  goLiveDate: string
  purpose: string
  notes: string
}

export interface Application extends BaseEntity {
  name: string
  businessUnit: string
  owner: string
  techStack: string
  criticality: Priority
  riskRating: Severity | 'Unrated'
  description: string
}

export interface Host extends BaseEntity {
  ip: string
  hostname: string
  environment: Environment
  exposure: Exposure
  applicationId: string
  os: string
  /** Inventory tracking status (SRS v5 §3). */
  status: InventoryStatus
  notes: string
  /** Nessus file this host came from; '' = manually created. Hosts are never merged across imports (FR-H3). */
  sourceFile: string
}

export interface Assessment extends BaseEntity {
  name: string
  requestId: string
  applicationId: string
  type: AssessmentType
  /** Module the assessment belongs to (FR-A1..A3); derived from type when absent. */
  category: AssessmentCategory
  /** Storage/reporting timeframe bucket (FR-F2). */
  timeframe: Timeframe
  status: AssessmentStatus
  startDate: string
  endDate: string
  hostIds: string[]
  tester: string
  /** For type 'Retest': the assessment being retested */
  baselineAssessmentId: string
  notes: string
}

export interface EvidenceAttachment {
  id: string
  filename: string
  /** Path relative to the data folder, e.g. evidence/<findingId>/<file>. */
  path: string
  size: number
  addedAt: string
}

export const EVIDENCE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'txt', 'zip'] as const

export interface Finding extends BaseEntity {
  title: string
  assessmentId: string
  applicationId: string
  hostId: string
  /** Web findings: free-text asset (URL, endpoint, API route, cookie, parameter). */
  affectedAsset: string
  severity: Severity
  cvss: number
  cve: string
  cwe: string
  owasp: string
  pluginId: string
  endpoint: string
  port: string
  parameter: string
  description: string
  evidence: string
  attachments: EvidenceAttachment[]
  recommendation: string
  status: FindingStatus
  classification: FindingClassification
  fingerprint: string
  /** Project Code the finding is traced to (SRS v5 §4) — mandatory for adhoc web findings. */
  projectCode: string
  /** Finding lifecycle (SRS v5 §5) — set when classification is 'Existing'. */
  firstIdentifiedAssessmentType: string
  firstIdentifiedPeriod: string
  firstIdentifiedProjectCode: string
  firstIdentifiedDate: string
  discoveredDate: string
  slaDueDate: string
  closedDate: string
}

export interface KbTemplate extends BaseEntity {
  title: string
  severity: Severity
  description: string
  risk: string
  recommendation: string
  cve: string
  cwe: string
  owasp: string
}

export interface AppNotification extends BaseEntity {
  kind: 'sla-breach' | 'upcoming-assessment' | 'retest-due'
  message: string
  entityId: string
  read: boolean
}

export interface CollectionMap {
  requests: VaptRequest
  applications: Application
  hosts: Host
  assessments: Assessment
  findings: Finding
  kb: KbTemplate
  notifications: AppNotification
}

export type CollectionName = keyof CollectionMap

export type ScannerType = 'Nessus' | 'Tenable.io'

export interface ScannerConnection {
  id: string
  name: string
  type: ScannerType
  url: string
  accessKey: string
  secretKey: string
  isDefault: boolean
}

/** Appearance modes (SRS v6 §3.1): explicit theme or follow the OS. */
export type Appearance = 'light' | 'dark' | 'system'
export const APPEARANCES: Appearance[] = ['light', 'dark', 'system']

export interface Settings {
  dataDir: string
  reportsDir: string
  scanners: ScannerConnection[]
  appearance: Appearance
  /** Log retention in days (SRS v6.3 §12); older daily files are deleted. */
  logRetentionDays: number
  /** DEBUG entries are dropped unless enabled (SRS v6.3 §5). */
  debugLogging: boolean
}

// ---- System logs & diagnostics (SRS v6.3) ----

export type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
export const LOG_LEVELS: LogLevel[] = ['INFO', 'WARNING', 'ERROR', 'DEBUG']

export type LogCategory =
  | 'System'
  | 'User Activity'
  | 'Assessment'
  | 'Scanner'
  | 'Import / Export'
  | 'Storage'
  | 'Reports'
  | 'Charts'
  | 'Settings'
  | 'Coding Errors'
  | 'Security'
  | 'Diagnostics'
export const LOG_CATEGORIES: LogCategory[] = [
  'System',
  'User Activity',
  'Assessment',
  'Scanner',
  'Import / Export',
  'Storage',
  'Reports',
  'Charts',
  'Settings',
  'Coding Errors',
  'Security',
  'Diagnostics'
]

/** One log line (SRS v6.3 §6); empty string = not applicable. */
export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  category: LogCategory
  /** Process/module that generated it: main, renderer, ipc, scanner… */
  module: string
  /** Source component/file or IPC channel. */
  source: string
  /** Screen/page active when the event happened (renderer events). */
  page: string
  action: string
  status: string
  message: string
  failureReason: string
  /** Technical details — safe stack trace, counts, redacted config. */
  details: string
  projectCode: string
  applicationId: string
}

export interface LogQuery {
  dateFrom?: string
  dateTo?: string
  level?: LogLevel | ''
  category?: LogCategory | ''
  module?: string
  projectCode?: string
  applicationId?: string
  keyword?: string
  limit?: number
}

export const SCANNER_TYPES: ScannerType[] = ['Nessus', 'Tenable.io']

export interface ScannerTestResult {
  ok: boolean
  message: string
}

export interface ScannerScan {
  id: number
  name: string
  status: string
  lastModified: string
  /** Nessus Policy Name (SRS v6.5.1); '' when not retrieved or unavailable. */
  policy: string
}

/** Live progress for scanner fetches (export → generate → download → import). */
export interface ScanFetchProgress {
  scanId: number
  stage: 'export' | 'generating' | 'downloading' | 'importing' | 'done'
  percent: number
  message: string
}

export interface NessusImportResult {
  imported: number
  duplicates: number
  hostsCreated: number
  classifications: Record<FindingClassification, number>
  errors: string[]
}

export interface ComparisonResult {
  newFindings: Finding[]
  resolvedFindings: Finding[]
  recurringFindings: { a: Finding; b: Finding }[]
  severityChanges: { a: Finding; b: Finding }[]
}

export const REQUEST_STATUSES: RequestStatus[] = [
  'New', 'Pending Approval', 'Approved', 'Scheduled', 'In Progress', 'Reporting', 'Delivered', 'Closed'
]
export const ASSESSMENT_TYPES: AssessmentType[] = ['Web', 'API', 'Mobile', 'Internal VA', 'External VA', 'Host VA', 'Retest']
export const TIMEFRAMES: Timeframe[] = ['annual', 'quarterly', 'adhoc']

/** Types available within each assessment module (Retest is allowed everywhere). */
export const CATEGORY_TYPES: Record<AssessmentCategory, AssessmentType[]> = {
  web: ['Web', 'API', 'Mobile', 'Retest'],
  'internal-external': ['Internal VA', 'External VA', 'Retest'],
  host: ['Host VA', 'Retest']
}

export const CATEGORY_LABELS: Record<AssessmentCategory, string> = {
  web: 'Web Application',
  'internal-external': 'Internal / External',
  host: 'Host'
}

/** Fallback mapping for records created before categories existed. */
export function categoryOfType(type: AssessmentType): AssessmentCategory {
  if (type === 'Internal VA' || type === 'External VA') return 'internal-external'
  if (type === 'Host VA') return 'host'
  return 'web'
}

/** Parse Power Automate subject "[VAPT-20260701-140418] VAPT Request - Thune" (4.4). */
export function parseProjectCode(raw: string): { projectCode: string; title: string } {
  const m = raw.match(/^\s*\[([^\]]+)\]\s*(.*)$/)
  if (!m) return { projectCode: '', title: raw.trim() }
  const title = m[2].replace(/^VAPT\s+Request\s*-\s*/i, '').trim()
  return { projectCode: m[1].trim(), title: title || m[2].trim() }
}

/** New project code: VAPT-YYYYMMDD-HHMMSS (4.2). */
export function generateProjectCode(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `VAPT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
/** Period label for finding lifecycle display (SRS v5 §5), e.g. "Annual 2025" / "Q2 2026". */
export function periodLabel(timeframe: Timeframe, dateIso: string): string {
  const d = new Date(dateIso || Date.now())
  if (timeframe === 'annual') return `Annual ${d.getFullYear()}`
  if (timeframe === 'quarterly') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
  return `Adhoc ${d.getFullYear()}`
}
export const SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low', 'Info']
export const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low']
export const ENVIRONMENTS: Environment[] = ['Production', 'UAT', 'Development', 'Test', 'Staging', 'Unknown']
export const INVENTORY_STATUSES: InventoryStatus[] = ['Pending', 'In Progress', 'Completed']
export const FINDING_STATUSES: FindingStatus[] = ['Open', 'In Remediation', 'Resolved', 'Risk Accepted', 'Closed']
export const ASSESSMENT_STATUSES: AssessmentStatus[] = ['Planned', 'In Progress', 'Completed', 'Cancelled']
