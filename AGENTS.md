# PlkGap

ห้ามเพิ่ม แก้ไข หรือลบเอกสารนี้โดยไม่ได้รับอนุญาตจาก user

## MDI: `src/renderer/src/pages/` และ `App.tsx`

- ไม่มี router: หนึ่งไฟล์ page ต่อหนึ่ง `Kind` เป็นเนื้อหาภายในหน้าต่างย่อย
- `App.tsx` ดูแลเฉพาะ shell, เมนู และจัดการหน้าต่าง (open/close/focus/move/resize/arrange) ห้ามใส่ business logic, data processing หรือ state เฉพาะหน้า
- แต่ละ page โหลดข้อมูลและจัดการ logic/state ของตัวเอง (sort/filter/transform/pagination); แผนที่ PostGIS ใช้ข้อยกเว้นในหัวข้อ Leaflet
- `.window-content` ใน App คุม padding/scroll/กรอบ/พื้นหลัง; page ปกติ return fragment ห้ามสร้าง chrome เอง ยกเว้น element ที่เนื้อหาต้องมีขนาด เช่น `.map-canvas`
- หน้าที่ต้องเต็มกรอบให้ App ใส่ `window-content flush`; ห้าม page ล้าง padding เอง
- เปิดหน้าอื่นผ่าน callback prop เช่น `onOpenDatabase`; ห้าม import App กลับเข้ามา

### เปิดและตั้งชื่อหน้าต่าง

- ทุกทาง (Sidebar, File/Help, callback) ต้องผ่าน `open(id: Kind)` ใน App เท่านั้น ห้ามแทรก state เปิดหน้าต่างที่อื่น
- หน้าต่างใหม่ตั้ง `maximized: true` เสมอ; `createChildWindow` เตรียมขนาด/ตำแหน่งสำรองสำหรับ Restore
- หนึ่ง Kind มีได้หนึ่งบาน: เปิดซ้ำให้ `focus(id)` และคืน `minimized: false`
- ประกอบชื่อที่ `windowTitle(id)` แห่งเดียวจาก `titles[id]` และ `sources[id]`: `{ชื่อหน้า} - {basename ของไฟล์ page ไม่รวมนามสกุล}` ห้าม hardcode ชื่อประกอบที่อื่น
- ใช้ `windowTitle(id)` กับหัวหน้าต่าง, region aria-label, ปุ่ม Minimize/Maximize/Restore/Close, dock, เมนู Window และ status bar; ชื่อที่เห็นต้องตรงกับ accessible name
- คำสั่งเปิดหน้าใน sidebar/เมนู File ใช้ `titles[id]` อย่างเดียว

### เพิ่มหน้า

1. สร้าง `pages/<group>/XxxPage.tsx`
2. เพิ่ม `Kind` ใน App
3. เพิ่ม `titles`, `icons`, `sources` ใน App (`sources` ตรง basename); เพิ่ม path ใน `Icon.tsx` ถ้าจำเป็น
4. เพิ่ม conditional render ใน `.window-content` และเงื่อนไข `flush` ถ้าต้องเต็มกรอบ
5. เพิ่ม Kind ใน `groups` ถ้าต้องแสดง sidebar; เพิ่มคำสั่ง File/เกี่ยวกับเองถ้าต้องการ ส่วนเมนู Window มาจากหน้าต่างที่เปิดอยู่โดยอัตโนมัติ

## เวอร์ชัน

- `package.json` field `version` เป็นแหล่งเดียว ห้ามสร้างไฟล์เวอร์ชันแยกหรือ hardcode ที่อื่น
- `electron.vite.config.ts` ฉีด `__APP_VERSION__` ตอน build; `TitleBar.tsx` แสดง `PlkGap version {version}`; type อยู่ใน `src/renderer/src/env.d.ts` (renderer เป็น sandbox ไม่อ่านไฟล์ runtime)
- เมื่อ user สั่ง build/ทำตัวติดตั้ง **ต้องถามก่อนว่า "จะอัปเวอร์ชันไหม"** ห้ามอัปเองหรือข้ามคำถาม: ถ้าอัปให้แก้ตามที่ user ระบุ ถ้าไม่อัปให้ใช้เลขเดิม
- `npm run build` / `npm test` ที่ agent รันเพื่อตรวจงานเองไม่ต้องถาม

## ฐานข้อมูล: PGlite + PostGIS

Embedded PostgreSQL (WASM) ใน Electron; ไม่มี server/พอร์ต/Docker; ข้อมูลอยู่ `userData/plkgap-pglite`

- DB อยู่ main process เท่านั้น; ห้าม renderer import `@electric-sql/pglite` หรือ `src/main/database.ts`; คง `sandbox: true`, `nodeIntegration: false`
- SQL ทั้งหมดอยู่ `src/main/database.ts`; ฟังก์ชันรับ `db` เป็น argument ไม่อ่าน global ส่วน `index.ts` ต่อสาย/ตรวจสิทธิ์เท่านั้น
- ทุก `ipcMain.handle` เรียก `authorizedWindow(event)` ซึ่งตรวจทั้ง sender และ senderFrame; ห้ามคัดลอกเงื่อนไขหรือข้ามการตรวจ
- PGlite มี instance เดียว เปิดใน `app.whenReady()` ก่อนสร้างหน้าต่าง; คง single-instance lock และห้ามเปิด instance ที่สองชี้ path เดิม
- ปิดแอปสองขั้น: confirm ที่ event `close` ของหน้าต่าง (ไม่ใช่ IPC `window:close`) ให้ครอบคลุม X/Exit/Alt+F4/taskbar แล้วให้ `before-quit` รอ `db.close()`; คง `confirming`/`confirmedExit` กัน dialog ซ้อนและวนซ้ำ
- Schema/migration อยู่ใน `initializeSchema(db)` ที่ `openDatabase()` เรียกก่อน return ต้อง idempotent; ห้ามสร้างตารางแยกใน startup
- Init schema ครั้งแรกและเมื่อเวอร์ชัน component เปลี่ยนเท่านั้น: `schema_init` เก็บเวอร์ชันแต่ละ component; เปิดครั้งถัดไปอ่านหนึ่งแถวต่อ component แล้วข้าม ห้ามไล่ `CREATE`/`ALTER` ทุกครั้ง

