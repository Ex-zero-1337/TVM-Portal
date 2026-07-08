import { useState, type ReactNode } from 'react'
import type { CollectionMap, CollectionName } from '@shared/types'
import { useDb } from '../data'
import { Column, DataTable, EntityForm, FieldDef, Modal, SearchInput, Toolbar } from './ui'

/**
 * Generic list + create/edit/delete page. Pages supply columns, form fields
 * and defaults; anything more specific (imports, comparisons, detail views)
 * is layered on via renderExtra / onRowClick.
 */
export function CrudPage<K extends CollectionName>({
  collection,
  title,
  singular,
  columns,
  fields,
  defaults,
  rows,
  toolbarExtra,
  renderDetail,
  validate,
  deleteKeyword
}: {
  collection: K
  title: string
  singular: string
  columns: Column<CollectionMap[K]>[]
  fields: FieldDef[]
  defaults: () => Partial<CollectionMap[K]>
  rows?: CollectionMap[K][]
  toolbarExtra?: ReactNode
  renderDetail?: (row: CollectionMap[K], close: () => void, edit: () => void) => ReactNode
  validate?: (draft: Record<string, unknown>) => string | null
  /** When set, deletion requires typing this keyword instead of a confirm dialog (SRS v6.5). */
  deleteKeyword?: string
}) {
  const db = useDb()
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Partial<CollectionMap[K]> | null>(null)
  const [detail, setDetail] = useState<CollectionMap[K] | null>(null)
  const [error, setError] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [deleteWord, setDeleteWord] = useState('')

  const data = rows ?? (db[collection] as CollectionMap[K][])
  const isNew = editing && !(editing as { id?: string }).id

  const save = async () => {
    if (!editing) return
    const err = validate?.(editing as Record<string, unknown>)
    if (err) {
      setError(err)
      return
    }
    const id = (editing as { id?: string }).id
    if (id) await db.update(collection, id, editing)
    else await db.create(collection, editing)
    setEditing(null)
    setError('')
  }

  const reallyDelete = async () => {
    const id = (editing as { id?: string })?.id
    if (!id) return
    await db.remove(collection, id)
    setDeleteArmed(false)
    setDeleteWord('')
    setEditing(null)
  }

  const del = async () => {
    const id = (editing as { id?: string })?.id
    if (!id) return
    if (deleteKeyword) {
      setDeleteWord('')
      setDeleteArmed(true)
      return
    }
    if (confirm(`Delete this ${singular.toLowerCase()}? This cannot be undone.`)) await reallyDelete()
  }

  const deleteConfirmed = deleteWord.trim().toLowerCase() === (deleteKeyword ?? '').toLowerCase()

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
        <Toolbar>
          <SearchInput value={filter} onChange={setFilter} />
          {toolbarExtra}
          <button className="primary" onClick={() => setEditing(defaults())}>
            + New {singular}
          </button>
        </Toolbar>
      </div>

      <DataTable
        rows={data}
        columns={columns}
        filterText={filter}
        onRowClick={(row) => (renderDetail ? setDetail(row) : setEditing({ ...row }))}
      />

      {editing && (
        <Modal title={isNew ? `New ${singular}` : `Edit ${singular}`} onClose={() => setEditing(null)} wide>
          <EntityForm
            fields={fields}
            value={editing as Record<string, unknown>}
            onChange={(patch) => setEditing({ ...editing, ...patch })}
          />
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            {!isNew && (
              <button className="danger" onClick={del}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button onClick={() => setEditing(null)}>Cancel</button>
            <button className="primary" onClick={save}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {deleteArmed && (
        <Modal
          title={`Delete this ${singular.toLowerCase()}?`}
          onClose={() => {
            setDeleteArmed(false)
            setDeleteWord('')
          }}
        >
          <p>This cannot be undone. Type <code>{deleteKeyword}</code> to confirm:</p>
          <input
            autoFocus
            value={deleteWord}
            placeholder={deleteKeyword}
            onChange={(e) => setDeleteWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && deleteConfirmed) void reallyDelete()
            }}
          />
          <div className="modal-actions">
            <span className="spacer" />
            <button
              onClick={() => {
                setDeleteArmed(false)
                setDeleteWord('')
              }}
            >
              Cancel
            </button>
            <button className="danger" disabled={!deleteConfirmed} onClick={() => void reallyDelete()}>
              Delete
            </button>
          </div>
        </Modal>
      )}

      {detail &&
        renderDetail?.(
          detail,
          () => setDetail(null),
          () => {
            setEditing({ ...detail })
            setDetail(null)
          }
        )}
    </div>
  )
}
