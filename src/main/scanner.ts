import type { ScanFetchProgress, ScannerConnection, ScannerScan, ScannerTestResult } from '../shared/types'

/**
 * Minimal REST client for Nessus / Tenable.io (SRS v4 §5). Auth is API-key
 * based: `X-ApiKeys: accessKey=…; secretKey=…`. Nessus Professional/Manager
 * uses a self-signed cert, so TLS verification is relaxed for that host only,
 * scoped to the single request via an Agent.
 */

interface FetchOpts {
  method?: string
  path: string
  body?: unknown
  raw?: boolean
  /** Per-call timeout in ms (downloads of large scans need longer). */
  timeoutMs?: number
}

/** Progress callback for scanner fetches, surfaced live to the UI. */
export type ProgressFn = (p: Omit<ScanFetchProgress, 'scanId'>) => void

async function api(conn: ScannerConnection, opts: FetchOpts): Promise<Response> {
  const url = conn.url.replace(/\/+$/, '') + opts.path
  const headers: Record<string, string> = {
    'X-ApiKeys': `accessKey=${conn.accessKey}; secretKey=${conn.secretKey}`,
    Accept: 'application/json'
  }
  if (opts.body) headers['Content-Type'] = 'application/json'

  // Nessus appliances ship self-signed certs; allow them for this call only.
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  if (conn.type === 'Nessus') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000)
    })
    if (!res.ok && !opts.raw) {
      throw new Error(`${res.status} ${res.statusText}`)
    }
    return res
  } finally {
    if (conn.type === 'Nessus') {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
    }
  }
}

export async function testConnection(conn: ScannerConnection): Promise<ScannerTestResult> {
  try {
    // Both platforms expose a scans listing; a 200 with JSON confirms auth + reachability.
    const res = await api(conn, { path: '/scans', raw: true })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: 'Authentication failed — check the access/secret keys.' }
    }
    if (!res.ok) return { ok: false, message: `Scanner responded ${res.status} ${res.statusText}.` }
    await res.json()
    return { ok: true, message: `Connected to ${conn.type} at ${conn.url}.` }
  } catch (e) {
    return { ok: false, message: `Could not reach scanner: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Bounded-concurrency map — scan-detail enrichment without hammering the appliance. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

/**
 * List scans. The /scans listing does not include the policy, so when
 * `includePolicy` is set (SRS v6.5.1 policy filtering) each scan's detail is
 * fetched to read its Nessus Policy Name (`info.policy`); failures leave the
 * policy empty rather than failing the whole listing.
 */
export async function listScans(conn: ScannerConnection, includePolicy = false): Promise<ScannerScan[]> {
  const res = await api(conn, { path: '/scans' })
  const data = (await res.json()) as { scans?: { id: number; name: string; status: string; last_modification_date?: number }[] }
  const base: ScannerScan[] = (data.scans ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    lastModified: s.last_modification_date ? new Date(s.last_modification_date * 1000).toISOString().slice(0, 16).replace('T', ' ') : '',
    policy: ''
  }))
  if (!includePolicy) return base
  return mapLimit(base, 5, async (scan) => {
    try {
      const detailRes = await api(conn, { path: `/scans/${scan.id}` })
      const detail = (await detailRes.json()) as { info?: { policy?: string } }
      return { ...scan, policy: detail.info?.policy ?? '' }
    } catch {
      return scan
    }
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Export a scan and return the raw .nessus XML, ready for the existing parser.
 * Flow: request export → poll status → download, reporting progress at each
 * stage. The poll is strict: an 'error' status or a timeout raises instead of
 * downloading a not-ready export (which yields an empty/garbage import that
 * looks like "fetch did nothing").
 */
export async function fetchScanXml(
  conn: ScannerConnection,
  scanId: number,
  onProgress?: ProgressFn
): Promise<string> {
  const progress: ProgressFn = onProgress ?? (() => {})

  progress({ stage: 'export', percent: 5, message: 'Requesting export from scanner…' })
  const exportRes = await api(conn, {
    method: 'POST',
    path: `/scans/${scanId}/export`,
    body: { format: 'nessus' }
  })
  const { file, token } = (await exportRes.json()) as { file: number; token?: string }

  // Poll until the export file is ready (bounded to ~3 minutes).
  let ready = false
  for (let i = 0; i < 90; i++) {
    const statusRes = await api(conn, { path: `/scans/${scanId}/export/${file}/status` })
    const { status } = (await statusRes.json()) as { status: string }
    if (status === 'ready') {
      ready = true
      break
    }
    if (status === 'error') throw new Error('Scanner reported an export error for this scan.')
    progress({
      stage: 'generating',
      percent: Math.min(70, 10 + i * 2),
      message: `Scanner is preparing the export… (${status || 'queued'})`
    })
    await sleep(2000)
  }
  if (!ready) {
    throw new Error('Export was not ready within 3 minutes — try again, or upload the .nessus file manually.')
  }

  progress({ stage: 'downloading', percent: 75, message: 'Downloading scan export…' })
  const downloadPath = token ? `/tokens/${token}/download` : `/scans/${scanId}/export/${file}/download`
  // Large exports need far more than the default 30s request timeout.
  const res = await api(conn, { path: downloadPath, raw: true, timeoutMs: 300_000 })
  if (!res.ok) throw new Error(`Export download failed: ${res.status} ${res.statusText}`)
  const xml = await res.text()
  progress({
    stage: 'downloading',
    percent: 88,
    message: `Downloaded ${(xml.length / 1024 / 1024).toFixed(1)} MB`
  })
  return xml
}
