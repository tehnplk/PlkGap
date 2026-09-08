# PlkGap

## Rule
- ห้ามลบ แก้ไข เพิ่ม เอกสารนี้โดยพละการโดยเด็ดขาด ต้องรอให้ user อนุญาต
## หน้าจอ: `src/renderer/src/pages/`

โปรเจกต์นี้เป็น MDI (หน้าต่างย่อยหลายบานในหน้าต่างเดียว) **ไม่มี router**
ไฟล์ใน `pages/` คือ *เนื้อหาข้างใน* ของหน้าต่างย่อยแต่ละบาน ไม่ใช่หน้าเว็บที่สลับกันทั้งจอ

หนึ่งไฟล์ = หนึ่งค่าใน `Kind` ของ `App.tsx` แบบหนึ่งต่อหนึ่ง

### กติกาของไฟล์ใน `pages/` และ `App.tsx`

- **หลีกเลี่ยงการใส่ logic และ process ใน `App.tsx`** — `App.tsx` ทำหน้าที่เป็น MDI Window Manager / Shell เท่านั้น
  ห้ามนำ business logic, การประมวลผลข้อมูล (data processing เช่น sort, filter, transform), หรือ state เฉพาะหน้ามากองไว้ใน `App.tsx`
  เพื่อให้ `App.tsx` สะอาด ดูแลเฉพาะเรื่องการจัดการหน้าต่าง (open, close, focus, move, resize, arrange) และเมนู
- **ให้แต่ละหน้า (`pages/`) รับผิดชอบการโหลดข้อมูลและจัดการ logic/process ของตัวเอง** —
  แต่ละหน้าสามารถโหลด data (เช่น dataset, fetch ข้อมูล), จัดการ UI state (เช่น sort, filter, pagination)
  และ process ข้อมูลภายในตัวหน้าต่างเองได้ ไม่ต้องส่งขึ้นไปให้ `App.tsx` จัดการ
- **ห้ามใส่ chrome ของตัวเอง** — padding, scroll, กรอบ, พื้นหลังหน้าต่าง เป็นหน้าที่ของ `.window-content` ใน `App.tsx`
  ปกติ page จึง return fragment (`<>...</>`) ข้อยกเว้นคือหน้าที่ *เนื้อหาเอง* ต้องเป็น element เดียวที่มีขนาด
  (เช่น `MapPage` return `<div className="map-canvas">` ให้ Leaflet ยึด) — นั่นคือเนื้อหา ไม่ใช่ wrapper
- **หน้าที่ต้องการเต็มกรอบไม่มี padding** ให้ `App.tsx` ใส่คลาส `flush` ให้ (`window-content flush`)
  ห้าม page ไปล้าง padding เอง เพราะ App เป็นผู้คุม chrome
- ถ้าต้องสั่งให้เปิดหน้าต่างอื่น ให้รับเป็น callback prop (เช่น `onOpenDatabase`) ไม่ใช่ import `App` กลับเข้ามา

### เพิ่มหน้าใหม่ ต้องแตะ 4 จุด
### เงื่อนไขการเปิดหน้าต่างย่อย (Child Windows)

1. สร้าง `pages/XxxPage.tsx` ตามกติกาข้างบน
- **จุดควบคุมการเปิดอยู่ที่เดียว (`open(id)`)** — การสั่งเปิดหน้าต่างย่อยทั้งหมด (จาก Sidebar, เมนู File/Help, หรือ callback เช่น `onOpenDatabase` ในหน้าย่อย) ต้องผ่านฟังก์ชัน `open(id: Kind)` ใน `App.tsx` จุดเดียวเท่านั้น ห้ามเขียนคำสั่งเปิดหน้าต่างหรือแทรก state แยกเองที่อื่น
- **เปิดแบบ Maximize เสมอ** — ทุกหน้าต่างย่อยที่ถูกเปิดขึ้นมาใหม่จะต้องตั้งค่า `maximized: true` เป็นค่าเริ่มต้น เพื่อให้ใช้พื้นที่ทำงานเต็มจอ MDI workspace ทันที (โดยมีขนาดกว้าง/ยาว และตำแหน่งสำรองไว้ผ่าน `createChildWindow` เมื่อผู้ใช้กดปุ่ม Restore)
- **หนึ่ง Kind เปิดได้เพียงหนึ่งบาน (Single Instance per Kind)** — หากหน้าต่างบานนั้นเปิดอยู่แล้ว การสั่งเปิดซ้ำจะไม่สร้างบานใหม่ แต่จะโฟกัส (`focus(id)`) หน้าต่างเดิมขึ้นมาด้านหน้าสุด และหากหน้าต่างนั้นถูกย่อ (minimize) อยู่ จะทำการยกเลิกการย่อ (`minimized: false`) กลับคืนมาอัตโนมัติ

