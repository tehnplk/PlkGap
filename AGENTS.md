# PlkGap

Do not add, edit, or delete this document without user authorization.

## SSO

- Read `SSO.md` before account changes. Config: `src/main/sso-config.json`; Public + PKCE only, no client secret.
- Remember accounts until Logout; no token-expiry auto logout or mandatory SSO reconnect on app startup. `signed-in` means a locally remembered account, not a valid token: never use it to authorize remote APIs or extend token lifetime.
- Login-required pages need both a renderer gate and a main-process snapshot check after `authorizedWindow(event)` in IPC. Hiding menus is insufficient; not all pages currently require login. See `SSO.md`.
- Encrypt accounts/tokens through main-only `sso-store.ts`; renderer receives status/profile only. Logout clears local accounts even if SSO is unreachable. Preserve login JWT validation and protection against late login/restore overwriting Logout.
- Lifecycle changes: run `npm run test:sso`, then after build `node scripts/test-sso-persistence.mjs` (not included in `npm test`).

## MDI and grids

- No router; one page per `Kind`. Only pages belong in `src/renderer/src/pages/`: `pages/<group>/XxxPage.tsx` must export `function XxxPage()`.
- `App.tsx` owns shell, menus, and window open/close/focus/move/resize/arrange only. Pages own loading, processing, filtering, pagination, and page state; see the PostGIS exception below. Open other pages via callback props, never import App into a page.
- App's `.window-content` owns padding, scrolling, borders, and background. Normal pages return fragments, not chrome; sized content such as `.map-canvas` is allowed. Full-frame pages use App's `window-content flush`, never reset padding themselves.
- All entry points (sidebar, File/Help, callbacks) use App's `open(id: Kind)`. New windows always have `maximized: true`; `createChildWindow` supplies Restore bounds. One window per Kind; reopening calls `focus(id)` and sets `minimized: false`.
- Only `windowTitle(id)` composes `titles[id] + ' - ' + sources[id]`, where `sources` is the page basename without extension. Use it for window headers, region aria-labels, Minimize/Maximize/Restore/Close buttons, dock, Window menu, and status bar; visible/accessibility names must match. Sidebar/File opening commands use only `titles[id]`.
- Adding a page: register `Kind`, `titles`, `icons`, `sources`, conditional render and optional `flush` in App; add icon paths in `Icon.tsx` if needed, `groups` for sidebar, and File/Help commands as needed. Window menu derives from open windows. `scripts/test-electron.mjs` statically checks page/export names, `sources`, and the title formula before launch.
- All page/dialog data grids use `src/renderer/src/SortableTable.tsx`; no separate data-grid `<table>` or duplicated sorting. Every header toggles ASC/DESC with direction indicator and `aria-sort`. Sort state belongs to each table instance, never App; pages supply data/filtering/columns. Use cell `data-sort-value` for underlying numbers/timestamps when display differs (including `-`).

## Version

- `package.json.version` is the only source; no separate version file or hardcoding. `electron.vite.config.ts` injects `__APP_VERSION__`; `TitleBar.tsx` displays `PlkGap version {version}`; type: `src/renderer/src/env.d.ts`. Sandboxed renderer does not read runtime files.
- For user-requested builds/installers, first ask "จะอัปเวอร์ชันไหม"; change only as specified, otherwise retain the version. Agent validation via `npm run build` / `npm test` requires no question.

## Database: PGlite + PostGIS

Embedded PostgreSQL/WASM, no DB server/port/Docker; data: `userData/plkgap-pglite`.

