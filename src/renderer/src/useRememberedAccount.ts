import { useEffect, useState } from 'react'
import type { SsoState } from '../../shared/api'

/**
 * The remembered local account, as the renderer is allowed to see it: status and profile only.
 * Subscribe first, then ask, and ignore the answer once a newer event has arrived — including on
 * the error path, so a late failure cannot replace a state that is already current.
 *
 * This is a UI signal. It says what to show, never what the app is allowed to do: a protected
 * operation is authorized in the main process, from the main-process snapshot.
 */
export function useRememberedAccount() {
  const [state, setState] = useState<SsoState>({ status: 'signed-out', profile: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    let received = false
    const unsubscribe = window.api.onSsoState((next) => {
      received = true
      if (alive) { setState(next); setLoading(false) }
    })
    window.api.ssoState()
      .then((next) => { if (alive && !received) setState(next) })
      .catch(() => { if (alive && !received) setState({ status: 'signed-out', profile: null }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; unsubscribe() }
  }, [])

  return { state, loading, signedIn: state.status === 'signed-in' && !!state.profile }
}