### ชื่อหัวหน้าต่างย่อย (Child Window Title)

- **ทุกหน้าต่างย่อยต้องแสดงชื่อเป็น `{ชื่อหน้า} - {ชื่อไฟล์ source ไม่เอานามสกุล}`**
  เช่น `นำเข้าข้อมูล - ImportPage`, `ไข้เลือดออก - DenguePage`
  เพื่อให้เห็นจากหน้าจอได้ทันทีว่าหน้าต่างบานนั้นมาจากไฟล์ไหนใน `pages/` เวลาแก้งานจะได้ไม่ต้องไล่หา
- **ประกอบชื่อที่เดียวคือ `windowTitle(id)` ใน `App.tsx`** ซึ่งอ่านจาก `titles[id]` คู่กับ map `sources[id]`
  (`sources` เก็บ basename ของไฟล์ page เช่น `'ImportPage'`) ห้าม hardcode สตริงที่มีขีดคั่นไว้ที่อื่น
- **ใช้ `windowTitle(id)` ทุกที่ที่หมายถึง "หน้าต่างบานนั้น"** — แถบหัวหน้าต่าง, `aria-label` ของ region,
  ปุ่ม Minimize/Maximize/Restore/Close, ปุ่มใน `window-dock`, รายการในเมนู Window และชื่อหน้าต่างที่ status bar
  (ให้ชื่อที่ตาเห็นตรงกับ accessible name เสมอ)
- **ที่ที่หมายถึง "คำสั่งเปิดหน้า" ให้ใช้ `titles[id]` เปล่า ๆ** — sidebar และรายการในเมนู File
  เพราะยังไม่ใช่หน้าต่าง จึงไม่ต้องมีชื่อไฟล์ต่อท้าย

### เพิ่มหน้าใหม่ ต้องแตะ 5 จุด

1. สร้าง `pages/<group>/XxxPage.tsx` ตามกติกาข้างบน
2. เพิ่มค่าใน type `Kind` (`App.tsx`)
3. เพิ่ม entry ใน `titles` และ `icons` (`App.tsx`) — ถ้าไอคอนยังไม่มี ให้เพิ่ม path ใน `Icon.tsx`
4. เพิ่มบรรทัด conditional render ใน `.window-content` (ถ้าต้องเต็มกรอบ ให้เพิ่มเงื่อนไขคลาส `flush` ด้วย)
4. เพิ่ม entry ใน `sources` (`App.tsx`) ให้ตรงกับชื่อไฟล์ข้อ 1 แบบไม่เอานามสกุล
5. เพิ่มบรรทัด conditional render ใน `.window-content` (ถ้าต้องเต็มกรอบ ให้เพิ่มเงื่อนไขคลาส `flush` ด้วย)

sidebar และเมนู Window ได้รายการใหม่เองอัตโนมัติ เพราะ render มาจาก `titles` ไม่ต้องแก้เพิ่ม
ส่วนเมนู File ถ้าอยากมีรายการเปิดหน้านั้น ต้องเพิ่มเอง
ถ้าอยากให้หน้านั้นโผล่ใน sidebar ต้องเพิ่ม `Kind` เข้าไปในกลุ่มใดกลุ่มหนึ่งของ `groups` (`App.tsx`) ด้วย
เมนู Window ได้รายการใหม่เองอัตโนมัติจากหน้าต่างที่เปิดอยู่ ส่วนเมนู File/เกี่ยวกับ ถ้าอยากมีรายการเปิดหน้านั้น ต้องเพิ่มเอง

