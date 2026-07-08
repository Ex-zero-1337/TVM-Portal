import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DbProvider } from './data'
import { api } from './api'
import { applyAppearance } from './theme'
import './styles.css'

// Restore the persisted appearance before first paint settles (SRS v6 §3.5).
void api.getSettings().then((s) => applyAppearance(s.appearance ?? 'system'))

// Renderer runtime/coding error capture (SRS v6.3 §7): forwarded to the
// centralized log with the active page; fire-and-forget so logging can never
// break the UI.
const logRendererError = (message: string, detail: unknown) => {
  const stack = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail ?? '')
  void api
    .logWrite({
      level: 'ERROR',
      category: 'Coding Errors',
      module: 'renderer',
      source: 'window',
      page: window.location.hash.slice(1) || 'dashboard',
      action: 'runtime error',
      message,
      details: stack.split('\n').slice(0, 12).join('\n')
    })
    .catch(() => {})
}
window.addEventListener('error', (e) => logRendererError(e.message, e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => logRendererError('Unhandled promise rejection', e.reason))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DbProvider>
      <App />
    </DbProvider>
  </StrictMode>
)
