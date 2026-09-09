# PLKHealth SSO

The initial desktop authorization flow follows https://sso.plkhealth.go.th/llm.txt
and reads discovery at runtime. Persistent local account behavior is implemented
by PlkGap; it does not extend the SSO token lifetime.

## Developer entry points

| File | Responsibility |
| --- | --- |
| `src/main/sso-config.json` | Production issuer and public Client ID; do not duplicate these in code |
| `src/main/sso.ts` | PKCE callback, JWT/UserInfo validation, remembered account restore and Logout |
| `src/main/sso-store.ts` | OS encryption and serialized file read/write/clear operations |
| `src/main/index.ts` | Initialize once, restore on startup, authorized IPC, focus window, stop on exit |
| `src/shared/api.ts` | `SsoState`, `SsoProfile` and renderer API contract |
| `src/preload/index.ts` | `ssoState`, `ssoLogin`, `ssoLogout`, `onSsoState` bridge |
| `src/renderer/src/AccountFooter.tsx` | Account state, footer, dropup and Logout interaction |
| `src/renderer/src/App.tsx` | Shell layout only; status bar inside the child area |

## Registration

`src/main/sso-config.json` contains the public Client ID and issuer. Register the client as:

- Public client, without a client secret.
- Redirect URI: `http://127.0.0.1/callback` (the temporary loopback port varies).
- Scopes: `openid profile organization`.

The configured registration is named **PLK-GAP Desktop** in SSO Admin and must
show **PUBLIC + PKCE**. The previous **PLK-GAP** registration was Confidential
and caused `400 invalid_client` during token exchange. The desktop configuration
was switched to the new public registration; no SSO source change or deployment
was needed for this integration or remembered-account behavior.

Client IDs are public configuration. Never embed a client secret in the installer,
renderer, configuration, or repository.

## Flow

`sso.ts` runs in the main process. A login opens the operating system browser through
`shell.openExternal`, uses a one-time loopback listener, and sends PKCE S256, state, and nonce.
Callbacks validate state and exchange the code once. ID tokens must have a valid RS256
signature, issuer, audience, expiry, nonce, and subject; UserInfo must match that subject.
The renderer receives only login status and the name, position, and organization.

The verified account profile and access token are stored with OS-backed Electron `safeStorage` in
`userData/sso-session.bin`; no token reaches renderer storage or IPC responses.
If secure OS encryption is unavailable, login lasts for the current process only.
On restart, the app restores the encrypted account profile locally, including offline.
The remembered local account has no time limit and stays signed in until explicit Logout.
It is a local identity preference, not evidence of a currently authorized SSO session:
server-side revocation and profile changes are not checked on restore.
Access tokens retain their original expiry; there are no refresh tokens. Expired tokens
must not authorize future remote API requests. Any future authenticated API integration
needs a server-supported renewal flow and must honor server revocation.
Older saved sessions without a profile are migrated through UserInfo while their token
is valid; expired older sessions require one new login.
Logout removes the remembered account and requests token revocation. Logout affects
this app's token, not unrelated browser SSO sessions or other applications.

The sidebar footer opens an upward account panel with name, position, organization,
and Logout. It supports outside-click dismissal, Escape, and ArrowUp keyboard access,
including the collapsed sidebar. The status bar belongs to the child-window area.
Existing local tools remain available while signed out; this integration supplies the SSO account identity.

The account menu starts with a Light/Dark switch, before the name. `theme.ts`
stores this device preference in renderer localStorage under `plkgap.theme` and
applies it on startup before React renders. The default is the existing light
lavender theme. Logout does not reset the theme. Only this visual preference is
stored there; account data and tokens remain in encrypted main-process storage.
Dark colors use shared CSS roles in `style.css`; semantic status colors are preserved.