### ตารางสองกลุ่ม ห้ามสลับวิธี init

- **`c_*` (120 reference tables)**: โครงสร้าง/แถวมาจาก `src/main/reference/c-tables.json` เป็น upstream ล้วน ผู้ใช้ไม่แก้; เมื่อเวอร์ชันใหม่ `loadReferenceTables()` ใช้ DROP/สร้าง/โหลดใหม่ทั้งชุดได้
- **52 แฟ้ม (`person`, `home`, `service`, ...)**: โครงสร้างจาก `src/main/reference/f43-tables.json` ไม่มีแถวติดมา; ต้องรักษาข้อมูล import สะสมเสมอ
  - `createFileTables()` เป็น additive เท่านั้น: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
  - **ห้าม `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` แม้อัปเกรด schema**; เทสต์ต้องยืนยันว่าแถวเดิมอยู่ครบหลัง re-init/upgrade
- JSON ทั้งคู่สร้างโดย `scripts/pull-reference-tables.mjs` จาก SUB-HDC; รายชื่อ 52 แฟ้มอ่าน `c_file` ห้าม hardcode

### เพิ่ม operation ตามลำดับ

1. `src/shared/api.ts`: เพิ่ม result type และ method ใน `AppApi` (contract ทั้งสามชั้น)
2. `src/main/database.ts`: เพิ่ม SQL function โดยใช้ `db.query<T>()` ตาม result type
3. `src/main/index.ts`: เพิ่ม `ipcMain.handle('domain:action', ...)` พร้อม `authorizedWindow(event)`
4. `src/preload/index.ts`: ต่อ `ipcRenderer.invoke` ตาม `AppApi`; ห้าม expose `ipcRenderer` ตรงผ่าน contextBridge

Renderer ใช้ `window.api` (type มีใน `env.d.ts` แล้ว); channel ใช้ `domain:action` เช่น `database:status`

### เทสต์

- `scripts/test-database.ts` เรียก database.ts บน temp dir; เพิ่มเคสเมื่อเพิ่มตรรกะ DB
- `scripts/test-electron.mjs` รันแอปจริงด้วย Playwright; ใช้ `PLKGAP_TEST_DATA_DIR` redirect userData เพื่อไม่แตะข้อมูลจริง
- Stub `dialog.showMessageBox` ผ่าน `application.evaluate` เพราะ Playwright คลิก native dialog ไม่ได้; แก้ flow ปิดแอปต้องอัปเดต stub เพื่อไม่ให้เทสต์ค้าง
- เทสต์ต้องต่อเน็ตและตรวจ tile `naturalWidth > 0` ไม่ใช่เพียงมี `<img>` เพื่อจับ CSP บล็อกภาพ

## เครือข่าย & CSP

CSP อยู่ meta tag ใน `src/renderer/index.html`; แอปเรียก API ภายนอกได้ ไม่ใช่ offline-only

- คง `img-src 'self' data: https:` และ `connect-src 'self' https: ws://localhost:*`; เพิ่ม API/layer ไม่ต้อง whitelist host หรือแก้ CSP
- **ห้ามผ่อน `script-src 'self'` ใน production**: ห้าม CDN, `'unsafe-inline'`, `'unsafe-eval'`; ลง library ผ่าน npm ให้ Vite bundle (`'unsafe-inline'` เติมเฉพาะ dev โดย plugin ใน `electron.vite.config.ts`)
- คงการบล็อก navigate ออกด้วย `will-navigate`/`setWindowOpenHandler`; ดึงข้อมูลเข้าได้
- Renderer ใช้ `fetch` ได้ แต่ API ที่มี key/secret ต้องเรียกจาก main แล้วส่งผลผ่าน IPC; CSP ไม่ป้องกัน key รั่ว

## แผนที่: Leaflet

`MapPage` ใช้ Leaflet 1.9 โดยตรง ไม่มี react-leaflet

- สร้าง map ใน `useEffect`; cleanup ต้อง `map.remove()` เพื่อรองรับ StrictMode
- ต้องมี `ResizeObserver` → `map.invalidateSize()` รองรับ MDI resize/maximize
- คงการแก้ marker URL ครั้งเดียวที่หัวไฟล์: import PNG ผ่าน Vite ร่วมกับ `L.Icon.Default.mergeOptions` หรือ `delete L.Icon.Default.prototype._getIconUrl` + `L.icon(...)`; ห้ามลบหรือทำซ้ำ
- สลับ base layer ด้วย `L.control.layers`: OSM (`Street map`) และ Esri (`Satellite`)
- PostGIS ใช้ `ST_AsGeoJSON` ผ่านขั้นตอนเพิ่ม operation แล้วส่ง GeoJSON เป็น props; ห้าม `MapPage` เรียก `window.api` เอง
