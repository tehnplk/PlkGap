import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { SsoProfile, SsoState } from '../shared/api'

export interface SsoSession {
  issuer: string
  clientId: string
  accessToken: string
  subject: string
  expiresAt: number
  /** Remembered local account, not proof of an unexpired SSO access token. */
  profile?: SsoProfile
}
export interface SsoStore {
  read(): Promise<SsoSession | null>
  write(session: SsoSession): Promise<void>
  clear(): Promise<void>
}
interface Options {
  issuer: string
  clientId: string
  openBrowser(url: string): Promise<unknown>
  store: SsoStore
  publish(state: SsoState): void
  onSignedIn?(): void
  /** Only the isolated test runner supplies a local mock issuer. */
  allowLoopbackIssuer?: boolean
  loginTimeoutMs?: number
}
interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  revocation_endpoint: string
  jwks_uri: string
}
class InvalidToken extends Error {}
class SsoHttpError extends Error {
  constructor(readonly status: number, readonly oauthCode: string) { super('SSO request failed') }
}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createSso(options: Options) {
  const issuer = new URL(options.issuer)
  if (issuer.protocol !== 'https:' && !(options.allowLoopbackIssuer && issuer.protocol === 'http:' && issuer.hostname === '127.0.0.1')) {
    throw new Error('SSO issuer must use HTTPS')
  }
  let state: SsoState = { status: 'signed-out', profile: null }
  let session: SsoSession | null = null
  let flow: { controller: AbortController; server: Server; timeout?: NodeJS.Timeout; consumed: boolean } | null = null
  let stopped = false
  let revision = 0
  const snapshot = (): SsoState => ({ ...state, profile: state.profile ? { ...state.profile } : null })
  const publish = (next: SsoState) => { state = next; options.publish(snapshot()) }
  const stopFlow = () => {
    if (!flow) return
    flow.controller.abort()
    clearTimeout(flow.timeout)
    flow.server.close()
    flow = null
  }
  async function request(url: string, init: RequestInit = {}, signal?: AbortSignal) {
    const response = await fetch(url, { ...init, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    if (response.status === 401) throw new InvalidToken()
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      const code = typeof error.error === 'string' && /^[a-z_]{1,40}$/.test(error.error) ? error.error : 'unknown'
      throw new SsoHttpError(response.status, code)
    }
    return response.json()
  }
  async function discovery(signal?: AbortSignal): Promise<Discovery> {
    const data = await request(new URL('/.well-known/openid-configuration', issuer).href, {}, signal)
    if (data.issuer !== options.issuer) throw new Error('SSO issuer mismatch')
    for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'revocation_endpoint', 'jwks_uri']) {
      const endpoint = new URL(data[key])
      if (endpoint.origin !== issuer.origin || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Untrusted SSO endpoint')
    }
    return data
  }
  async function profile(metadata: Discovery, accessToken: string, subject: string, signal?: AbortSignal): Promise<SsoProfile> {
    const data = await request(metadata.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } }, signal)
    if (!text(data.sub) || data.sub !== subject) throw new Error('SSO subject mismatch')
    return { sub: data.sub, name: text(data.name), position: text(data.position), organization: text(data.hname) }
  }
  async function restore() {
    const current = revision
    try {
      const saved = await options.store.read()
      if (current !== revision || stopped) return snapshot()
      if (!saved) return snapshot()
      if (saved.issuer !== options.issuer || saved.clientId !== options.clientId || !saved.accessToken || !saved.subject
        || !Number.isFinite(saved.expiresAt)) {
        await options.store.clear()
        return snapshot()
      }
      let info = saved.profile
      if (info) {
        if (info.sub !== saved.subject || typeof info.name !== 'string' || typeof info.position !== 'string'
          || typeof info.organization !== 'string') throw new Error('Invalid saved account')
      } else {
        // Migrate older encrypted sessions only while their token is still valid.
        if (saved.expiresAt <= Date.now()) return snapshot()
        info = await profile(await discovery(), saved.accessToken, saved.subject)
        if (current !== revision || stopped) return snapshot()
        saved.profile = info
        await options.store.write(saved)
      }
      if (current !== revision || stopped) return snapshot()
      session = saved
      publish({ status: 'signed-in', profile: info })
    } catch (error) {
      if (current !== revision || stopped) return snapshot()
      await options.store.clear().catch(() => {})
      publish({ status: 'signed-out', profile: null,
        error: error instanceof InvalidToken ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'เชื่อมต่อ SSO ไม่สำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง' })
    }
    return snapshot()
  }
  async function login() {
    if (stopped || state.status === 'signing-in' || state.status === 'signed-in') return snapshot()
    const current = ++revision
    publish({ status: 'signing-in', profile: null })
    const controller = new AbortController()
    const server = createServer()
    const attempt = { controller, server, consumed: false, timeout: undefined as NodeJS.Timeout | undefined }
    flow = attempt
    const active = () => !stopped && flow === attempt && revision === current && !controller.signal.aborted
    const fail = (message: string) => {
      if (!active()) return
      stopFlow()
      publish({ status: 'signed-out', profile: null, error: message })
    }
    try {
      const metadata = await discovery(controller.signal)
      if (!active()) return snapshot()
      const verifier = randomBytes(32).toString('base64url')
      const nonce = randomBytes(32).toString('base64url')
      const csrf = randomBytes(32).toString('base64url')
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      if (!active()) { server.close(); return snapshot() }
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Invalid callback listener')
      const redirectUri = `http://127.0.0.1:${address.port}/callback`
      server.on('request', (req, res) => {
        const reply = (status: number, message: string) => {
          res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' })
          res.end(message)
        }
        const url = new URL(req.url ?? '/', redirectUri)
        if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${address.port}` || url.pathname !== '/callback') {
          reply(404, 'Not found'); return
        }
        if (!active() || attempt.consumed || url.searchParams.getAll('state').length !== 1 || !equal(url.searchParams.get('state') ?? '', csrf)) {
          reply(400, 'Invalid login state'); return
        }
        attempt.consumed = true
        if (url.searchParams.has('error')) {
          reply(200, 'ยกเลิกการเข้าสู่ระบบแล้ว กลับไปที่ PLK GAP ได้')
          fail('ยกเลิกการเข้าสู่ระบบแล้ว'); return
        }
        const code = url.searchParams.get('code')
        if (!code || url.searchParams.getAll('code').length !== 1) {
          reply(400, 'Missing authorization code'); fail('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่'); return
        }
        void (async () => {
          let phase = 'token'
          try {
            const tokens = await request(metadata.token_endpoint, { method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ grant_type: 'authorization_code', client_id: options.clientId,
                code, redirect_uri: redirectUri, code_verifier: verifier }).toString() }, controller.signal)
            phase = 'token-shape'
            if (!text(tokens.access_token) || !text(tokens.id_token) || tokens.token_type?.toLowerCase() !== 'bearer'
              || typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('Invalid tokens')
            phase = 'jwks'
            const keys = createLocalJWKSet(await request(metadata.jwks_uri, {}, controller.signal))
            phase = 'id-token'
            const { payload } = await jwtVerify(tokens.id_token, keys, { issuer: options.issuer, audience: options.clientId,
              algorithms: ['RS256'], requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce'] })
            if (payload.nonce !== nonce || !payload.sub || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== options.clientId)
              || (payload.azp !== undefined && payload.azp !== options.clientId)) throw new Error('Invalid ID token claims')
            phase = 'userinfo'
            const info = await profile(metadata, tokens.access_token, payload.sub, controller.signal)
            if (!active()) { reply(400, 'Login cancelled'); return }
            const saved: SsoSession = { issuer: options.issuer, clientId: options.clientId,
              accessToken: tokens.access_token, subject: payload.sub,
              expiresAt: Date.now() + Math.min(tokens.expires_in, 3600) * 1000, profile: info }
            phase = 'storage'
            await options.store.write(saved)
            if (!active()) { reply(400, 'Login cancelled'); return }
            session = saved
            publish({ status: 'signed-in', profile: info })
            reply(200, 'เข้าสู่ระบบสำเร็จ กลับไปที่ PLK GAP ได้ และปิดหน้านี้ได้เลย')
            stopFlow()
            options.onSignedIn?.()
          } catch (error) {
            // Diagnostics contain no authorization codes, tokens, profile values, or server response bodies.
            console.error('SSO login rejected:', phase,
              error instanceof SsoHttpError ? `${error.status} ${error.oauthCode}` : error instanceof Error ? error.name : 'unknown')
            reply(400, 'เข้าสู่ระบบไม่สำเร็จ กรุณากลับไปลองใหม่ใน PLK GAP')
            fail('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่')
          }
        })()
      })
      attempt.timeout = setTimeout(() => fail('หมดเวลาการเข้าสู่ระบบ กรุณาลองใหม่'), options.loginTimeoutMs ?? 300_000)
      attempt.timeout.unref()
      const authorization = new URL(metadata.authorization_endpoint)
      authorization.search = new URLSearchParams({ response_type: 'code', client_id: options.clientId,
        redirect_uri: redirectUri, scope: 'openid profile organization', state: csrf, nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
      await options.openBrowser(authorization.href)
    } catch {
      fail('เปิดการเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่')
    }
    return snapshot()
  }
  async function logout() {
    ++revision
    stopFlow()
    const previous = session
    session = null
    publish({ status: 'signed-out', profile: null })
    await options.store.clear()
    if (previous) {
      try {
        const metadata = await discovery()
        await fetch(metadata.revocation_endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: previous.accessToken, token_type_hint: 'access_token', client_id: options.clientId }).toString() })
      } catch { /* The local session is already cleared; tokens have a bounded server lifetime. */ }
    }
    return snapshot()
  }
  return { snapshot, restore, login, logout,
    stop() { stopped = true; ++revision; stopFlow() } }
}
