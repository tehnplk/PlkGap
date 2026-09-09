import { useEffect, useState } from 'react'
import type { UpdateState } from '../../shared/api'

export function UpdateControl() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    let active = true
    let received = false
    const unsubscribe = window.api.onUpdateState((next) => { received = true; if (active) setState(next) })
    void window.api.updateState().then((next) => { if (active && !received) setState(next) })
      .catch(() => { if (active) setState({ status: 'error', message: 'อ่านสถานะอัปเดตไม่สำเร็จ' }) })
    return () => { active = false; unsubscribe() }
  }, [])
  const labels = {
    disabled: 'ตรวจสอบอัปเดต', idle: 'ตรวจสอบอัปเดต', checking: 'กำลังตรวจสอบ…',
    downloading: `กำลังดาวน์โหลด ${state.percent ?? 0}%`, ready: 'เริ่มใหม่เพื่ออัปเดต',
    installing: 'กำลังติดตั้ง…', error: 'ตรวจสอบอัปเดตอีกครั้ง',
  }
  const disabled = ['disabled', 'checking', 'downloading', 'installing'].includes(state.status)
  async function action() {
    try {
      if (state.status === 'ready') await window.api.installUpdate()
      else await window.api.checkForUpdates()
    } catch { setState({ status: 'error', message: 'อัปเดตไม่สำเร็จ กรุณาลองใหม่' }) }
  }
  return <button type="button" className={`update-control ${state.status === 'ready' ? 'update-ready' : ''}`}
    disabled={disabled} title={state.message ?? (state.version ? `เวอร์ชัน ${state.version}` : 'ตรวจสอบเวอร์ชันใหม่')}
    onClick={() => void action()} aria-live="polite">{labels[state.status]}</button>
}
