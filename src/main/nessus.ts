import fs from 'fs'
import path from 'path'
import type { Finding, Host, NessusImportResult } from '../shared/types'
import { slaDueDate } from '../shared/sla'
import { Store } from './store'
import { classifyFinding, classifyLifecycle, fingerprintOf } from './fingerprint'
import { parseNessusCsv, parseNessusXml } from './nessus-parse'

/**
 * Import a Nessus export into an assessment (FR18–FR20): parse rows, find or
 * create hosts, fingerprint each finding, skip duplicates already present in
 * the assessment, and classify New/Retest/Regression/Context Change against
 * the application's prior findings.
 */
export function importNessusFile(store: Store, assessmentId: string, filePath: string): NessusImportResult {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const isCsv = path.extname(filePath).toLowerCase() === '.csv'
  return importNessusContent(store, assessmentId, raw, path.basename(filePath), isCsv)
}

/**
 * Import already-loaded scan content (from a file or fetched from a scanner
 * API). `sourceName` is recorded on hosts and used to archive the raw scan.
 */
export function importNessusContent(
  store: Store,
  assessmentId: string,
  raw: string,
  sourceName: string,
  isCsv: boolean
): NessusImportResult {
  const assessment = store.get('assessments', assessmentId)
  if (!assessment) throw new Error('Assessment not found')

  const rows = isCsv ? parseNessusCsv(raw) : parseNessusXml(raw)

  const result: NessusImportResult = {
    imported: 0,
    duplicates: 0,
    hostsCreated: 0,
    classifications: { New: 0, Existing: 0, Retest: 0, Regression: 0, 'Context Change': 0 },
    errors: []
  }

  const hosts = store.list('hosts')
  // Hosts are never merged across imports (FR-H3): each Nessus file gets its
  // own isolated host records, keyed by sourceFile + IP. Re-importing the same
  // file reuses that file's own host records.
  const sourceFile = sourceName
  const hostByIp = new Map(hosts.filter((h) => h.sourceFile === sourceFile).map((h) => [h.ip, h]))
  const allFindings = store.list('findings')
  const priorFindings = allFindings.filter((f) => f.applicationId === assessment.applicationId)
  const existingInAssessment = new Set(
    allFindings.filter((f) => f.assessmentId === assessmentId).map((f) => f.fingerprint)
  )
  const hostsById = new Map(hosts.map((h) => [h.id, h]))
  const allAssessments = store.list('assessments')
  const requestsById = new Map(store.list('requests').map((r) => [r.id, r]))
  const assessmentProjectCode = assessment.requestId ? (requestsById.get(assessment.requestId)?.projectCode ?? '') : ''
  const newFindings: Partial<Finding>[] = []
  const today = new Date().toISOString().slice(0, 10)
  const attachedHostIds = new Set(assessment.hostIds)

  for (const row of rows) {
    try {
      if (!row.ip) continue
      let host = hostByIp.get(row.ip)
      if (!host) {
        host = store.create('hosts', {
          ip: row.ip,
          hostname: row.hostname,
          environment: 'Production',
          exposure: assessment.type === 'External VA' ? 'external' : 'internal',
          applicationId: assessment.applicationId,
          os: row.os,
          status: 'Pending',
          notes: `Auto-created by Nessus import on ${today}`,
          sourceFile
        } as Partial<Host>)
        hostByIp.set(row.ip, host)
        hostsById.set(host.id, host)
        result.hostsCreated++
      }
      attachedHostIds.add(host.id)
      // Older imports (and CSV rows) leave the OS blank — backfill it when the scan knows it.
      if (row.os && !host.os) {
        host = store.update('hosts', host.id, { os: row.os })
        hostsById.set(host.id, host)
      }

      // IP (not host record id) is the identity here: host records are
      // per-import, but the same IP across imports must still match for
      // retest/regression detection. Compliance checks all share one plugin
      // id, so the check name is part of their identity.
      const fingerprint = fingerprintOf({
        hostId: '',
        ip: row.ip,
        port: row.port,
        pluginId: row.pluginId,
        endpoint: '',
        parameter: row.complianceResult ? row.name : ''
      })
      if (existingInAssessment.has(fingerprint)) {
        result.duplicates++
        continue
      }
      existingInAssessment.add(fingerprint)

      // Annual/quarterly assessments use the New/Existing lifecycle (SRS v5 §5);
      // adhoc imports keep the retest/regression classification.
      const lifecycle = classifyLifecycle(fingerprint, assessment, allAssessments, allFindings, requestsById)
      const classification = lifecycle
        ? lifecycle.classification
        : classifyFinding(fingerprint, host.id, { priorFindings, hostsById, assessment })
      result.classifications[classification]++
      newFindings.push({
        title: row.name,
        assessmentId,
        applicationId: assessment.applicationId,
        hostId: host.id,
        affectedAsset: '',
        severity: row.severity,
        cvss: row.cvss,
        cve: row.cve,
        cwe: '',
        owasp: '',
        pluginId: row.pluginId,
        pluginName: row.pluginName,
        endpoint: '',
        port: row.port,
        parameter: '',
        description: row.description,
        evidence: row.evidence,
        attachments: [],
        recommendation: row.solution,
        // Compliance results map onto the finding lifecycle: PASSED checks
        // arrive closed (shown as "Passed" in the host module), everything
        // else is an open issue (shown as "Failed").
        status: row.complianceResult === 'PASSED' ? 'Closed' : 'Open',
        classification,
        fingerprint,
        projectCode: assessmentProjectCode,
        firstIdentifiedAssessmentType: lifecycle?.firstIdentifiedAssessmentType ?? '',
        firstIdentifiedPeriod: lifecycle?.firstIdentifiedPeriod ?? '',
        firstIdentifiedProjectCode: lifecycle?.firstIdentifiedProjectCode ?? '',
        firstIdentifiedDate: lifecycle?.firstIdentifiedDate ?? '',
        discoveredDate: today,
        slaDueDate: slaDueDate(row.severity, today),
        closedDate: row.complianceResult === 'PASSED' ? today : ''
      })
      result.imported++
    } catch (e) {
      result.errors.push(String(e))
    }
  }

  store.createMany('findings', newFindings)
  store.update('assessments', assessmentId, { hostIds: [...attachedHostIds] })

  // Keep a copy of the raw scan alongside the data for auditability.
  try {
    const importsDir = path.join(store.getSettings().dataDir, 'imports')
    fs.writeFileSync(path.join(importsDir, `${Date.now()}-${sourceName}`), raw)
  } catch {
    /* non-fatal */
  }

  return result
}
