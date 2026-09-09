import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { DatabaseStatus } from '../../shared/api'
import { CheckProgress } from './CheckProgress'
import { LoginRequiredDialog } from './LoginRequiredDialog'
import { useRememberedAccount } from './useRememberedAccount'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { Import52FilesPage } from './pages/files43/Import52FilesPage'
import { DataCountPage } from './pages/files43/DataCountPage'
import { StructureCheckPage } from './pages/files43/StructureCheckPage'
import { ObservationCheckPage } from './pages/files43/ObservationCheckPage'
import { IndicatorTemplatePage } from './pages/analytics/IndicatorTemplatePage'
import { RevenueTemplatePage } from './pages/analytics/RevenueTemplatePage'
import { HouseholdMapPage } from './pages/mapping/HouseholdMapPage'
import { LineMorPromPage } from './pages/messaging/LineMorPromPage'
import { DenguePage } from './pages/epidemiology/DenguePage'
import { ServiceUnitPage } from './pages/settings/ServiceUnitPage'
import { SubHdcPage } from './pages/settings/SubHdcPage'
import { PlkDashboardPage } from './pages/settings/PlkDashboardPage'
import { DevelopersPage } from './pages/about/DevelopersPage'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'

type Kind =
  | 'import' | 'data-count' | 'structure-check' | 'observation-check'
  | 'kpi-template' | 'revenue-template'
  | 'household-map'
  | 'line-morprom'
  | 'dengue'
  | 'service-unit' | 'subhdc' | 'plk-dashboard'
  | 'developers'
type Child = { id: Kind; x: number; y: number; width: number; height: number; minimized: boolean; maximized: boolean }
type Item = { label: string; action: () => void; disabled?: boolean; hint?: string }
type Group = { id: string; label: string; icon: IconName; collapsed?: boolean; items: Kind[] }

const titles: Record<Kind, string> = {
  import: 'นำเข้าข้อมูล',
  'data-count': 'ปริมาณข้อมูล',
  'structure-check': 'คุณภาพตามโครงสร้าง',
  'observation-check': 'คุณภาพตามข้อสังเกต',
  'kpi-template': 'เทมเพลตตัวชี้วัด',
  'revenue-template': 'เทมเพลตงานจัดเก็บรายได้',
  'household-map': 'ตำแหน่งครัวเรือน (แฟ้ม Home)',
  'line-morprom': 'ส่ง Line หมอพร้อม',
  dengue: 'ไข้เลือดออก',
  'service-unit': 'ตั้งค่าหน่วยบริการ',
  subhdc: 'ตั้งค่าเชื่อมต่อระบบอำเภอ (SUB-HDC)',
  'plk-dashboard': 'ตั้งค่าเชื่อมต่อระบบจังหวัด (PLK Dashboard)',
  developers: 'ผู้พัฒนา',
}
const icons: Record<Kind, IconName> = {
  import: 'upload',
  'data-count': 'counter',
  'structure-check': 'structure',
  'observation-check': 'book',
  'kpi-template': 'gauge',
  'revenue-template': 'money',
  'household-map': 'home',
  'line-morprom': 'send',
  dengue: 'virus',
  'service-unit': 'hospital',
  subhdc: 'link',
  'plk-dashboard': 'dashboard',
  developers: 'users',
}
// Basename of the page component that renders each Kind — shown after the title in window chrome.
const sources: Record<Kind, string> = {
  import: 'Import52FilesPage',
  'data-count': 'DataCountPage',
  'structure-check': 'StructureCheckPage',
  'observation-check': 'ObservationCheckPage',
  'kpi-template': 'IndicatorTemplatePage',
  'revenue-template': 'RevenueTemplatePage',
  'household-map': 'HouseholdMapPage',
  'line-morprom': 'LineMorPromPage',
  dengue: 'DenguePage',
  'service-unit': 'ServiceUnitPage',
  subhdc: 'SubHdcPage',
  'plk-dashboard': 'PlkDashboardPage',
  developers: 'DevelopersPage',
}
const windowTitle = (id: Kind) => `${titles[id]} - ${sources[id]}`
const groups: Group[] = [
  { id: 'files43', label: 'ระบบ 43 แฟ้ม', icon: 'folder', items: ['import', 'structure-check', 'observation-check', 'data-count'] },
  { id: 'analytics', label: 'ระบบวิเคราะห์ข้อมูล', icon: 'chart', items: ['kpi-template', 'revenue-template'] },
  { id: 'mapping', label: 'ระบบแผนที่', icon: 'map', items: ['household-map'] },
  { id: 'messaging', label: 'ระบบสื่อสาร', icon: 'message', items: ['line-morprom'] },
  { id: 'epidemiology', label: 'งานระบาดวิทยาควบคุมโรค', icon: 'activity', items: ['dengue'] },
  { id: 'settings', label: 'ตั้งค่า', icon: 'settings', collapsed: true, items: ['service-unit', 'subhdc', 'plk-dashboard'] },
]
const flushPages: Kind[] = ['household-map']

