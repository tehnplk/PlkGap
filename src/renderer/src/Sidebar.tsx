import { Icon } from './Icon'
import type { IconName } from './Icon'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'

interface SidebarItem {
  id: string
  label: string
  icon: IconName
  onClick: () => void
}

interface SidebarProps {
  activeId?: string
  items: SidebarItem[]
}

export function Sidebar({ activeId, items }: SidebarProps) {
  const sidebar = useRef<HTMLElement>(null)
  const lastWidth = useRef(220)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [width, setWidth] = useState(220)
  const [maximum, setMaximum] = useState(220)
  const [dragging, setDragging] = useState(false)
  const expanded = width > 44

  useEffect(() => {
    const parent = sidebar.current!.parentElement!
    const observer = new ResizeObserver(() => {
      const limit = parent.clientWidth / 2
      setMaximum(limit)
      setWidth((current) => Math.min(current, limit))
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  function resize(requested: number) {
    const limit = sidebar.current!.parentElement!.clientWidth / 2
    const next = requested < 100 ? 44 : Math.min(limit, Math.max(140, requested))
    if (next > 44) lastWidth.current = next
    setWidth(next)
  }

  function onToggle() {
    if (expanded) { lastWidth.current = width; setWidth(44) }
    else resize(lastWidth.current)
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width }
    setDragging(true)
  }

  function endDrag() { drag.current = null; setDragging(false) }

  return <aside ref={sidebar} style={{ width, maxWidth: '50%' }} className={`sidebar ${expanded ? 'expanded' : 'collapsed'} ${dragging ? 'dragging' : ''}`} aria-label="Sidebar">
    <div className="sidebar-header">
      {expanded && <strong>PlkGap</strong>}
      <button className="sidebar-toggle" onClick={onToggle} aria-expanded={expanded} aria-controls="sidebar-navigation" aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
      </button>
    </div>
    <nav id="sidebar-navigation" aria-label="Sidebar navigation">
      {expanded && <p className="sidebar-label">Workspace</p>}
      {items.map((item) => <button key={item.id} className={activeId === item.id ? 'sidebar-item active' : 'sidebar-item'} onClick={item.onClick} aria-label={item.label} aria-current={activeId === item.id ? 'page' : undefined} title={item.label}>
        <Icon name={item.icon} size={17} />
        {expanded && <span>{item.label}</span>}
      </button>)}
    </nav>
    <div className="sidebar-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={44} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={expanded ? `${Math.round(width)} pixels` : 'Collapsed'} tabIndex={0}
      onPointerDown={startDrag}
      onPointerMove={(event) => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x) }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onDoubleClick={onToggle}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Enter') onToggle()
        else if (event.key === 'Home') resize(44)
        else if (event.key === 'End') resize(maximum)
        else if (event.key === 'ArrowRight') resize(expanded ? width + 20 : 140)
        else resize(width <= 140 ? 44 : width - 20)
      }} />
  </aside>
}
