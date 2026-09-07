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

The build produces application files in `out/`. An installer is not configured.
Tests use temporary databases and save an Electron screenshot in `artifacts/`.
Use Node.js 22.12+ or a newer supported release. The database test runs through `tsx`.

## Structure

- `src/main`: Electron lifecycle and database operations.
- `src/preload`: isolated, narrowly scoped IPC bridge.
- `src/renderer`: React UI built by Vite.
- `src/shared`: shared TypeScript contracts.

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