- Main process only; renderer must not import `@electric-sql/pglite` or `src/main/database.ts`. Keep `sandbox: true`, `nodeIntegration: false`.
- All SQL stays in `src/main/database.ts`; functions receive `db`, not a global. `index.ts` only wires operations/checks authorization. Every `ipcMain.handle` calls `authorizedWindow(event)` to check sender and senderFrame; never duplicate or bypass it.
- One PGlite instance, opened in `app.whenReady()` before windows. Preserve single-instance lock; never open another instance on the same path.
- Confirm exit on the window `close` event, not `window:close` IPC, covering X/Exit/Alt+F4/taskbar. Preserve `confirming`/`confirmedExit` against duplicate dialogs/loops; `before-quit` waits for `db.close()`.
- All idempotent schema/migration work belongs in `initializeSchema(db)`, called before `openDatabase()` returns; no separate startup table creation. Initialize only on first use/component-version changes; subsequent starts read one `schema_init` row per component and skip unchanged work, not repeated CREATE/ALTER.

### Table initialization

Classify every new `public` table before implementing initialization. Use these terms in code/docs: **fresh table** = schema only, exactly 0 rows on fresh install (types 3/4), never bundled user/sample rows; **initial table** = seeded only from repo code/files (types 1/2). `scripts/test-database.ts` checks both after first `openDatabase()`.

1. **System (2, initial):** `schema_init` is created first by `ensureInitTable()`, one row per initialized component. `observ_check` seeds all `observationRules()` with `is_active = true` initially; preserve user switches on reseed.
2. **Reference codes (128, initial, all `c_`):** may rebuild complete sets, with separate sources/components:
   - Dictionary/facilities (5): `src/main/reference/tables-in-use.json` is the sole list (`c_files_schema`, `c_files_desc`, `c_file`, `c_hospital`, `c_hostype`). `loadReferenceTables()` may DROP/recreate/reload upstream-only `c-tables.json` data; users do not edit it. Other bundled lookup tables are not seeded and are dropped on re-init: never reuse them for validation because their copies disagree. Bump `REFERENCE_TABLES_REVISION` when changing the list.
   - PlkGap code catalog (120): `loadStructureCodeTables()` may rebuild; see standard codes below.
   - Geography (3): `loadGeographyTables()` rebuilds `c_province`, `c_district`, `c_subdistrict` on version change. Names/codes: `geography.json`; UPDATE `geom` from `boundaries.json`, not separate tables. Strip `TH` from `TH65`/`TH6501`/`TH650101` to match CHANGWAT/AMPUR/TAMBON; province geometry is a district union. Exclude geography from code statistics: `databaseStatus()` counts only `reference`/`structure_codes`; update its exclusion and `scripts/test-database.ts` exclusions if adding geography tables.
3. **Service data (52 files, fresh):** schema from `src/main/reference/f43-tables.json`; always preserve accumulated imports. `createFileTables()` is additive only: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Never DROP TABLE/COLUMN or TRUNCATE, including upgrades; test existing rows survive re-init/upgrades.
4. **Logs (2, fresh):** preserve `import52files_log` (one per import, referenced by `log_import_id`) as user data. `structure_check_log` is reproducible and may DROP/recreate on upgrade.

- Types 1/3/4 use `createAppTables()`/`createFileTables()`, never `c_` names. That prefix is reserved for type 2; database tests reconcile its count with reference/code loaders, excluding geography. Bump `APP_SCHEMA_VERSION` for system/log schema changes.
- Types are not schema component names: retain `reference`, `structure_codes`, `geography`, `app`, `observations`; do not rename components to match categories and trigger re-init.
- Sources under `src/main/reference/`: `c-tables.json`/`f43-tables.json` from `scripts/pull-reference-tables.mjs`, geography from `scripts/pull-geography.mjs`, boundaries from `scripts/pull-boundaries.mjs`. Read the 52-file list from `c_file`, never hardcode it.
- Reference files are statically imported by `database.ts`, bundled in `out/main/index.js` and the installer. Tables initialize on first app launch, not during installation.

### Standard codes and structure checks

