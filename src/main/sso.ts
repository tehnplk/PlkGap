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
/** Loopback callback page. Fixed text only: no scripts, no network, no interpolated input. */
const callbackPage = (tone: 'ok' | 'alert', title: string, detail: string, action = '') => `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PLK GAP</title><style>
:root{color-scheme:light dark;--bg:#f6f4fb;--card:#fff;--ink:#2a2440;--muted:#6b6485;--line:#e7e2f3;
--ok:#1f8a5f;--ok-bg:#e4f5ec;--alert:#b1690b;--alert-bg:#fbefdc}
@media(prefers-color-scheme:dark){:root{--bg:#15121d;--card:#211c2d;--ink:#ece9f5;--muted:#a49dbe;--line:#332c45;
--ok:#5fd6a2;--ok-bg:#1d3a2d;--alert:#e7b25d;--alert-bg:#3b2f1a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
background:var(--bg);color:var(--ink);font-family:"Segoe UI",Sarabun,system-ui,-apple-system,sans-serif}
main{width:100%;max-width:400px;padding:40px 32px;text-align:center;background:var(--card);
border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 48px rgba(20,15,40,.22)}
.badge{width:64px;height:64px;margin:0 auto;display:flex;align-items:center;justify-content:center;
border-radius:50%;font-size:32px;line-height:1;background:var(--${tone}-bg);color:var(--${tone})}
h1{margin:22px 0 0;font-size:20px;font-weight:600;line-height:1.5}
p{margin:10px 0 0;font-size:14px;line-height:1.6;color:var(--muted)}
a{display:inline-block;margin-top:24px;padding:11px 26px;border-radius:9px;text-decoration:none;
font-size:15px;font-weight:600;color:#fff;background:#6a4fbf}
a:hover{background:#7b61cc}
a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
small{display:block;margin-top:26px;font-size:12px;letter-spacing:.08em;color:var(--muted)}
</style></head><body>
<main role="dialog" aria-modal="true" aria-labelledby="t">
<div class="badge" aria-hidden="true">${tone === 'ok' ? '&check;' : '!'}</div>
<h1 id="t">${title}</h1><p>${detail}</p>
${action ? `<a href="${action}" autofocus>ตกลง</a>` : ''}
<small>PLK GAP</small>
</main></body></html>`

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
    // SSO discovery now publishes prename/fname/lname, job_position and org_name; older
    // deployments still send name/position/hname. Accept either spelling.
    const name = text(data.name) || `${text(data.prename)}${text(data.fname)} ${text(data.lname)}`.trim()
    return { sub: data.sub, name, position: text(data.position) || text(data.job_position),
      organization: text(data.hname) || text(data.org_name) }
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
        const reply = (status: number, tone: 'ok' | 'alert', title: string, detail: string, action = '') => {
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' })
          res.end(callbackPage(tone, title, detail, action))
        }
        const url = new URL(req.url ?? '/', redirectUri)
        const sameState = () => url.searchParams.getAll('state').length === 1 && equal(url.searchParams.get('state') ?? '', csrf)
        if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${address.port}`) {
          reply(404, 'alert', 'ไม่พบหน้านี้', 'ที่อยู่นี้ใช้สำหรับการเข้าสู่ระบบเท่านั้น'); return
        }
        // The success page's button; the state value keeps other local processes from raising the window.
        if (url.pathname === '/focus') {
          if (!sameState()) { reply(400, 'alert', 'ลิงก์นี้ใช้ไม่ได้แล้ว', 'กรุณาสลับไปที่หน้าต่าง PLK GAP เอง'); return }
          options.onSignedIn?.()
          reply(200, 'ok', 'เปิดหน้าต่าง PLK GAP แล้ว', 'ปิดหน้านี้ได้เลย'); return
        }
        if (url.pathname !== '/callback') {
          reply(404, 'alert', 'ไม่พบหน้านี้', 'ที่อยู่นี้ใช้สำหรับการเข้าสู่ระบบเท่านั้น'); return
        }
        if (!active() || attempt.consumed || !sameState()) {
          reply(400, 'alert', 'ลิงก์นี้ใช้ไม่ได้แล้ว', 'กรุณาเริ่มเข้าสู่ระบบใหม่จาก PLK GAP'); return
        }
        attempt.consumed = true
        if (url.searchParams.has('error')) {
          reply(200, 'alert', 'ยกเลิกการเข้าสู่ระบบแล้ว', 'กลับไปที่ PLK GAP ได้ และปิดหน้านี้ได้เลย')
          fail('ยกเลิกการเข้าสู่ระบบแล้ว'); return
        }
        const code = url.searchParams.get('code')
        if (!code || url.searchParams.getAll('code').length !== 1) {
          reply(400, 'alert', 'เข้าสู่ระบบไม่สำเร็จ', 'ไม่ได้รับรหัสอนุญาต กรุณากลับไปลองใหม่ใน PLK GAP')
          fail('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่'); return
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
            if (!active()) { reply(400, 'alert', 'ยกเลิกการเข้าสู่ระบบแล้ว', 'กลับไปที่ PLK GAP ได้ และปิดหน้านี้ได้เลย'); return }
            const saved: SsoSession = { issuer: options.issuer, clientId: options.clientId,
              accessToken: tokens.access_token, subject: payload.sub,
              expiresAt: Date.now() + Math.min(tokens.expires_in, 3600) * 1000, profile: info }
            phase = 'storage'
            await options.store.write(saved)
            if (!active()) { reply(400, 'alert', 'ยกเลิกการเข้าสู่ระบบแล้ว', 'กลับไปที่ PLK GAP ได้ และปิดหน้านี้ได้เลย'); return }
            session = saved
            publish({ status: 'signed-in', profile: info })
            // The window is raised only when the user confirms, never behind their back.
            reply(200, 'ok', 'เข้าสู่ระบบสำเร็จ', 'กดตกลงเพื่อเปิดหน้าต่าง PLK GAP',
              `/focus?state=${encodeURIComponent(csrf)}`)
            // Serve that confirmation for a short while; Logout, stop() and the grace timer close the listener.
            clearTimeout(attempt.timeout)
            attempt.timeout = setTimeout(() => { if (flow === attempt) stopFlow() }, 120_000)
            attempt.timeout.unref()
          } catch (error) {
            // Diagnostics contain no authorization codes, tokens, profile values, or server response bodies.
            console.error('SSO login rejected:', phase,
              error instanceof SsoHttpError ? `${error.status} ${error.oauthCode}` : error instanceof Error ? error.name : 'unknown')
            reply(400, 'alert', 'เข้าสู่ระบบไม่สำเร็จ', 'กรุณากลับไปลองใหม่ใน PLK GAP')
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
