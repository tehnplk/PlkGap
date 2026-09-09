import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { UpdateControl } from './UpdateControl'

export function TitleBar({ children }: { children: ReactNode }) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const unsubscribe = window.api.onWindowMaximized(setMaximized)
    void window.api.isWindowMaximized().then(setMaximized)
    return unsubscribe
  }, [])

  return <header className="main-titlebar" aria-label="Application title bar">
    <span className="main-app-icon"><Icon name="grid" size={14} /></span>
    {children}
    <span className="main-title">PLK GAP{' '}<span className="main-version">version {__APP_VERSION__}</span></span>
    <UpdateControl />
    <div className="main-window-controls">
      <button aria-label="Minimize application" title="Minimize" onClick={() => void window.api.minimizeWindow()}><Icon name="minimize" size={14} /></button>
      <button aria-label={maximized ? 'Restore application' : 'Maximize application'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => void window.api.toggleMaximizeWindow()}><Icon name={maximized ? 'restore' : 'maximize'} size={12} /></button>
      <button className="main-close" aria-label="Close application" title="Close" onClick={() => void window.api.closeWindow()}><Icon name="close" size={16} /></button>
    </div>
  </header>
}
