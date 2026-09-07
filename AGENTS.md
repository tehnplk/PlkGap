# PlkGap

## หน้าจอ: `src/renderer/src/pages/`

โปรเจกต์นี้เป็น MDI (หน้าต่างย่อยหลายบานในหน้าต่างเดียว) **ไม่มี router**
ไฟล์ใน `pages/` คือ *เนื้อหาข้างใน* ของหน้าต่างย่อยแต่ละบาน ไม่ใช่หน้าเว็บที่สลับกันทั้งจอ

หนึ่งไฟล์ = หนึ่งค่าใน `Kind` ของ `App.tsx` แบบหนึ่งต่อหนึ่ง

### กติกาของไฟล์ใน `pages/`

- **return fragment (`<>...</>`) เท่านั้น** ห้ามใส่ wrapper element, padding, scroll หรือกรอบของตัวเอง
  สิ่งเหล่านี้เป็นหน้าที่ของ `.window-content` ใน `App.tsx`
- **presentational ล้วน** ไม่มี state ของตัวเอง และ **ห้ามเรียก `window.api` เอง**
  ข้อมูลทั้งหมด fetch ที่ `App.tsx` แล้วส่งลงมาเป็น props
  เหตุผล: เปิดหน้าต่างเดียวกันซ้ำได้โดยแชร์ข้อมูลก้อนเดียว และไม่ยิง IPC ซ้ำตอนย่อ/ขยาย/ลากหน้าต่าง
- ถ้าต้องสั่งให้เปิดหน้าต่างอื่น ให้รับเป็น callback prop (เช่น `onOpenDatabase`) ไม่ใช่ import `App` กลับเข้ามา

### เพิ่มหน้าใหม่ ต้องแตะ 4 จุด

1. สร้าง `pages/XxxPage.tsx` ตามกติกาข้างบน
2. เพิ่มค่าใน type `Kind` (`App.tsx`)
3. เพิ่ม entry ใน `titles` และ `icons` (`App.tsx`) — ถ้าไอคอนยังไม่มี ให้เพิ่ม path ใน `Icon.tsx`
4. เพิ่มบรรทัด conditional render ใน `.window-content`

sidebar และเมนู Window ได้รายการใหม่เองอัตโนมัติ เพราะ map มาจาก `titles` ไม่ต้องแก้เพิ่ม

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
- **ปิดต้อง graceful** `before-quit` จะขวางการปิดไว้จน `db.close()` เสร็จ ถ้าเพิ่ม path การปิดใหม่ ต้องไม่ข้ามขั้นนี้
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
