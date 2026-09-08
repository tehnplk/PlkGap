import { Icon } from './Icon'
import type { IconName } from './Icon'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'

export interface SidebarItem {
  id: string
  label: string
  icon: IconName
  onClick: () => void
}

export interface SidebarGroup {
  id: string
  label: string
  icon: IconName
  /** Start folded away — for groups that are opened rarely. */
  collapsed?: boolean
  items: SidebarItem[]
}

interface SidebarProps {
  activeId?: string
  groups: SidebarGroup[]
}

export function Sidebar({ activeId, groups }: SidebarProps) {
  const sidebar = useRef<HTMLElement>(null)
  const lastWidth = useRef(240)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [width, setWidth] = useState(240)
  const [maximum, setMaximum] = useState(240)
  const [dragging, setDragging] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(
    () => groups.filter((group) => group.collapsed).map((group) => group.id))
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
    const next = requested < 100 ? 44 : Math.min(limit, Math.max(160, requested))
    if (next > 44) lastWidth.current = next
    setWidth(next)
  }

  function onToggle() {
    if (expanded) { lastWidth.current = width; setWidth(44) }
    else resize(lastWidth.current)
  }

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
  }

  function onGroupClick(id: string) {
    if (expanded) { toggleGroup(id); return }
    setCollapsedGroups((current) => current.filter((entry) => entry !== id))
    resize(lastWidth.current)
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
      {expanded && <strong>PLK GAP</strong>}
      <button className="sidebar-toggle" onClick={onToggle} aria-expanded={expanded} aria-controls="sidebar-navigation" aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
      </button>
    </div>
    <nav id="sidebar-navigation" aria-label="Sidebar navigation">
      {groups.map((group) => {
        const open = expanded && !collapsedGroups.includes(group.id)
        return <div className="sidebar-group" key={group.id}>
          <button
            className={`sidebar-group-header ${group.items.some((item) => item.id === activeId) ? 'has-active' : ''}`}
            onClick={() => onGroupClick(group.id)}
            aria-expanded={open}
            aria-controls={`sidebar-group-${group.id}`}
            title={group.label}
          >
            <Icon name={group.icon} size={17} />
            {expanded && <>
              <span>{group.label}</span>
              <span className="sidebar-chevron"><Icon name="chevron" size={13} /></span>
            </>}
          </button>
          <div className="sidebar-group-items" id={`sidebar-group-${group.id}`} hidden={!open}>
            {group.items.map((item) => <button key={item.id} className={activeId === item.id ? 'sidebar-item active' : 'sidebar-item'} onClick={item.onClick} aria-current={activeId === item.id ? 'page' : undefined} title={item.label}>
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </button>)}
          </div>
        </div>
      })}
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
        else if (event.key === 'ArrowRight') resize(expanded ? width + 20 : 160)
        else resize(width <= 160 ? 44 : width - 20)
      }} />
  </aside>
}
