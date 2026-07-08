import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  Application,
  AppNotification,
  Assessment,
  CollectionMap,
  CollectionName,
  Finding,
  Host,
  KbTemplate,
  VaptRequest
} from '@shared/types'
import { api } from './api'

export interface Db {
  requests: VaptRequest[]
  applications: Application[]
  hosts: Host[]
  assessments: Assessment[]
  findings: Finding[]
  kb: KbTemplate[]
  notifications: AppNotification[]
  loading: boolean
  reload: () => Promise<void>
  create: <K extends CollectionName>(name: K, data: Partial<CollectionMap[K]>) => Promise<CollectionMap[K]>
  update: <K extends CollectionName>(name: K, id: string, patch: Partial<CollectionMap[K]>) => Promise<CollectionMap[K]>
  remove: (name: CollectionName, id: string) => Promise<void>
  appName: (id: string) => string
  hostLabel: (id: string) => string
  assessmentName: (id: string) => string
}

const DbContext = createContext<Db | null>(null)

export function DbProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({
    requests: [] as VaptRequest[],
    applications: [] as Application[],
    hosts: [] as Host[],
    assessments: [] as Assessment[],
    findings: [] as Finding[],
    kb: [] as KbTemplate[],
    notifications: [] as AppNotification[],
    loading: true
  })

  const reload = useCallback(async () => {
    const [requests, applications, hosts, assessments, findings, kb] = await Promise.all([
      api.list('requests'),
      api.list('applications'),
      api.list('hosts'),
      api.list('assessments'),
      api.list('findings'),
      api.list('kb')
    ])
    const notifications = await api.refreshNotifications()
    setState({ requests, applications, hosts, assessments, findings, kb, notifications, loading: false })
  }, [])

  useEffect(() => {
    void reload()
    // Live updates: main pushes this when the Power Automate inbox creates data.
    return api.onDataChanged(() => void reload())
  }, [reload])

  const value = useMemo<Db>(() => {
    const apps = new Map(state.applications.map((a) => [a.id, a]))
    const hosts = new Map(state.hosts.map((h) => [h.id, h]))
    const assessments = new Map(state.assessments.map((a) => [a.id, a]))
    return {
      ...state,
      reload,
      create: async (name, data) => {
        const item = await api.create(name, data)
        await reload()
        return item
      },
      update: async (name, id, patch) => {
        const item = await api.update(name, id, patch)
        await reload()
        return item
      },
      remove: async (name, id) => {
        await api.remove(name, id)
        await reload()
      },
      appName: (id) => apps.get(id)?.name ?? '—',
      hostLabel: (id) => {
        const h = hosts.get(id)
        return h ? `${h.hostname || h.ip}${h.hostname && h.ip ? ` (${h.ip})` : ''}` : '—'
      },
      assessmentName: (id) => assessments.get(id)?.name ?? '—'
    }
  }, [state, reload])

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>
}

export function useDb(): Db {
  const db = useContext(DbContext)
  if (!db) throw new Error('useDb outside DbProvider')
  return db
}