The next menu row is **API Gateway**, with the loopback address and an on/off
switch. This controls the real REST listener, independently of SSO login or Logout.
The default remains enabled on `127.0.0.1:9988` (`PLKGAP_API_PORT` overrides the
port for development/tests). `src/main/gateway.ts` persists `{ "enabled": boolean }`
in `userData/api-gateway.json`, serializes changes and owns listener lifecycle.
`gateway:state` and `gateway:set-enabled` are authorized IPC handlers; UI lives in
`GatewayToggle.tsx`. Disabling closes the listener and active connections. Shutdown
closes it without changing the saved choice; update-recovery resumes only when
enabled. A port conflict leaves the app usable and shows `ไม่พร้อม` with an error
instead of claiming the listener is running. The saved enabled preference remains
available for a later retry. This toggle does not add HTTP authentication or CORS.

## Persistent account contract

`SsoState.status === 'signed-in'` means that PlkGap has a remembered account.
It must not be used as a remote API authorization check or proof of current
organization membership. A profile can remain visible after SSO revokes its token.

| Event | Behavior |
| --- | --- |
| First successful login | Validate SSO response, then encrypt profile and token together |
| Token expires while app is open | Keep the local account visible; no automatic Logout |
| Close and reopen app | Restore the saved profile without contacting SSO |
| Start offline | Restore the saved profile as usual |
| User clicks Logout | Clear local state and encrypted file; attempt remote token revocation |
| Revocation request fails | Local Logout remains effective |
| Restart after Logout | Show the sign-in button |
| Missing/unreadable encrypted file or changed issuer/Client ID | Require a new login |
| Secure OS storage unavailable | Remember only within the current app process |

The encrypted session contains `issuer`, `clientId`, `accessToken`, `subject`,
`expiresAt`, and `profile` (`sub`, `name`, `position`, `organization`). `expiresAt`
describes the access token only. Never remove JWT expiry validation at initial login
to implement persistence, and never extend an expired token locally.

Keep tokens and persistence in the main process. IPC carries status, profile and
sanitized errors only; every request handler uses `authorizedWindow(event)`.
Preserve serialized storage operations and revision checks so a late login/restore
completion cannot undo Logout. `stop()` shuts down pending login work without
deleting the remembered account.

## Protecting a page or operation

**Current behavior:** pages, database IPC and the local HTTP API are not gated by
SSO login. The examples below are implementation guidance, not existing protection.
PlkGap has no router: protection belongs around a child page's content and at the
main-process operation boundary, not in a route middleware or only in a menu.

### Local page visibility

For a page whose requirement is a remembered local account, allow content only
when `status === 'signed-in'` and `profile` is present. Treat initial loading,
`signed-out`, `signing-in` and state-loading errors as denied. Do not read DOM text,
localStorage, the account button label or the encrypted file from the renderer.

Use a shared hook/component when adding protection to multiple pages. Subscribe
to `window.api.onSsoState()` before reading `window.api.ssoState()`, and ignore
the initial response if a newer event has arrived. `AccountFooter.tsx` already
demonstrates this subscription pattern; include the same guard in the error path
so a late request failure cannot replace a newer state. Unsubscribe on unmount.

The page render should follow this pattern after that hook is implemented:

```tsx
// Proposed shared hook, not an existing export.
const { state, loading } = useRememberedAccount()
if (loading) return <>กำลังตรวจสอบบัญชี...</>
if (state.status !== 'signed-in' || !state.profile) {
  return <>กรุณาเข้าสู่ระบบจากมุมซ้ายล่าง</>
}
return <ProtectedContent />
```

Keep data loading inside `ProtectedContent`, so it does not run while denied.
On Logout, unmount protected content, clear its cached data and cancel pending
requests. Guard late responses as well; hiding the component must not allow a
request started before Logout to repopulate protected state. Preserve the MDI
shell rules: no page business logic in `App.tsx`, and no custom page chrome.

### Main-process enforcement

A renderer gate is only UI behavior. Every protected IPC operation must first
validate the caller with `authorizedWindow(event)`, then check the main-process
SSO snapshot before reading data or starting work. Never accept a renderer-supplied
`isLoggedIn`, profile, subject or role as authorization.

