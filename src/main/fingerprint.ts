import { createHash } from 'crypto'
import type { Assessment, Finding, FindingClassification, Host, VaptRequest } from '../shared/types'
import { periodLabel } from '../shared/types'
import { isFindingOpen } from '../shared/sla'

/**
 * Deterministic finding fingerprint (FR13):
 *   hash(host_id + ip + port + plugin_id + endpoint + parameter)
 * Used for deduplication, retest detection and regression tracking.
 * Values are normalised (trimmed, lowercased) so cosmetic differences in
 * scanner exports don't break matching.
 */
export function fingerprintOf(f: {
  hostId?: string
  ip?: string
  port?: string
  pluginId?: string
  endpoint?: string
  parameter?: string
  title?: string
}): string {
  const norm = (v?: string) => (v ?? '').trim().toLowerCase()
  // Fall back to the title when there is no plugin id (manual findings),
  // otherwise two manual findings on the same endpoint would collide.
  const discriminator = norm(f.pluginId) || norm(f.title)
  const material = [norm(f.hostId), norm(f.ip), norm(f.port), discriminator, norm(f.endpoint), norm(f.parameter)].join(
    '|'
  )
  return createHash('sha256').update(material).digest('hex')
}

export interface ClassificationContext {
  /** Findings already in the system for the same application. */
  priorFindings: Finding[]
  hostsById: Map<string, Host>
  assessment: Assessment
}

/**
 * Classify an incoming finding against history (FR15/FR17):
 * - no fingerprint match            -> New
 * - matches a finding still open    -> Retest (still present on retest)
 * - matches a closed/resolved one   -> Regression (it came back)
 * - matches but host exposure moved -> Context Change
 */
export function classifyFinding(
  fingerprint: string,
  hostId: string,
  ctx: ClassificationContext
): FindingClassification {
  const matches = ctx.priorFindings.filter((f) => f.fingerprint === fingerprint && f.assessmentId !== ctx.assessment.id)
  if (matches.length === 0) return 'New'

  const latest = matches.reduce((a, b) => (a.discoveredDate > b.discoveredDate ? a : b))
  const priorHost = ctx.hostsById.get(latest.hostId)
  const currentHost = ctx.hostsById.get(hostId)
  if (priorHost && currentHost && priorHost.exposure !== currentHost.exposure) return 'Context Change'
  return isFindingOpen(latest) ? 'Retest' : 'Regression'
}

/** First-identified provenance carried by 'Existing' findings (SRS v5 §5). */
export interface LifecycleResult {
  classification: 'New' | 'Existing'
  firstIdentifiedAssessmentType: string
  firstIdentifiedPeriod: string
  firstIdentifiedProjectCode: string
  firstIdentifiedDate: string
}

/**
 * Finding lifecycle for Annual and Quarterly assessments (SRS v5 §5):
 * compare against the previous assessment of the same Application, Assessment
 * Type and Frequency. A fingerprint match makes the finding 'Existing' and
 * carries forward where it was first identified; otherwise it is 'New'.
 * Returns null for adhoc assessments (the lifecycle does not apply).
 */
export function classifyLifecycle(
  fingerprint: string,
  assessment: Assessment,
  allAssessments: Assessment[],
  allFindings: Finding[],
  requestsById: Map<string, VaptRequest>
): LifecycleResult | null {
  if (assessment.timeframe !== 'annual' && assessment.timeframe !== 'quarterly') return null

  const sortKey = (a: Assessment) => a.startDate || a.createdAt
  const previous = allAssessments
    .filter(
      (a) =>
        a.id !== assessment.id &&
        a.applicationId === assessment.applicationId &&
        a.type === assessment.type &&
        (a.timeframe || 'adhoc') === assessment.timeframe &&
        sortKey(a) < sortKey(assessment)
    )
    .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))[0]

  const asNew: LifecycleResult = {
    classification: 'New',
    firstIdentifiedAssessmentType: '',
    firstIdentifiedPeriod: '',
    firstIdentifiedProjectCode: '',
    firstIdentifiedDate: ''
  }
  if (!previous) return asNew

  const match = allFindings.find((f) => f.assessmentId === previous.id && f.fingerprint === fingerprint)
  if (!match) return asNew

  // Propagate the original first-identified provenance when the matched
  // finding was itself Existing; otherwise the previous assessment is where
  // the finding was first identified.
  if (match.firstIdentifiedPeriod) {
    return {
      classification: 'Existing',
      firstIdentifiedAssessmentType: match.firstIdentifiedAssessmentType,
      firstIdentifiedPeriod: match.firstIdentifiedPeriod,
      firstIdentifiedProjectCode: match.firstIdentifiedProjectCode,
      firstIdentifiedDate: match.firstIdentifiedDate
    }
  }
  const request = previous.requestId ? requestsById.get(previous.requestId) : undefined
  return {
    classification: 'Existing',
    firstIdentifiedAssessmentType: previous.type,
    firstIdentifiedPeriod: periodLabel(previous.timeframe || 'adhoc', previous.startDate || previous.createdAt),
    firstIdentifiedProjectCode: match.projectCode || request?.projectCode || '',
    firstIdentifiedDate: match.discoveredDate || ''
  }
}
