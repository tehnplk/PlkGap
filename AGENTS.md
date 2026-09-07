# PlkGap

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

1. สร้าง `pages/XxxPage.tsx` ตามกติกาข้างบน
2. เพิ่มค่าใน type `Kind` (`App.tsx`)
3. เพิ่ม entry ใน `titles` และ `icons` (`App.tsx`) — ถ้าไอคอนยังไม่มี ให้เพิ่ม path ใน `Icon.tsx`
4. เพิ่มบรรทัด conditional render ใน `.window-content` (ถ้าต้องเต็มกรอบ ให้เพิ่มเงื่อนไขคลาส `flush` ด้วย)

sidebar และเมนู Window ได้รายการใหม่เองอัตโนมัติ เพราะ render มาจาก `titles` ไม่ต้องแก้เพิ่ม
ส่วนเมนู File ถ้าอยากมีรายการเปิดหน้านั้น ต้องเพิ่มเอง

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
- base layer สลับผ่าน `L.control.layers` ปัจจุบันมี OSM (`Street map`) กับ Esri (`Satellite`)
  เพิ่ม layer ใหม่ได้เลยโดยไม่ต้องแก้ CSP
- ถ้าจะวาดข้อมูลจาก PostGIS ให้ query `ST_AsGeoJSON` ตามขั้นตอนใน "เพิ่ม operation ใหม่"
  แล้วส่ง GeoJSON เป็น props ลงมา ห้าม `MapPage` เรียก `window.api` เอง
