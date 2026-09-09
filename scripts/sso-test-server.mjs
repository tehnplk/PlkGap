import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'

export async function startSsoTestServer() {
  const pair = await generateKeyPair('RS256')
  const other = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
  const codes = new Map()
  const tokens = new Set()
  const behavior = { failure: '', tokenDelay: 0, expiresIn: 3600 }
  const calls = { authorization: [], token: [], revoked: [] }
  let issuer = ''
  const server = createServer((req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    void (async () => {
      const url = new URL(req.url, issuer)
      if (url.pathname === '/.well-known/openid-configuration') return json(200, {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`, revocation_endpoint: `${issuer}/revoke`, jwks_uri: `${issuer}/jwks`,
      })
      if (url.pathname === '/jwks') return json(200, { keys: [jwk] })
      if (url.pathname === '/authorize') {
        calls.authorization.push(Object.fromEntries(url.searchParams))
        const code = randomUUID()
        codes.set(code, Object.fromEntries(url.searchParams))
        const redirect = new URL(url.searchParams.get('redirect_uri'))
        redirect.searchParams.set('state', url.searchParams.get('state'))
        if (behavior.failure === 'denied') redirect.searchParams.set('error', 'access_denied')
        else redirect.searchParams.set('code', code)
        res.writeHead(302, { Location: redirect.href }); res.end(); return
      }
      if (url.pathname === '/token') {
        let raw = ''
        for await (const part of req) raw += part
        const data = new URLSearchParams(raw)
        calls.token.push(Object.fromEntries(data))
        const authorization = codes.get(data.get('code'))
        codes.delete(data.get('code'))
        if (!authorization || data.has('client_secret') || req.headers.authorization
          || data.get('client_id') !== authorization.client_id || data.get('redirect_uri') !== authorization.redirect_uri
          || authorization.code_challenge_method !== 'S256'
          || createHash('sha256').update(data.get('code_verifier') ?? '').digest('base64url') !== authorization.code_challenge) {
          return json(400, { error: 'invalid_grant' })
        }
        if (behavior.tokenDelay) await new Promise((resolve) => setTimeout(resolve, behavior.tokenDelay))
        const token = randomUUID()
        tokens.add(token)
        const idToken = await new SignJWT({ nonce: behavior.failure === 'nonce' ? 'wrong' : authorization.nonce })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject('test-provider')
          .setIssuer(behavior.failure === 'issuer' ? 'https://wrong.example' : issuer)
          .setAudience(behavior.failure === 'audience' ? 'wrong-client' : authorization.client_id)
          .setIssuedAt().setExpirationTime(behavior.failure === 'expired' ? Math.floor(Date.now() / 1000) - 60 : '1h')
          .sign(behavior.failure === 'signature' ? other.privateKey : pair.privateKey)
        return json(200, { access_token: token, token_type: 'Bearer', expires_in: behavior.expiresIn, id_token: idToken })
      }
      if (url.pathname === '/userinfo') {
        if (behavior.failure === 'revoked' || !tokens.has(req.headers.authorization?.replace(/^Bearer /, ''))) {
          return json(401, { error: 'invalid_token' })
        }
        return json(200, { sub: behavior.failure === 'subject' ? 'wrong-subject' : 'test-provider',
          name: 'สมชาย ทดสอบระบบ', position: 'นักวิชาการสาธารณสุข', hname: 'สำนักงานสาธารณสุขจังหวัดพิษณุโลก',
          provider_id: 'test-only', email: 'unused@example.test', hoscode: 'test' })
      }
      if (url.pathname === '/revoke') {
        let raw = ''
        for await (const part of req) raw += part
        const data = Object.fromEntries(new URLSearchParams(raw))
        calls.revoked.push(data)
        tokens.delete(data.token)
        res.writeHead(200); res.end(); return
      }
      json(404, { error: 'not_found' })
    })().catch(() => { if (!res.writableEnded) json(500, { error: 'test_server_error' }) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${server.address().port}`
  return { issuer, behavior, calls,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }) }
}
