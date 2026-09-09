# PlkGap

Electron + React + Vite + TypeScript, with embedded PGlite and PostGIS.

## Development

```sh
npm install
npm run dev
```

## Build and verify

```sh
npm run build
npm test
npm start
```

The build produces application files in `out/`. See [UPDATES.md](UPDATES.md) for installer and release configuration.
Tests use temporary databases and save an Electron screenshot in `artifacts/`.
Use Node.js 22.12+ or a newer supported release. The database test runs through `tsx`.

## Structure

- `src/main`: Electron lifecycle and database operations.
- `src/preload`: isolated, narrowly scoped IPC bridge.
- `src/renderer`: React UI built by Vite.
- `src/shared`: shared TypeScript contracts.

## SSO and remembered account

See [SSO.md](SSO.md) for registration, source ownership, account lifecycle,
troubleshooting, page/IPC protection guidance and test commands. Page protection
is documented as a future implementation pattern; the current local pages are not gated.

PlkGap uses a Public + PKCE client and remembers the verified account in OS-encrypted
storage until the user clicks Logout. Restarting offline or access-token expiry
does not clear that local account. This does not renew SSO tokens or authorize
remote API calls; local tools remain available while signed out.

After `npm run build`, run `node scripts/test-sso-persistence.mjs` to verify
encrypted account restore across offline restarts and explicit Logout.
The same test verifies Light/Dark persistence and API Gateway switching/restarts.
The profile menu contains an API Gateway switch after Theme; it controls the
local REST listener on port 9988 and remembers the setting independently of Logout.

## Database

PGlite runs PostgreSQL in WebAssembly inside Electron, with the
`@electric-sql/pglite-postgis` extension. No database service, Docker, network port,
or separate PostgreSQL installation is needed.

Data persists under Electron's `userData/plkgap-pglite` directory, normally
`%APPDATA%/plkgap/plkgap-pglite` on Windows. The app displays its exact path.
One application instance owns the database; shutdown closes it gracefully.
The initial screen checks the PostgreSQL/PostGIS versions and executes a spatial
query. No application-specific tables or sample records are created at startup.

PGlite is an embedded, single-client PostgreSQL runtime. It does not provide a
standalone PostgreSQL server or guarantee every native PostGIS extension feature.
Check required spatial functions before building on them.

Documentation: https://pglite.dev/extensions/#postgis
