import type { AssessmentType, RequestStatus, VaptRequest } from '../shared/types'

/**
 * Power Automate request-file format (v6.6.6): stored request files use the
 * exact schema the Power Automate flow exports (requestNumber, emailAddress,
 * departmentDivision, Excel date serials, …) so the requests folder stays
 * aligned with the flow's output. Portal-only fields (id, status, priority,
 * title, notes, timestamps, …) live under a nested `portal` key. A raw export
 * without a `portal` block is adopted as a new request on load.
 */

/** Accept "30/6/2026" (d/m/yyyy), "2026-06-30", an Excel date serial ("46079"), or empty. */
export function normalizeDate(v?: string | number | null): string {
  if (v === undefined || v === null || v === '') return ''
  const s = String(v).trim()
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/)
  if (iso) return iso[0]
  // SharePoint/Excel date serial: days since 1899-12-30 (5 digits ≈ 1927–2173).
  if (/^\d{5}$/.test(s)) {
    return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000).toISOString().slice(0, 10)
  }
  return ''
}

/** ISO date → Excel serial string (what Power Automate exports); '' when not a date. */
export function isoToSerial(iso?: string): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return String(Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86_400_000))
}

/** Map the form's "Type of System" answer onto an assessment type; undefined = keep the default. */
export function assessmentTypeOf(typeOfSystem?: string): AssessmentType | undefined {
  const t = (typeOfSystem || '').toLowerCase()
  if (t.includes('mobile')) return 'Mobile'
  if (t.includes('api')) return 'API'
  if (t.includes('web')) return 'Web'
  return undefined
}

const TYPE_OF_SYSTEM_LABELS: Partial<Record<AssessmentType, string>> = {
  Web: 'Web Application',
  API: 'API',
  Mobile: 'Mobile Application'
}

/**
 * Map the export's `approvalStatus` onto a request status (v6.6.13):
 * "Acknowledge(d)" → Acknowledge, "Approve(d)" → Approved, "Pending…" →
 * Pending Approval. Undefined = leave the default; editable afterwards.
 */
export function requestStatusOf(approvalStatus?: unknown): RequestStatus | undefined {
  const s = String(approvalStatus ?? '').toLowerCase()
  if (!s) return undefined
  if (s.includes('acknowledg')) return 'Acknowledge'
  if (s.includes('approv')) return 'Approved'
  if (s.includes('pending')) return 'Pending Approval'
  return undefined
}

/** Strip SharePoint's XML-escaped carriage returns (`_x000D_`) and tidy whitespace. */
export function cleanPaText(v?: unknown): string {
  if (!v) return ''
  return String(v)
    .replace(/_x000D_/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/** Portal-only fields serialized under the `portal` key. */
const PORTAL_KEYS = [
  'id',
  'title',
  'applicationId',
  'scope',
  'environment',
  'assessmentType',
  'priority',
  'status',
  'targetDate',
  'notes',
  'createdAt',
  'updatedAt'
] as const

/** Serialize a request in the Power Automate export schema (+ nested `portal` block). */
export function toPaRequestFile(r: VaptRequest): Record<string, unknown> {
  const rec = r as unknown as Record<string, unknown>
  const portal: Record<string, unknown> = {}
  for (const k of PORTAL_KEYS) portal[k] = rec[k] ?? ''
  const source = r.source ?? {}
  return {
    ...source,
    requestNumber: r.projectCode,
    name: r.requestedBy,
    emailAddress: r.requesterEmail,
    departmentDivision: r.department,
    systemName: r.systemName,
    targetDateToGoLive: isoToSerial(r.goLiveDate) || r.goLiveDate || '',
    targetDateOfUatCompletionServerReadiness: isoToSerial(r.targetUatDate) || r.targetUatDate || '',
    purpose: r.purpose,
    typeOfSystem: (source.typeOfSystem as string) || TYPE_OF_SYSTEM_LABELS[r.assessmentType] || '',
    portal
  }
}

/**
 * Read one stored request. Accepts three shapes:
 *  - PA schema + `portal` block (current format)
 *  - flat portal record with a top-level `id` (pre-v6.6.6 files / legacy requests.json)
 *  - raw Power Automate export (no `portal`) — adopted with portal defaults,
 *    using the request number as a stable id
 */
export function fromPaRequestFile(data: unknown): VaptRequest | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const d = data as Record<string, unknown>
  if (typeof d.id === 'string') return d as unknown as VaptRequest // legacy flat portal record
  if (!d.requestNumber && !d.portal) return undefined // foreign JSON — not a request
  const portal = (d.portal ?? {}) as Partial<VaptRequest>
  const { portal: _omit, ...source } = d
  void _omit
  const now = new Date().toISOString()
  return {
    priority: 'Medium',
    environment: 'Production',
    assessmentType: assessmentTypeOf(String(d.typeOfSystem ?? '')) ?? 'Web',
    title: String(d.systemName ?? d.requestNumber ?? ''),
    applicationId: '',
    scope: '',
    // Notes stay empty — the detail view shows every export field directly.
    notes: '',
    targetDate: '',
    ...portal,
    // Untriaged requests (still 'New') follow the export's approvalStatus;
    // once an analyst moves the status manually, their value wins.
    status:
      portal.status && portal.status !== 'New' ? portal.status : (requestStatusOf(d.approvalStatus) ?? 'New'),
    id: portal.id || String(d.requestNumber),
    createdAt: portal.createdAt || now,
    updatedAt: portal.updatedAt || now,
    projectCode: String(d.requestNumber ?? ''),
    requestedBy: String(d.name ?? ''),
    requesterEmail: String(d.emailAddress ?? ''),
    department: String(d.departmentDivision ?? ''),
    systemName: String(d.systemName ?? ''),
    goLiveDate: normalizeDate(d.targetDateToGoLive as string | number),
    targetUatDate: normalizeDate(d.targetDateOfUatCompletionServerReadiness as string | number),
    purpose: String(d.purpose ?? ''),
    source
  }
}
