import { useMemo, useState, type ReactNode } from 'react'
import type { Severity } from '@shared/types'

// ---------------------------------------------------------------- Badges

const SEV_CLASS: Record<string, string> = {
  Critical: 'badge sev-critical',
  High: 'badge sev-high',
  Medium: 'badge sev-medium',
  Low: 'badge sev-low',
  Info: 'badge sev-info',
  Unrated: 'badge'
}

export function SeverityBadge({ value }: { value: Severity | 'Unrated' | string }) {
  return <span className={SEV_CLASS[value] ?? 'badge'}>{value}</span>
}

const STATUS_TONE: Record<string, string> = {
  Open: 'tone-red',
  'In Remediation': 'tone-amber',
  'In Progress': 'tone-amber',
  Resolved: 'tone-green',
  Closed: 'tone-gray',
  'Risk Accepted': 'tone-blue',
  New: 'tone-blue',
  Existing: 'tone-purple',
  Pending: 'tone-amber',
  Retest: 'tone-amber',
  Regression: 'tone-red',
  'Context Change': 'tone-purple',
  Completed: 'tone-green',
  Planned: 'tone-blue',
  Delivered: 'tone-green',
  Approved: 'tone-green',
  Acknowledge: 'tone-green',
  Scheduled: 'tone-blue',
  Reporting: 'tone-amber',
  'Pending Approval': 'tone-amber',
  Cancelled: 'tone-gray',
  external: 'tone-red',
  internal: 'tone-blue',
  INFO: 'tone-blue',
  WARNING: 'tone-amber',
  ERROR: 'tone-red',
  DEBUG: 'tone-gray'
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`badge ${STATUS_TONE[value] ?? 'tone-gray'}`}>{value}</span>
}

// ---------------------------------------------------------------- Detail layout (v6.6.8)

/** One label/value cell in a detail grid; `wide` spans the full row; hidden when empty. */
export function DetailField({ label, value, wide }: { label: string; value?: ReactNode; wide?: boolean }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className={`req-field${wide ? ' wide' : ''}`}>
      {label && <span className="req-field-label">{label}</span>}
      <span className="req-field-value">{value}</span>
    </div>
  )
}

/** Accented section used by the request/finding detail views. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="req-detail-section">
      <h4>{title}</h4>
      <div className="req-detail-grid">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------- Table

export interface Column<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
  sortValue?: (row: T) => string | number
  width?: string
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  onRowClick,
  filterText,
  emptyText = 'No records yet.',
  pageSize = 50
}: {
  rows: T[]
  columns: Column<T>[]
  onRowClick?: (row: T) => void
  filterText?: string
  emptyText?: string
  pageSize?: number
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    if (!filterText) return rows
    const q = filterText.toLowerCase()
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
  }, [rows, filterText])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    const val = (r: T) =>
      col?.sortValue ? col.sortValue(r) : String((r as Record<string, unknown>)[sort.key] ?? '')
    return [...filtered].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [filtered, sort, columns])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages - 1)
  const slice = sorted.slice(current * pageSize, (current + 1) * pageSize)

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                onClick={() =>
                  setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))
                }
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slice.map((row) => (
            <tr key={row.id} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(row)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
          {slice.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pager">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            ‹ Prev
          </button>
          <span>
            Page {current + 1} / {pages} · {sorted.length} rows
          </span>
          <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next ›
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Modal

export function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Form fields

export type FieldOption = string | { value: string; label: string }

export interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'select' | 'date' | 'number'
  options?: readonly FieldOption[]
  required?: boolean
  span2?: boolean
}

export function EntityForm({
  fields,
  value,
  onChange
}: {
  fields: FieldDef[]
  value: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}) {
  return (
    <div className="form-grid">
      {fields.map((f) => {
        const v = value[f.key] ?? ''
        const set = (x: unknown) => onChange({ [f.key]: x })
        return (
          <label key={f.key} className={f.span2 ? 'span2' : ''}>
            <span>
              {f.label}
              {f.required && <em className="req"> *</em>}
            </span>
            {f.type === 'textarea' ? (
              <textarea value={String(v)} rows={3} onChange={(e) => set(e.target.value)} />
            ) : f.type === 'select' ? (
              <select value={String(v)} onChange={(e) => set(e.target.value)}>
                <option value="">— select —</option>
                {f.options?.map((o) => {
                  const opt = typeof o === 'string' ? { value: o, label: o } : o
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  )
                })}
              </select>
            ) : (
              <input
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                value={String(v)}
                step={f.type === 'number' ? '0.1' : undefined}
                onChange={(e) => set(f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
              />
            )}
          </label>
        )
      })}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="search-input"
      type="search"
      placeholder={placeholder ?? 'Filter…'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
