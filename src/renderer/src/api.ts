import type {
  AppNotification,
  AssessmentCategory,
  CollectionMap,
  CollectionName,
  ComparisonResult,
  Finding,
  LogEntry,
  LogQuery,
  NessusImportResult,
  ScanFetchProgress,
  ScannerConnection,
  ScannerScan,
  ScannerTestResult,
  Settings
} from '@shared/types'

interface Api {
  list<K extends CollectionName>(name: K): Promise<CollectionMap[K][]>
  get<K extends CollectionName>(name: K, id: string): Promise<CollectionMap[K] | undefined>
  create<K extends CollectionName>(name: K, data: Partial<CollectionMap[K]>): Promise<CollectionMap[K]>
  update<K extends CollectionName>(name: K, id: string, patch: Partial<CollectionMap[K]>): Promise<CollectionMap[K]>
  remove(name: CollectionName, id: string): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  chooseDir(): Promise<string | null>
  importNessus(assessmentId: string, kind: 'nessus' | 'csv'): Promise<NessusImportResult | null>
  /** Module-level manual import (v6.6.10): one assessment per selected file; null = dialog cancelled. */
  importNessusFiles(category: AssessmentCategory): Promise<{
    created: number
    imported: number
    duplicates: number
    hostsCreated: number
    failures: string[]
  } | null>
  /** Bulk assessment removal with cascade (v6.6.12): findings, evidence and orphaned hosts are deleted from disk too. */
  assessmentsRemoveMany(ids: string[]): Promise<{ assessments: number; findings: number; hosts: number }>
  scannerTest(conn: ScannerConnection): Promise<ScannerTestResult>
  scannerListScans(connId: string, includePolicy?: boolean): Promise<ScannerScan[]>
  scannerFetch(assessmentId: string, connId: string, scanId: number, scanName: string): Promise<NessusImportResult>
  /** Live fetch progress events; returns unsubscribe. */
  onScannerProgress(callback: (p: ScanFetchProgress) => void): () => void
  evidenceAdd(findingId: string): Promise<Finding>
  evidenceOpen(relPath: string): Promise<string>
  evidenceRemove(findingId: string, attachmentId: string): Promise<Finding>
  generateReport(req: {
    format: 'xlsx' | 'docx' | 'pdf'
    variant?: 'executive' | 'full'
    assessmentId?: string
    suggestedName: string
  }): Promise<string | null>
  compareAssessments(baselineId: string, currentId: string): Promise<ComparisonResult>
  refreshNotifications(): Promise<AppNotification[]>
  chartExportPdf(pngDataUrl: string, title: string, suggestedName: string): Promise<string | null>
  logWrite(entry: Partial<LogEntry>): Promise<void>
  logQuery(q: LogQuery): Promise<LogEntry[]>
  logClear(): Promise<number>
  logExport(q: LogQuery): Promise<string | null>
  logDiagnostics(): Promise<string | null>
  openPath(p: string): Promise<string>
  /** Fires when the main process changes data (e.g. Power Automate inbox); returns unsubscribe. */
  onDataChanged(callback: () => void): () => void
}

export const api = (window as unknown as { api: Api }).api
