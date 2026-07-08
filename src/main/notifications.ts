import type { AppNotification } from '../shared/types'
import { isOverdue } from '../shared/sla'
import { Store } from './store'

/**
 * Recompute notifications (FR32): SLA breaches, assessments starting within
 * 7 days, and retest-due events (finding closed >30 days with no retest
 * assessment since). Existing read-flags are preserved by entityId+kind.
 */
export function refreshNotifications(store: Store): AppNotification[] {
  const existing = store.list('notifications')
  const readMap = new Map(existing.map((n) => [`${n.kind}:${n.entityId}`, n.read]))
  for (const n of [...existing]) store.remove('notifications', n.id)

  const now = new Date()
  const soon = new Date(now.getTime() + 7 * 86400000)
  const findings = store.list('findings')
  const assessments = store.list('assessments')
  const apps = new Map(store.list('applications').map((a) => [a.id, a]))
  const fresh: Partial<AppNotification>[] = []

  for (const f of findings) {
    if (isOverdue(f, now)) {
      fresh.push({
        kind: 'sla-breach',
        entityId: f.id,
        message: `SLA breached: [${f.severity}] ${f.title} (due ${f.slaDueDate})`,
        read: readMap.get(`sla-breach:${f.id}`) ?? false
      })
    }
  }

  for (const a of assessments) {
    if (a.status === 'Planned' && a.startDate) {
      const start = new Date(a.startDate)
      if (start >= now && start <= soon) {
        fresh.push({
          kind: 'upcoming-assessment',
          entityId: a.id,
          message: `Assessment starting ${a.startDate}: ${a.name} (${apps.get(a.applicationId)?.name ?? '—'})`,
          read: readMap.get(`upcoming-assessment:${a.id}`) ?? false
        })
      }
    }
  }

  // Retest due: resolved findings older than 30 days whose application has no
  // retest assessment created after the closure date.
  for (const f of findings) {
    if ((f.status === 'Resolved' || f.status === 'Closed') && f.closedDate) {
      const closed = new Date(f.closedDate)
      if (now.getTime() - closed.getTime() > 30 * 86400000) {
        const retested = assessments.some(
          (a) => a.type === 'Retest' && a.applicationId === f.applicationId && a.createdAt >= f.closedDate
        )
        if (!retested) {
          fresh.push({
            kind: 'retest-due',
            entityId: f.id,
            message: `Retest due: ${f.title} closed ${f.closedDate}, no retest scheduled`,
            read: readMap.get(`retest-due:${f.id}`) ?? false
          })
        }
      }
    }
  }

  return store.createMany('notifications', fresh)
}
