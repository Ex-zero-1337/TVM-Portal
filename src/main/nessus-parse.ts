import { XMLParser } from 'fast-xml-parser'
import type { Severity } from '../shared/types'

export interface ScanRow {
  ip: string
  hostname: string
  /** Operating system from HostProperties (XML exports; '' in CSV). */
  os: string
  port: string
  pluginId: string
  name: string
  /** Raw scanner plugin name (kept even when `name` is a compliance check name). */
  pluginName: string
  cve: string
  cvss: number
  severity: Severity
  description: string
  solution: string
  evidence: string
  /** Compliance audit result (`cm:compliance-result`): PASSED / FAILED / WARNING; '' = normal vulnerability row. */
  complianceResult: string
}

const NESSUS_SEVERITY: Record<string, Severity> = {
  '4': 'Critical',
  '3': 'High',
  '2': 'Medium',
  '1': 'Low',
  '0': 'Info'
}

const RISK_SEVERITY: Record<string, Severity> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'Info',
  info: 'Info',
  informational: 'Info'
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

export function parseNessusXml(xml: string): ScanRow[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    isArray: (name) => ['ReportHost', 'ReportItem', 'tag', 'cve'].includes(name)
  })
  const doc = parser.parse(xml)
  const report = doc?.NessusClientData_v2?.Report
  if (!report) throw new Error('Not a Nessus v2 export (missing NessusClientData_v2/Report)')

  const rows: ScanRow[] = []
  for (const host of asArray<any>(report.ReportHost)) {
    const tags = asArray<any>(host.HostProperties?.tag)
    const prop = (n: string) => tags.find((t) => t['@_name'] === n)?.['#text'] ?? ''
    const ip = String(prop('host-ip') || host['@_name'] || '')
    const hostname = String(prop('host-fqdn') || prop('netbios-name') || host['@_name'] || ip)
    const os = String(prop('operating-system') || prop('os') || '')

    for (const item of asArray<any>(host.ReportItem)) {
      const cvss = parseFloat(item.cvss3_base_score ?? item.cvss_base_score ?? '0') || 0
      // Compliance audits (e.g. CIS benchmarks): the meaningful name/result
      // live in the cm:* fields — the plugin name is just "Unix Compliance
      // Checks" and would make every finding look identical.
      const checkName = String(item['cm:compliance-check-name'] ?? '')
      const actualValue = String(item['cm:compliance-actual-value'] ?? '')
      const pluginName = String(item['@_pluginName'] ?? item.plugin_name ?? 'Unknown plugin')
      rows.push({
        ip,
        hostname,
        os,
        port: String(item['@_port'] ?? '0'),
        pluginId: String(item['@_pluginID'] ?? ''),
        name: checkName || pluginName,
        pluginName,
        cve: asArray<any>(item.cve).map(String).join(', '),
        cvss,
        severity: NESSUS_SEVERITY[String(item['@_severity'] ?? '0')] ?? 'Info',
        description: String(item['cm:compliance-info'] ?? item.description ?? item.synopsis ?? ''),
        solution: String(item['cm:compliance-solution'] ?? item.solution ?? ''),
        evidence: actualValue
          ? `Actual value:\n${actualValue}`
          : String(item['cm:compliance-output'] ?? item.plugin_output ?? ''),
        complianceResult: String(item['cm:compliance-result'] ?? '').toUpperCase()
      })
    }
  }
  return rows
}

/** Minimal RFC4180-style CSV parser (handles quoted fields with commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

export function parseNessusCsv(text: string): ScanRow[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const idx = {
    pluginId: col('plugin id'),
    cve: col('cve'),
    cvss: col('cvss v3.0 base score') !== -1 ? col('cvss v3.0 base score') : col('cvss'),
    risk: col('risk'),
    host: col('host'),
    port: col('port'),
    name: col('name'),
    description: col('description'),
    solution: col('solution'),
    output: col('plugin output')
  }
  if (idx.pluginId === -1 || idx.host === -1) {
    throw new Error('CSV is missing required Nessus columns ("Plugin ID", "Host")')
  }
  const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')
  return rows.slice(1).map((r) => ({
    ip: cell(r, idx.host),
    hostname: cell(r, idx.host),
    os: '',
    port: cell(r, idx.port) || '0',
    pluginId: cell(r, idx.pluginId),
    name: cell(r, idx.name) || 'Unknown plugin',
    pluginName: cell(r, idx.name) || 'Unknown plugin',
    cve: cell(r, idx.cve),
    cvss: parseFloat(cell(r, idx.cvss)) || 0,
    severity: RISK_SEVERITY[cell(r, idx.risk).toLowerCase()] ?? 'Info',
    description: cell(r, idx.description),
    solution: cell(r, idx.solution),
    evidence: cell(r, idx.output),
    complianceResult: ''
  }))
}
