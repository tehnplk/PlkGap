import { useEffect, useRef, useState } from 'react'
import type { SsoState } from '../../shared/api'
import { Icon } from './Icon'
import { readTheme, saveTheme } from './theme'
import { GatewayToggle } from './GatewayToggle'

export function AccountFooter({ expanded }: { expanded: boolean }) {
  const [theme, setTheme] = useState(readTheme)
  const [state, setState] = useState<SsoState>({ status: 'signed-out', profile: null })
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    let received = false
    const unsubscribe = window.api.onSsoState((next) => {
      received = true
      if (alive) { setState(next); setLoading(false) }
    })
    window.api.ssoState().then((next) => { if (alive && !received) setState(next) })
      .catch(() => { if (alive) setState({ status: 'signed-out', profile: null, error: 'โหลดบัญชีไม่สำเร็จ' }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; unsubscribe() }
  }, [])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => { if (!state.profile) setOpen(false) }, [state.profile])
  async function act(action: 'login' | 'logout') {
    setBusy(true)
    setOpen(false)
    try { setState(await (action === 'login' ? window.api.ssoLogin() : window.api.ssoLogout())) }
    catch { setState((current) => ({ ...current, error: 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่' })) }
    finally { setBusy(false); trigger.current?.focus() }
  }
  const signingIn = state.status === 'signing-in'
  const name = state.profile?.name || 'บัญชีผู้ใช้'
  const label = loading ? 'กำลังโหลดบัญชี' : signingIn ? 'กำลังเข้าสู่ระบบ…' : state.profile ? name : 'เข้าสู่ระบบ'
  return <div className="account-footer" ref={root} onBlur={(event) => {
    // Disabling an in-flight settings button can blur it with no next target.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    {state.error && <p className="account-error" role="alert" title={state.error}>{expanded ? state.error : '!'}</p>}
    {open && state.profile && <div className="account-popup" role="dialog" aria-label="บัญชีผู้ใช้" ref={popup}>
      <div className="account-theme">
        <span>Light / Dark</span>
        <button className="theme-toggle" role="switch" aria-label="Dark theme" aria-checked={theme === 'dark'}
          onClick={() => {
            const next = theme === 'light' ? 'dark' : 'light'
            saveTheme(next); setTheme(next)
          }}><span aria-hidden="true" className="theme-track"><span /></span>{theme === 'dark' ? 'Dark' : 'Light'}</button>
      </div>
      <GatewayToggle />
      <dl>
        <div><dt>ชื่อ นามสกุล</dt><dd>{name}</dd></div>
        <div><dt>ตำแหน่ง</dt><dd>{state.profile.position || 'ไม่ระบุ'}</dd></div>
        <div><dt>หน่วยงาน</dt><dd>{state.profile.organization || 'ไม่ระบุ'}</dd></div>
      </dl>
      <button className="account-logout" disabled={busy} onClick={() => void act('logout')}>Logout</button>
    </div>}
    <button ref={trigger} className="account-trigger" title={label} aria-label={label}
      aria-haspopup={state.profile ? 'dialog' : undefined} aria-expanded={state.profile ? open : undefined}
      disabled={loading || busy} onClick={() => {
        if (state.profile) setOpen(!open)
        else if (signingIn) void act('logout')
        else void act('login')
      }} onKeyDown={(event) => {
        if (event.key === 'ArrowUp' && state.profile) {
          event.preventDefault(); setOpen(true)
          requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>('button')?.focus())
        }
      }}>
      <span className="account-avatar" aria-hidden="true">{state.profile?.name?.trim().slice(0, 1) || <Icon name="users" size={17} />}</span>
      {expanded && <><span className="account-name">{label}{signingIn && <small>คลิกเพื่อยกเลิก</small>}</span>
        {state.profile && <span className="account-arrow"><Icon name="chevron" size={13} /></span>}</>}
    </button>
  </div>
}