## เวอร์ชัน: `package.json`

**เลขเวอร์ชันอยู่ที่ field `version` ใน `package.json` ที่เดียว** ห้ามสร้างไฟล์เวอร์ชันแยก
และห้าม hardcode เลขเวอร์ชันไว้ที่ไหนอีก

- `electron.vite.config.ts` อ่านค่าจาก `package.json` แล้วฉีดเป็น `__APP_VERSION__` ตอน build
  (renderer เป็น sandbox อ่านไฟล์เองไม่ได้ จึงต้องฉีดตอน build ไม่ใช่อ่านตอน runtime)
- `TitleBar.tsx` ใช้ `__APP_VERSION__` แสดงที่ main title bar ต่อจากชื่อแอป → `PlkGap version 1.0.1`
- type ของ `__APP_VERSION__` ประกาศไว้ใน `src/renderer/src/env.d.ts` แล้ว

### กติกาการอัปเวอร์ชัน

- **เมื่อ user สั่ง build (ทำตัวติดตั้ง) ต้องแจ้งเตือนและถาม user ก่อนเสมอว่า "จะอัปเวอร์ชันไหม"**
  ห้ามอัปเองเงียบ ๆ และห้ามข้ามคำถามไป build เลย
- ถ้า user ตอบว่าอัป — แก้ `version` ใน `package.json` ตามที่ user บอก แล้วค่อย build
- ถ้า user ตอบว่าไม่อัป — build ด้วยเลขเดิม ไม่ต้องแตะไฟล์
- กติกานี้ใช้กับกรณีที่ **user เป็นคนสั่ง build** เท่านั้น
  ส่วน `npm run build` / `npm test` ที่ agent รันเองเพื่อตรวจงานระหว่างแก้โค้ด ไม่ต้องถาม

## ฐานข้อมูล: PGlite + PostGIS

DB เป็น **embedded PostgreSQL (WASM) รันในโปรเซส Electron** ไม่มี server, ไม่มีพอร์ต, ไม่มี Docker
ข้อมูลอยู่ที่ `userData/plkgap-pglite`

### กติกา

- **DB อยู่ใน main process เท่านั้น** renderer แตะไม่ได้เลย ห้าม import `@electric-sql/pglite`
  หรือ `src/main/database.ts` เข้าไปในฝั่ง renderer (`sandbox: true`, `nodeIntegration: false`)
- **SQL ทั้งหมดอยู่ใน `src/main/database.ts`** เท่านั้น `index.ts` ทำหน้าที่ต่อสายและตรวจสิทธิ์ ไม่เขียน SQL
  ฟังก์ชันรับ `db` เป็น argument (ไม่อ่าน global) เพื่อให้เทสต์เรียกตรงได้
- **ทุก `ipcMain.handle` ต้องผ่าน `authorizedWindow(event)`** ซึ่งตรวจทั้ง `event.sender` และ `event.senderFrame`
  ห้ามคัดลอกเงื่อนไขไปเขียนซ้ำเอง และห้ามเพิ่ม handler ที่ไม่ตรวจ sender
- **มี PGlite instance เดียวทั้งแอป** เปิดครั้งเดียวใน `app.whenReady()` ก่อนสร้างหน้าต่าง
  ห้ามเปิด instance ที่สองชี้ path เดียวกัน (PGlite เป็น single-client) — แอปมี single-instance lock คุมอยู่แล้ว
- **ปิดแอปมี 2 ขั้น ห้ามข้าม** (1) confirm dialog ที่ event `close` ของหน้าต่าง แล้ว (2) `before-quit`
  ขวางไว้จน `db.close()` เสร็จ ดักที่ event `close` ไม่ใช่ที่ IPC handler `window:close` เพื่อให้ครอบ
  ทุกทางที่ปิดได้ (ปุ่ม X, เมนู Exit, Alt+F4, taskbar) — flag `confirming`/`confirmedExit` กัน dialog ซ้อนและกันวนซ้ำ