- Use PlkGap's catalog, never lookup tables bundled in `c-tables.json`. Priority: published codes via `scripts/pull-standard-codes.mjs` -> `src/main/reference/standard-codes.json`; only uncovered fields fall back to `c_files_schema.description`. Published codes always win.
- `scripts/generate-structure-codes.mjs` merges sources into `structure-codes.json`; `loadStructureCodeTables()` seeds component `structure_codes` before API views. See `STRUCTURE_CODE_AUDIT.md` for rationale.
- `ruleTests()` evaluates only the current row: no other service rows, cross-zip/HOSPCODE joins or subqueries, even within one facility. Only `c_*` lookups may be external. Cross-row/file checks belong in observations.
- `checkImportStructure()` and `structureFailingRows()` always apply `importedFromZip` to counts and drill-down. Database tests must confirm adding rows from another zip/HOSPCODE cannot change the original zip's results.
- Pull entries require `fields` as `<file>.<column>` and must throw if absent from `c_files_schema`. Shared lists use one table with multiple bindings, never per-field copies (`c_instype`, `c_servplace`, `c_chargeitem`, `c_diagtype`, `c_fptype`, `c_housetype`, `c_person_prename`, `c_person_nation`, `c_person_sex`).
- `ruleTests()` resolves bindings before `c_<file>_<column>` fallback; tests prohibit fields relying solely on that fallback. Every table needs bindings or an explained `unbound` entry. `c_clinic_department` remains unbound because CLINIC digits 4-5 are facility-defined.
- Per value, report only the first failure: `required` -> `width` -> `unitcode` -> `code`; later rules skip earlier failures. If valid codes exceed dictionary width (e.g. C3 `epi.vaccinetype` with `HPVG91`), skip width and check every nonblank value against codes.
- Removed codes are invalid, not historically accepted. Exact code-rule text: `ไม่ตรงตามรหัสมาตรฐาน`; omit table names, since field buttons use `finding.reference` to open codes.
- Facility codes must be all digits of exact width (5/9). Discover fields from dictionary text using `UNIT_CODE_FIELD`, not a hardcoded list; `clinic`, `ward*`, `drg`, `an*` are not facility codes merely because widths match.

### Observations

- SQL lives only in `observationRules()` in `database.ts`, never in tables. `observ_check` stores only `rule_id`, `table_name`, `detail`, `level`, `sort_order`, `is_active` to control execution/order.
- Only `syncObservationRules()` writes the registry: add/update catalog rules, remove retired rules, never overwrite `is_active`. Component `observations` uses a catalog digest; unchanged catalogs cause no writes.
- `level`: `error` for mutually impossible rows, `warning` for suspicious rows requiring judgment. Store levels but hide them in results and rule selectors.
- Report only the inspected zip using `importedFromZip` on the base file; comparison rows may span zips, always within equal `hospcode`. Every cross-file join/subquery starts with hospcode equality before PID/HID/CID matching. `duplicate-cid` groups/partitions by `hospcode, cid` across zips. Cross-zip counts group once then join; no per-row subqueries.
- Add rules in two places: `ObservationRuleId` in `src/shared/api.ts` and `observationRules()` with `level`, `columns`, SQL `eligible`/`failed`, and base-file zip scope. Registry syncs next launch; no IPC/preload/UI edits needed.
- `validObservationDate()` stays 8 digits only. `datetime_*` uses `validObservationStamp()` (8/14 digits), comparing `left(value, 8)`; do not broaden the date helper because existing comparisons rely on equal-length strings.

### Fiscal-year counts

- `countByFiscalYears()` is monthly only for activity files with their own date. Read file category from the checkbox lines in `c_files_desc.description` (`แฟ้มสะสม / แฟ้มบริการ / แฟ้มบริการกึ่งสำรวจ`); never hardcode cumulative files. `c_file.type` is null for all 52 files.
- `byMonth` requires a non-cumulative file and `countingColumn()` not falling back to `d_update` (last modification, not activity date).
- Detect date columns by `date_*`/`datetime_*` names, never `c_files_schema.type`: `clinical_refer.datetime_assess`/`drug_refer.datetime_dstart` are typed C; `icf.date_serv` is missing. Known limitation: differently named dates (`procedure_refer.timestart`, `death.ddeath`, `newborn.bdate`) remain fiscal-year only.

