import type { Finding, Severity } from './types'

/** Remediation SLA in days, by severity (FR21). */
export const SLA_DAYS: Record<Severity, number> = {
  Critical: 30,
  High: 60,
  Medium: 90,
  Low: 180,
  Info: 365
}

export function slaDueDate(severity: Severity, discoveredDate: string): string {
  const d = new Date(discoveredDate || Date.now())
  d.setDate(d.getDate() + SLA_DAYS[severity])
  return d.toISOString().slice(0, 10)
}

export function isFindingOpen(f: Finding): boolean {
  return f.status === 'Open' || f.status === 'In Remediation'
}

export function isOverdue(f: Finding, now = new Date()): boolean {
  return isFindingOpen(f) && !!f.slaDueDate && new Date(f.slaDueDate) < now
}

/** Days until SLA due (negative = overdue). */
export function slaDaysRemaining(f: Finding, now = new Date()): number {
  return Math.ceil((new Date(f.slaDueDate).getTime() - now.getTime()) / 86400000)
}

export interface SlaStats {
  total: number
  open: number
  closed: number
  overdue: number
  complianceRate: number
  avgClosureDays: number
}

/** Compliance = closed-in-time + open-not-yet-due, over all findings with an SLA. */
export function slaStats(findings: Finding[]): SlaStats {
  const withSla = findings.filter((f) => f.slaDueDate)
  const open = findings.filter(isFindingOpen)
  const closed = findings.filter((f) => !isFindingOpen(f))
  const overdue = findings.filter((f) => isOverdue(f))
  let compliant = 0
  for (const f of withSla) {
    if (isFindingOpen(f)) {
      if (!isOverdue(f)) compliant++
    } else if (!f.closedDate || new Date(f.closedDate) <= new Date(f.slaDueDate)) {
      compliant++
    }
  }
  const closedWithDates = closed.filter((f) => f.closedDate && f.discoveredDate)
  const avgClosureDays = closedWithDates.length
    ? Math.round(
        closedWithDates.reduce(
          (s, f) => s + (new Date(f.closedDate).getTime() - new Date(f.discoveredDate).getTime()) / 86400000,
          0
        ) / closedWithDates.length
      )
    : 0
  return {
    total: findings.length,
    open: open.length,
    closed: closed.length,
    overdue: overdue.length,
    complianceRate: withSla.length ? Math.round((compliant / withSla.length) * 100) : 100,
    avgClosureDays
  }
}