- **ไม่มีการสร้างตารางตอน startup** ถ้าจะมี schema/migration ให้ทำใน `openDatabase()` ให้ idempotent
  (`CREATE ... IF NOT EXISTS`) และรันก่อน return
- **schema ทั้งหมด init ครั้งเดียวตอนรันครั้งแรก** ทำใน `initializeSchema(db)` ที่ `openDatabase()` เรียกก่อน return
  (แอปนี้ไม่มีตัว installer แยก "รันครั้งแรกหลังติดตั้ง" จึงคือ setup ของโปรแกรม)
  ตาราง `schema_init` จดไว้ว่า component ไหนติดตั้งเวอร์ชันอะไรแล้ว การเปิดแอปครั้งถัดไปอ่านแค่แถวเดียวต่อ component แล้วข้าม
  ห้ามเขียน migration ที่ไล่ `CREATE`/`ALTER` ใหม่ทุกครั้งที่เปิดแอป

### สองกลุ่มตารางที่ init คนละแบบ (ห้ามสลับ)

- **`c_*` (120 ตาราง reference) — ของ upstream ล้วน ๆ replace ทั้งชุดได้**
  ข้อมูลมาจาก `src/main/reference/c-tables.json` ทั้งโครงสร้างและแถว ผู้ใช้ไม่ได้แก้ตารางกลุ่มนี้
  เมื่อไฟล์เวอร์ชันใหม่ `loadReferenceTables()` จะ `DROP` แล้วสร้างใหม่พร้อมโหลดแถวทั้งหมด
- **52 แฟ้มมาตรฐาน (`person`, `home`, `service`, ...) — เก็บข้อมูลที่ผู้ใช้ import สะสมไว้ ห้ามลบเด็ดขาด**
  โครงสร้างมาจาก `src/main/reference/f43-tables.json` แต่ **ไม่มีข้อมูลติดมา**
  `createFileTables()` ต้องเป็น additive อย่างเดียวตลอดไป — `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
  **ห้ามมี `DROP TABLE`, `DROP COLUMN` หรือ `TRUNCATE`** แม้ตอนอัปเกรดโครงสร้างเป็นเวอร์ชันใหม่
  (มีเทสต์ใน `scripts/test-database.ts` ยืนยันว่าแถวที่ import ไว้ยังอยู่ครบหลัง re-init และหลังอัปเกรดโครงสร้าง)
- ทั้งสองไฟล์ JSON สร้างจาก `scripts/pull-reference-tables.mjs` ที่ดึงจาก SUB-HDC
  รายชื่อ 52 แฟ้มอ่านจากตาราง `c_file` ไม่ต้องมา hardcode เอง

### เพิ่ม operation ใหม่ ต้องแตะ 4 จุด (เรียงตามลำดับนี้)

1. `src/shared/api.ts` — เพิ่ม type ของผลลัพธ์ และ method ใน `AppApi` (contract กลางของทั้ง 3 ชั้น)
2. `src/main/database.ts` — เขียนฟังก์ชัน SQL ใส่ generic ให้ `db.query<T>()` ตาม type ข้อ 1
3. `src/main/index.ts` — `ipcMain.handle('ชื่อ:action', (event) => { authorizedWindow(event); ... })`
4. `src/preload/index.ts` — ต่อ `ipcRenderer.invoke` ตาม `AppApi` (ห้าม expose `ipcRenderer` ตรงๆ ผ่าน contextBridge)

renderer เรียกผ่าน `window.api` ที่ประกาศ type ไว้ใน `env.d.ts` แล้ว ไม่ต้องแก้เพิ่ม
ตั้งชื่อ channel เป็น `domain:action` เช่น `database:status`, `window:minimize`

### เทสต์

- `scripts/test-database.ts` เรียก `database.ts` ตรงบน temp dir — ตรรกะ DB ใหม่ควรเพิ่มเคสที่นี่
- `scripts/test-electron.mjs` รันแอปจริงด้วย Playwright โดยตั้ง `PLKGAP_TEST_DATA_DIR` ให้ redirect `userData`
  เทสต์จะไม่แตะข้อมูลจริงของผู้ใช้
- Playwright คลิก native dialog ไม่ได้ เทสต์จึง stub `dialog.showMessageBox` ผ่าน `application.evaluate`
  ถ้าแก้ flow การปิดแอป ต้องอัปเดต stub นี้ ไม่งั้นเทสต์จะค้าง
- **เทสต์ต้องต่อเน็ต** เพราะยืนยันว่า tile โหลดสำเร็จจริง (`naturalWidth > 0`) ไม่ใช่แค่มี `<img>`
  ตัวนี้มีไว้จับกรณีมีคนรัด CSP กลับจนบล็อกภาพ

## เครือข่าย & CSP

แอปนี้ **ไม่ใช่ offline-only** เรียก API ภายนอกได้ และจะมีเพิ่มอีกมาก
CSP อยู่ใน meta tag ที่ `src/renderer/index.html`

- `img-src 'self' data: https:` และ `connect-src 'self' https: ws://localhost:*`
  → **เพิ่ม API ใหม่ไม่ต้องแก้ CSP** ไม่ต้องไล่ whitelist host ทีละอัน
