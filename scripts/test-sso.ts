import assert from 'node:assert/strict'
import { createSso } from '../src/main/sso.ts'
import type { SsoSession } from '../src/main/sso.ts'
import { startSsoTestServer } from './sso-test-server.mjs'

async function main() {
  const server = await startSsoTestServer()
  let saved: SsoSession | null = null
  let browserUrl = ''
  const states: unknown[] = []
  const options = { issuer: server.issuer, clientId: 'plkgap-test-client', allowLoopbackIssuer: true,
    openBrowser: async (url: string) => { browserUrl = url },
    store: { read: async () => saved, write: async (value: SsoSession) => { saved = value }, clear: async () => { saved = null } },
    publish: (state: unknown) => states.push(state) }
  let auth = createSso(options)
  const complete = () => fetch(browserUrl)
  try {
    assert.equal((await auth.restore()).status, 'signed-out')
    await auth.login()
    const authorization = new URL(browserUrl)
    assert.equal(authorization.searchParams.get('scope'), 'openid profile organization')
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(authorization.searchParams.has('client_secret'), false)
    const first = browserUrl
    await auth.login()
    assert.equal(browserUrl, first, 'concurrent login reuses the existing flow')
    const invalid = new URL(authorization.searchParams.get('redirect_uri')!)
    invalid.search = '?code=forged&state=wrong'
    assert.equal((await fetch(invalid)).status, 400)
    assert.equal(auth.snapshot().status, 'signing-in', 'wrong state does not consume the legitimate login')
    assert.equal(server.calls.token.length, 0)
    assert.equal((await complete()).status, 200)
    assert.deepEqual(auth.snapshot().profile, { sub: 'test-provider', name: 'สมชาย ทดสอบระบบ',
      position: 'นักวิชาการสาธารณสุข', organization: 'สำนักงานสาธารณสุขจังหวัดพิษณุโลก' })
    assert.ok(saved)
    const token = (saved as SsoSession).accessToken
    assert.ok(!JSON.stringify(states).includes(token), 'renderer events never contain tokens')
    assert.equal(server.calls.token[0].client_secret, undefined)
    auth.stop()
    auth = createSso(options)
    assert.equal((await auth.restore()).status, 'signed-in', 'encrypted remembered account survives restart')
    await auth.logout()
    assert.equal(saved, null)
    assert.equal(server.calls.revoked.at(-1)?.token, token)
    assert.equal(auth.snapshot().profile, null)
    for (const failure of ['nonce', 'issuer', 'audience', 'expired', 'signature', 'subject', 'denied']) {
      server.behavior.failure = failure
      await auth.login()
      await complete()
      assert.equal(auth.snapshot().status, 'signed-out', `reject ${failure}`)
      assert.equal(saved, null, `do not persist ${failure}`)
    }
    server.behavior.failure = ''
    await auth.login()
    await complete()
    auth.stop()
    auth = createSso(options)
    server.behavior.failure = 'revoked'
    assert.equal((await auth.restore()).status, 'signed-in', 'local remembered identity does not require a valid API token')
    assert.ok(saved)
    await auth.logout()
    server.behavior.failure = ''
    server.behavior.tokenDelay = 100
    await auth.login()
    const pending = complete().catch(() => null)
    await new Promise((resolve) => setTimeout(resolve, 30))
    await auth.logout()
    await pending
    assert.equal(auth.snapshot().status, 'signed-out', 'logout cancels an in-flight token exchange')
    assert.equal(saved, null)
    server.behavior.tokenDelay = 0
    auth.stop()
    auth = createSso({ ...options, loginTimeoutMs: 25 })
    await auth.login()
    await new Promise((resolve) => setTimeout(resolve, 75))
    assert.equal(auth.snapshot().status, 'signed-out', 'an abandoned browser login times out')
    auth.stop()
    auth = createSso(options)
    server.behavior.expiresIn = 0.05
    await auth.login()
    await complete()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(auth.snapshot().status, 'signed-in', 'access-token expiry does not log out the local account')
    assert.ok(saved)
    auth.stop()
    auth = createSso({ ...options, issuer: server.issuer })
    assert.equal((await auth.restore()).status, 'signed-in', 'expired token does not prevent account restore')
    const offline = createSso({ ...options, store: options.store })
    await server.close()
    assert.equal((await offline.restore()).status, 'signed-in', 'offline restart restores the remembered account')
    await offline.logout()
    offline.stop()
    assert.equal(saved, null, 'explicit Logout removes the remembered account even offline')
    assert.equal((await createSso(options).restore()).status, 'signed-out', 'restart after Logout stays signed out')
    auth.stop()
    console.log('PASS: SSO PKCE, JWT validation, persistent local account, expired-token and offline restore, explicit logout and cancellation')
  } finally { auth.stop(); await server.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
