import { useState } from 'react'
import { api } from './api'
import { useDb } from './data'
import { DashboardPage } from './pages/Dashboard'
import { ApplicationsPage } from './pages/Applications'
import { HostsPage } from './pages/Hosts'
import { AssessmentsPage } from './pages/Assessments'
import { RetestsPage } from './pages/Retests'
import { ReportsPage } from './pages/Reports'
import { KnowledgeBasePage } from './pages/KnowledgeBase'
import { SettingsPage } from './pages/Settings'
import { SearchPage } from './pages/Search'
import { ChartsPage } from './pages/Charts'

// Navigation per SRS v5 §1; the top-level Project Code Requests page was
// removed in v6.1 §2 — requests live in each assessment module's Request tab.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'applications', label: 'Applications', icon: '🗂' },
  { id: 'assessments-web', label: 'Web Assessment', icon: '🌐' },
  { id: 'assessments-ie', label: 'Internal / External Assessment', icon: '🧪' },
  { id: 'assessments-host', label: 'Host Assessment', icon: '🖴' },
  { id: 'hosts', label: 'Inventory', icon: '🖥' },
  { id: 'retests', label: 'Post Assessment', icon: '🔁' },
  { id: 'charts', label: 'Charts', icon: '📈' },
  { id: 'reports', label: 'Reports', icon: '📄' },
  { id: 'kb', label: 'Knowledge Base', icon: '📚' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
]

export function App() {
  const db = useDb()
  // Allow deep-linking to a page via #page (e.g. #hosts) for smoke tests / bookmarks.
  const [page, setPage] = useState(() => window.location.hash.slice(1) || 'dashboard')
  const [search, setSearch] = useState('')
  const [showNotifs, setShowNotifs] = useState(false)

  const unread = db.notifications.filter((n) => !n.read).length

  const navigate = (p: string) => {
    setPage(p)
    setSearch('')
    setShowNotifs(false)
    // Operational history (SRS v6.3 §4 "User Activity"); fire-and-forget.
    void api
      .logWrite({ category: 'User Activity', module: 'renderer', source: 'App.tsx', page: p, action: 'navigate', message: `Opened ${p}` })
      .catch(() => {})
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">🛡</span>
          <span>
            TVM <b>Portal</b>
          </span>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id && !search ? 'active' : ''} onClick={() => navigate(n.id)}>
              <span className="nav-icon">{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">Offline · filesystem storage</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <input
            type="search"
            className="global-search"
            placeholder="Search applications, hosts, findings, CVEs, IPs, endpoints…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="bell" onClick={() => setShowNotifs((s) => !s)} title="Notifications">
            🔔{unread > 0 && <span className="bell-count">{unread}</span>}
          </button>
        </header>

        {showNotifs && (
          <div className="notif-panel">
            <h3>Notifications</h3>
            {db.notifications.length === 0 && <p className="muted">Nothing needs attention. 🎉</p>}
            {db.notifications.map((n) => (
              <div key={n.id} className={`notif ${n.read ? 'read' : ''}`}>
                <span>{n.message}</span>
                {!n.read && (
                  <button className="link" onClick={() => db.update('notifications', n.id, { read: true })}>
                    mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <main className="content">
          {db.loading ? (
            <div className="page">Loading data…</div>
          ) : search.trim() ? (
            <SearchPage query={search} onNavigate={navigate} />
          ) : page === 'dashboard' ? (
            <DashboardPage onNavigate={navigate} />
          ) : page === 'applications' ? (
            <ApplicationsPage />
          ) : page === 'assessments-web' ? (
            <AssessmentsPage key="web" category="web" />
          ) : page === 'assessments-ie' ? (
            <AssessmentsPage key="ie" category="internal-external" />
          ) : page === 'assessments-host' ? (
            <AssessmentsPage key="host" category="host" />
          ) : page === 'hosts' ? (
            <HostsPage />
          ) : page === 'retests' ? (
            <RetestsPage />
          ) : page === 'charts' ? (
            <ChartsPage />
          ) : page === 'reports' ? (
            <ReportsPage />
          ) : page === 'kb' ? (
            <KnowledgeBasePage />
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
    </div>
  )
}