- **`script-src 'self'` ห้ามผ่อนเด็ดขาด** ห้ามใส่ CDN, `'unsafe-inline'`, `'unsafe-eval'` ใน production
  ต้องการ lib ไหนให้ลงผ่าน npm แล้วให้ Vite bundle
  (`'unsafe-inline'` ถูกเติมเฉพาะตอน dev โดย plugin ใน `electron.vite.config.ts` ไม่หลุดไป build)
- การพาผู้ใช้ออกนอกแอปยังถูกบล็อกหมด (`will-navigate`, `setWindowOpenHandler`) ดึงข้อมูลเข้าได้ แต่ navigate ออกไม่ได้
- เรียก API ที่ renderer ด้วย `fetch` ได้ตามปกติ **แต่ถ้ามี API key หรือ secret ให้ย้ายไปเรียกใน main process**
  แล้วส่งผลกลับผ่าน IPC — CSP ไม่ได้กันการรั่วของ key และโค้ด renderer ผู้ใช้เปิดดูได้

## แผนที่: Leaflet

`pages/MapPage.tsx` ใช้ Leaflet 1.9 ตรงๆ (ไม่มี react-leaflet)

- สร้าง map ใน `useEffect` และ **ต้อง `map.remove()` ใน cleanup** เพราะ StrictMode รัน effect ซ้ำตอน dev
- **ต้องมี `ResizeObserver` → `map.invalidateSize()`** หน้าต่าง MDI ลาก resize และ maximize ได้
  ถ้าไม่มี Leaflet จะคำนวณขนาดผิดแล้ว tile เพี้ยน
- ไอคอน marker ของ Leaflet อ้าง relative URL ที่ bundler แก้ให้ไม่ได้ แก้แล้วครั้งเดียวที่หัวไฟล์ด้วย
  `L.Icon.Default.mergeOptions` + import ไฟล์ png ผ่าน Vite — อย่าลบทิ้ง และไม่ต้องทำซ้ำ
  `delete L.Icon.Default.prototype._getIconUrl` + `L.icon(...)` / `L.Icon.Default.mergeOptions` + import ไฟล์ png ผ่าน Vite — อย่าลบทิ้ง และไม่ต้องทำซ้ำ
- base layer สลับผ่าน `L.control.layers` ปัจจุบันมี OSM (`Street map`) กับ Esri (`Satellite`)
  เพิ่ม layer ใหม่ได้เลยโดยไม่ต้องแก้ CSP
- ถ้าจะวาดข้อมูลจาก PostGIS ให้ query `ST_AsGeoJSON` ตามขั้นตอนใน "เพิ่ม operation ใหม่"
  แล้วส่ง GeoJSON เป็น props ลงมา ห้าม `MapPage` เรียก `window.api` เอง