### Operations and tests

- Add operations in order: `src/shared/api.ts` result type + `AppApi` method -> `src/main/database.ts` SQL function using `db.query<T>()` -> `src/main/index.ts` handler with `authorizedWindow(event)` -> `src/preload/index.ts` invoke matching `AppApi`. Channels use `domain:action` (e.g. `database:status`). Renderer uses typed `window.api`; never expose raw `ipcRenderer` through contextBridge.
- Add DB logic cases in `scripts/test-database.ts` (temporary DB). Regenerate `structure-codes.json` via `generate-structure-codes.mjs` whenever generator/source data changes; tests deepEqual it with `buildStructureCodes(referenceData)`.
- `scripts/test-electron.mjs` launches the real app via Playwright. Redirect userData with `PLKGAP_TEST_DATA_DIR`, never touch real data. Stub native `dialog.showMessageBox` through `application.evaluate`; update the stub when changing exit flow to prevent hangs.
- Map tests require internet and tile `naturalWidth > 0`, not merely `<img>` existence, to catch CSP failures.

## Local REST API: `src/main/server.ts`

- Main-process `node:http` server starts after `openDatabase()` and shares its instance. Bind only `127.0.0.1`; never send CORS headers. Default port 9988, override `PLKGAP_API_PORT`; tests use 9989. Busy port: log and let app start. Close server before `db.close()` in `before-quit`.
- `server.ts` only routes/serializes JSON; SQL stays in `database.ts`. Add every new endpoint to `route()` and `help`; `GET /help` is the API documentation.
- `POST /sql`: read-only transaction with 15-second `statement_timeout`; PostgreSQL must reject writes, not a keyword blacklist (including modifying CTEs). Return a plain JSON array; metadata headers: `X-Row-Count`, `X-Truncated`, `X-Columns`.
- Privacy list lives only in `blockedApiColumns` (`database.ts`). `createApiSchema()` creates one view per table in schema `api`, replacing blocked values with `'***'`. `runReadOnlySql()` uses `SET LOCAL ROLE plkgap_api` and `SET LOCAL search_path = api, public`.
- Never mask by returned column names: aliases, expressions, and subqueries must remain protected by views; preserve tests for all three. `plkgap_api` has only public-schema `USAGE` for PostGIS resolution, no access to public tables; explicit `public.person` queries must fail.
- Entries with `table` mask only that table (e.g. `home.house`); entries without it mask matching columns everywhere. Component `api` rebuilds from a digest of blocked columns + all table structures and runs last in `initializeSchema()`.
- `GET /desc` and `GET /tables` run as owner and may reveal column existence, never masked values.

## Network, CSP, and maps

- CSP: `src/renderer/index.html`. External APIs are allowed. Keep `img-src 'self' data: https:` and `connect-src 'self' https: ws://localhost:*`; new APIs/layers need no host whitelist/CSP edit.
- Production `script-src 'self'` stays strict: no CDN, `'unsafe-inline'`, or `'unsafe-eval'`; use npm/Vite bundles. Only the dev plugin in `electron.vite.config.ts` adds `'unsafe-inline'`.
- Preserve `will-navigate`/`setWindowOpenHandler` navigation blocking. Renderer may fetch data, but keyed/secret APIs run in main and return results through IPC; CSP does not protect secrets.
- `MapPage` uses Leaflet 1.9 directly, no react-leaflet. Create in `useEffect`, clean up with `map.remove()` for StrictMode; use `ResizeObserver` -> `map.invalidateSize()` for MDI resizing/maximizing.
- Preserve the one-time marker URL fix at file top: Vite PNG imports plus `L.Icon.Default.mergeOptions` or `delete L.Icon.Default.prototype._getIconUrl` + `L.icon(...)`; never remove/duplicate it.
- `L.control.layers` switches OSM (`Street map`) and Esri (`Satellite`). PostGIS uses `ST_AsGeoJSON` through the operation pipeline; pass GeoJSON as props, never call `window.api` directly from `MapPage`.
