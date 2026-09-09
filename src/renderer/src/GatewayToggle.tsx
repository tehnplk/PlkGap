import { useEffect, useState } from 'react'
import type { GatewayState } from '../../shared/api'

export function GatewayToggle() {
  const [state, setState] = useState<GatewayState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    window.api.gatewayState().then(value => { if (alive) setState(value) })
      .catch(() => { if (alive) setError('โหลดสถานะ API Gateway ไม่สำเร็จ') })
    return () => { alive = false }
  }, [])
  async function toggle() {
    if (!state || busy) return
    setBusy(true); setError('')
    try { setState(await window.api.setGatewayEnabled(!state.enabled)) }
    catch { setError('เปลี่ยนสถานะ API Gateway ไม่สำเร็จ กรุณาลองใหม่') }
    finally { setBusy(false) }
  }
  return <>
    <div className="account-theme">
      <span>API Gateway{state && <small className="gateway-port">127.0.0.1:{state.port}</small>}</span>
      <button className="theme-toggle" role="switch" aria-label="API Gateway" aria-checked={state?.enabled ?? false}
        disabled={!state || busy} onClick={() => void toggle()}>
        <span aria-hidden="true" className="theme-track"><span /></span>
        {busy ? '…' : !state ? '…' : state.listening ? 'เปิด' : state.enabled ? 'ไม่พร้อม' : 'ปิด'}
      </button>
    </div>
    {(error || state?.error) && <p className="account-error" role="alert">{error || state?.error}</p>}
  </>
}
