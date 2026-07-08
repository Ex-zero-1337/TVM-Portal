import { useEffect, useState } from 'react'
import type { Appearance } from '@shared/types'

/**
 * Appearance support (SRS v6): 'light' | 'dark' | 'system'. The resolved theme
 * is stamped on <html data-theme="…">; styles.css defaults to dark and carries
 * a [data-theme='light'] override block. In 'system' mode the OS theme is
 * followed live via prefers-color-scheme (Electron keeps this in sync with the
 * OS), so no restart is needed.
 */

const media = window.matchMedia('(prefers-color-scheme: dark)')
let mode: Appearance = 'dark'

function resolved(): 'light' | 'dark' {
  if (mode === 'system') return media.matches ? 'dark' : 'light'
  return mode
}

export function applyAppearance(next: Appearance): void {
  mode = next
  document.documentElement.dataset.theme = resolved()
  window.dispatchEvent(new Event('tvm-themechange'))
}

media.addEventListener('change', () => {
  if (mode === 'system') applyAppearance('system')
})

/** The theme currently in effect — re-renders when the appearance changes. */
export function useEffectiveTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState(resolved)
  useEffect(() => {
    const onChange = () => setTheme(resolved())
    window.addEventListener('tvm-themechange', onChange)
    return () => window.removeEventListener('tvm-themechange', onChange)
  }, [])
  return theme
}