```ts
// Proposed helper in main-process wiring; not currently installed on handlers.
function requireRememberedAccount() {
  const current = sso?.snapshot()
  if (current?.status !== 'signed-in' || !current.profile) {
    throw new Error('LOGIN_REQUIRED')
  }
  return current.profile
}

// At the start of each handler for a protected operation:
authorizedWindow(event)
const account = requireRememberedAccount()
// Only now invoke the operation; account.sub comes from main, not renderer input.
```

Keep SQL in `database.ts` and pass validated context from the handler when needed.
For long-running protected operations, define cancellation/revalidation on Logout
before returning data or committing work; use an account-generation check so a
Logout followed by another login cannot revive old requests.

The local REST API in `server.ts` is a separate entry point. IPC/page guards do
not protect it. If an operation must require authentication through all paths,
define equivalent HTTP authorization before exposing it there. A global remembered
account alone does not authenticate an HTTP caller.

### Remote authorization and roles

The persistent account is **not** a server session. Remote APIs must validate an
unexpired access token and enforce their own scopes, roles and revocation policy.
`position` and `organization` are display strings, not role claims; never grant
admin access by matching them. Do not send expired tokens as if they were valid.

There is currently no refresh-token flow or dedicated reauthorization method.
`ssoLogin()` returns the current state when already signed in; it does not renew
the token. Until a server-supported renewal flow is implemented, a remote feature
requiring a fresh token needs a new authorization flow (currently Logout then
Login). Document that requirement separately from local account persistence.

### Protection acceptance checks

- Signed out/loading/error: protected content does not mount or fetch data.
- Direct IPC call while signed out: main rejects it even if the UI is bypassed.
- Remembered account restored offline: local protected content is available.
- Logout with a page open or request pending: content and cache disappear, and
  stale responses cannot restore them.
- Remote expired/revoked token or insufficient scope: the server denies access
  even while the local profile remains visible.
- Alternate HTTP entry points cannot bypass the operation's authorization policy.

## Troubleshooting

- `SSO login rejected: token 400 invalid_client`: check the configured Client ID,
  active status and **PUBLIC + PKCE** registration. Do not add a client secret.
- Register exactly `http://127.0.0.1/callback`. Runtime callback URLs include a
  temporary port; do not fix or copy that port into the registration.
- The callback listener closes after completion. Reloading its URL can show
  `ERR_CONNECTION_REFUSED`; start a fresh login from the app when needed.
- A successful callback displays `เข้าสู่ระบบสำเร็จ กลับไปที่ PLK GAP ได้ และปิดหน้านี้ได้เลย`.
  Check that response and the app account state before diagnosing a failure.
- Main-process diagnostics identify the failing phase and sanitized OAuth error.
  Do not log credentials, authorization codes, tokens or full token responses.
- Older encrypted sessions without a saved profile may require one new login
  after token expiry. Subsequent restarts use the persistent profile.

## Validation

Build before running Electron scripts: they launch the bundle in `out/`, not
the current TypeScript source. Run `npm run test:sso`, then `npm run build`, then
the persistence test below. The persistence script is a separate command and is
not currently part of `npm test`.

- `npm run test:sso`: isolated OAuth server with real signed test ID tokens; checks PKCE,
  state, signature, issuer, audience, expiry, nonce, subject, restore, revocation,
  cancellation, and timeout.
- `npm run build`: typecheck and production bundle.
- `node scripts/test-sso-persistence.mjs`: real Electron restart with an expired token
  and offline SSO, encrypted account restore, and Logout remaining effective after restart.
- `node scripts/test-electron.mjs`: isolated userData, fake public client, full browser
  callback flow, OS-encrypted token file, account panel, keyboard navigation,
  collapsed/small layouts, status-bar boundaries, and Logout.

`PLKGAP_TEST_SSO_ISSUER` is honored only in an unpackaged app with an explicit
`PLKGAP_TEST_DATA_DIR`. Packaged apps always use the configured HTTPS issuer.

Live verification uses the actual SSO in an external browser and checks both
the callback success message and the account dropup. Distinguish real SSO results
from mock profiles. Test helpers may automatically Logout and close Electron after
capturing evidence; that is test cleanup, not application auto-logout behavior.