export function App() {
  const [status, setStatus] = useState<DatabaseStatus>()
  const [error, setError] = useState('')
  const [windows, setWindows] = useState<Child[]>([])
  const [loginRequired, setLoginRequired] = useState(false)
  const { signedIn } = useRememberedAccount()
  // A dev run is never gated: `npm run dev` reloads on every edit, and the shipped bundle is
  // the one that enforces this. Either way it is only the shell pointing at the sign-in button.
  const gated = !import.meta.env.DEV && !signedIn
  // Logging out closes what the gate would no longer let anyone open.
  useEffect(() => { if (gated) { setWindows([]); setLoginRequired(false) } }, [gated])
  const [menu, setMenu] = useState<string | null>(null)
  const [statusbar, setStatusbar] = useState(true)
  const workspace = useRef<HTMLDivElement>(null)
  const menuBar = useRef<HTMLDivElement>(null)
  const active = windows.filter((item) => !item.minimized).at(-1)

  useEffect(() => { window.api.databaseStatus().then(setStatus).catch((reason: unknown) => setError(String(reason))) }, [])
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const area = workspace.current
      if (!area) return
      setWindows((items) => items.map((item) => {
        const width = Math.min(item.width, area.clientWidth)
        const height = Math.min(item.height, area.clientHeight)
        return { ...item, width, height, x: Math.max(0, Math.min(item.x, area.clientWidth - width)), y: Math.max(0, Math.min(item.y, area.clientHeight - height)) }
      }))
    })
    if (workspace.current) observer.observe(workspace.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: globalThis.PointerEvent) => { if (!menuBar.current?.contains(event.target as Node)) setMenu(null) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menu])

  function focus(id: Kind) {
    setWindows((items) => {
      const item = items.find((entry) => entry.id === id)
      return item ? [...items.filter((entry) => entry.id !== id), { ...item, minimized: false }] : items
    })
  }
  function createChildWindow(id: Kind, area: HTMLElement, count: number): Child {
    const width = Math.min(820, area.clientWidth - 32)
    const height = Math.min(520, area.clientHeight - 32)
    const offset = 28 + count * 30
    return {
      id,
      width,
      height,
      x: Math.max(0, Math.min(offset, area.clientWidth - width)),
      y: Math.max(0, Math.min(offset, area.clientHeight - height)),
      minimized: false,
      maximized: true,
    }
  }

  // Every menu and every sidebar item opens a page through here, so the sign-in gate lives here
  // too. It is the shell saying where to sign in, not authorization: that belongs to main.
  function open(id: Kind) {
    if (gated) { setLoginRequired(true); return }
    if (windows.some((item) => item.id === id)) { focus(id); return }
    const area = workspace.current!
    setWindows((items) => [...items, createChildWindow(id, area, items.length)])
  }
  function patch(id: Kind, values: Partial<Child>) { setWindows((items) => items.map((item) => item.id === id ? { ...item, ...values } : item)) }
  function close(id: Kind) { setWindows((items) => items.filter((item) => item.id !== id)) }
  function arrange(mode: 'tile' | 'cascade') {
    const area = workspace.current
    if (!area || !windows.length) return
    const gap = 12, count = windows.length
    const columns = mode === 'tile' ? Math.min(count, Math.max(1, Math.floor(area.clientWidth / 340))) : 1
    const rows = Math.ceil(count / columns)
    setWindows((items) => items.map((item, index) => mode === 'tile'
      ? { ...item, minimized: false, maximized: false, x: gap + (index % columns) * ((area.clientWidth - gap) / columns), y: gap + Math.floor(index / columns) * ((area.clientHeight - gap) / rows), width: (area.clientWidth - gap) / columns - gap, height: (area.clientHeight - gap) / rows - gap }
      : { ...item, minimized: false, maximized: false, x: gap + index * 28, y: gap + index * 28, width: Math.min(760, area.clientWidth - gap * 2 - (count - 1) * 28), height: Math.min(500, area.clientHeight - gap * 2 - (count - 1) * 28) }))
  }
  function move(event: PointerEvent<HTMLElement>, item: Child, resize = false) {
    if (event.button !== 0 || item.maximized || (!resize && (event.target as HTMLElement).closest('button'))) return
    event.preventDefault()
    focus(item.id)
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX, startY = event.clientY
    const onMove = (next: globalThis.PointerEvent) => {
      const area = workspace.current!
      const dx = next.clientX - startX, dy = next.clientY - startY
      patch(item.id, resize
        ? { width: Math.min(area.clientWidth - item.x, Math.max(300, item.width + dx)), height: Math.min(area.clientHeight - item.y, Math.max(180, item.height + dy)) }
        : { x: Math.max(0, Math.min(item.x + dx, area.clientWidth - item.width)), y: Math.max(0, Math.min(item.y + dy, area.clientHeight - item.height)) })
    }
    const stop = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', stop); target.removeEventListener('pointercancel', stop); target.removeEventListener('lostpointercapture', stop) }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', stop)
    target.addEventListener('pointercancel', stop)
    target.addEventListener('lostpointercapture', stop)
  }

  const menus: Record<string, Item[]> = {
    File: [{ label: titles.import, action: () => open('import') }, { label: titles['household-map'], action: () => open('household-map') }, { label: titles['service-unit'], action: () => open('service-unit') }, { label: 'Close active window', action: () => active && close(active.id), disabled: !active }, { label: 'Exit', action: () => window.close() }],
    View: [{ label: 'Status bar', action: () => setStatusbar(!statusbar), hint: statusbar ? 'On' : 'Off' }],
    Window: [{ label: 'Cascade windows', action: () => arrange('cascade'), disabled: !windows.length }, { label: 'Tile windows', action: () => arrange('tile'), disabled: !windows.length }, { label: 'Close all windows', action: () => setWindows([]), disabled: !windows.length }, ...windows.map((item) => ({ label: windowTitle(item.id), action: () => focus(item.id), hint: item.minimized ? 'Minimized' : active?.id === item.id ? 'Active' : '' }))],
    'เกี่ยวกับ': [{ label: titles.developers, action: () => open('developers') }],
  }
  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLButtonElement
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-menu-button]'))
    const entries = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.menu-popup button:not(:disabled)'))
    if (event.key === 'Escape') { setMenu(null); buttons.find((button) => button.textContent === menu)?.focus(); event.preventDefault() }
    if (event.key === 'Tab') setMenu(null)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (target.hasAttribute('data-menu-button')) {
        setMenu(target.textContent)
        requestAnimationFrame(() => menuBar.current?.querySelector<HTMLButtonElement>('.menu-popup button:not(:disabled)')?.focus())
      } else { const index = entries.indexOf(target); entries[(index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus() }
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const current = buttons.findIndex((button) => button.textContent === menu || button === target)
      const next = buttons[(current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]
      next?.focus()
      if (menu && next) setMenu(next.textContent)
    }
  }
  const connected = status ? 'Connected' : error ? 'Connection error' : 'Connecting'
  return <main className="app-shell">
    <TitleBar>
    <div className="menu-bar" role="menubar" aria-label="Main menu" ref={menuBar} onKeyDown={menuKeys}>
      {Object.entries(menus).map(([name, items]) => <div className="menu-group" key={name} role="none"><button role="menuitem" data-menu-button aria-haspopup="menu" aria-expanded={menu === name} className={menu === name ? 'menu-trigger selected' : 'menu-trigger'} onClick={() => setMenu(menu === name ? null : name)}>{name}</button>{menu === name && <div className="menu-popup" role="menu" aria-label={name}>{items.map((item) => <button role="menuitem" key={item.label} disabled={item.disabled} onClick={() => { item.action(); setMenu(null); menuBar.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus() }}><span>{item.label}</span>{item.hint && <small>{item.hint}</small>}</button>)}</div>}</div>)}
    </div>
    </TitleBar>
    <div className="desktop-body">
      <Sidebar activeId={active?.id} groups={groups.map((group) => ({ id: group.id, label: group.label, icon: group.icon, collapsed: group.collapsed, items: group.items.map((id) => ({ id, label: titles[id], icon: icons[id], onClick: () => open(id) })) }))} />
    <div className="child-area">
    <div className="workspace" ref={workspace} aria-label="MDI workspace">
      {windows.map((item, index) => !item.minimized && <section key={item.id} role="region" aria-label={`${windowTitle(item.id)} window`} className={`child-window ${active?.id === item.id ? 'active' : ''} ${item.maximized ? 'maximized' : ''}`} style={{ left: item.maximized ? 0 : item.x, top: item.maximized ? 0 : item.y, width: item.maximized ? '100%' : item.width, height: item.maximized ? '100%' : item.height, zIndex: index + 1 }} onPointerDown={() => focus(item.id)} onFocusCapture={() => { if (active?.id !== item.id) focus(item.id) }}>
        <div className="window-titlebar" onPointerDown={(event) => move(event, item)} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button')) patch(item.id, { maximized: !item.maximized }) }}><span><Icon name={icons[item.id]} size={15} />{windowTitle(item.id)}</span><div className="window-controls"><button aria-label={`Minimize ${windowTitle(item.id)}`} onClick={() => patch(item.id, { minimized: true })}><Icon name="minimize" size={14} /></button><button aria-label={`${item.maximized ? 'Restore' : 'Maximize'} ${windowTitle(item.id)}`} onClick={() => patch(item.id, { maximized: !item.maximized })}><Icon name={item.maximized ? 'restore' : 'maximize'} size={13} /></button><button className="close-control" aria-label={`Close ${windowTitle(item.id)}`} onClick={() => close(item.id)}><Icon name="close" size={16} /></button></div></div>
        <div className={flushPages.includes(item.id) ? 'window-content flush' : 'window-content'}>
          {item.id === 'import' && <Import52FilesPage />}
          {item.id === 'data-count' && <DataCountPage />}
          {item.id === 'structure-check' && <StructureCheckPage />}
          {item.id === 'observation-check' && <ObservationCheckPage />}
          {item.id === 'kpi-template' && <IndicatorTemplatePage />}
          {item.id === 'revenue-template' && <RevenueTemplatePage />}
          {item.id === 'household-map' && <HouseholdMapPage />}
          {item.id === 'line-morprom' && <LineMorPromPage />}
          {item.id === 'dengue' && <DenguePage />}
          {item.id === 'service-unit' && <ServiceUnitPage />}
          {item.id === 'subhdc' && <SubHdcPage />}
          {item.id === 'plk-dashboard' && <PlkDashboardPage />}
          {item.id === 'developers' && <DevelopersPage />}
        </div>
        {!item.maximized && <div className="resize-handle" onPointerDown={(event) => move(event, item, true)} aria-hidden="true" />}
      </section>)}
    {windows.some((item) => item.minimized) && <div className="window-dock" aria-label="Open windows">{windows.filter((item) => item.minimized).map((item) => <button key={item.id} className={active?.id === item.id ? 'active' : ''} onClick={() => focus(item.id)} aria-pressed={active?.id === item.id} title={item.minimized ? `Restore ${windowTitle(item.id)}` : windowTitle(item.id)}><Icon name={icons[item.id]} size={15} />{windowTitle(item.id)}{item.minimized && <Icon name="minimize" size={12} />}</button>)}</div>}
    </div>
    {statusbar && <footer className="status-bar"><span role="status"><span className={`dot ${error ? 'error-dot' : !status ? 'pending-dot' : ''}`} />{connected}</span><span className="status-divider" /><span>{status ? `${status.referenceTables} ตารางอ้างอิง · ${status.referenceRows.toLocaleString('en-US')} รายการ · ${status.fileTables} แฟ้มพร้อมนำเข้า` : 'Local database'}</span><span className="status-end">{active ? windowTitle(active.id) : 'Ready'}<span className="status-divider" />PlkGap<CheckProgress /></span></footer>}
    </div>
    </div>
    <LoginRequiredDialog open={loginRequired} onClose={() => setLoginRequired(false)} />
  </main>
}
