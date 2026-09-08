# PlkGap

## หน้าจอ: `src/renderer/src/pages/`
ห้ามเพิ่ม แก้ไข หรือลบเอกสารนี้โดยไม่ได้รับอนุญาตจาก user

โปรเจกต์นี้เป็น MDI (หน้าต่างย่อยหลายบานในหน้าต่างเดียว) **ไม่มี router**
ไฟล์ใน `pages/` คือ *เนื้อหาข้างใน* ของหน้าต่างย่อยแต่ละบาน ไม่ใช่หน้าเว็บที่สลับกันทั้งจอ
## MDI: `src/renderer/src/pages/` และ `App.tsx`

หนึ่งไฟล์ = หนึ่งค่าใน `Kind` ของ `App.tsx` แบบหนึ่งต่อหนึ่ง
- ไม่มี router: หนึ่งไฟล์ page ต่อหนึ่ง `Kind` เป็นเนื้อหาภายในหน้าต่างย่อย
- `App.tsx` ดูแลเฉพาะ shell, เมนู และจัดการหน้าต่าง (open/close/focus/move/resize/arrange) ห้ามใส่ business logic, data processing หรือ state เฉพาะหน้า
- แต่ละ page โหลดข้อมูลและจัดการ logic/state ของตัวเอง (sort/filter/transform/pagination); แผนที่ PostGIS ใช้ข้อยกเว้นในหัวข้อ Leaflet
- `.window-content` ใน App คุม padding/scroll/กรอบ/พื้นหลัง; page ปกติ return fragment ห้ามสร้าง chrome เอง ยกเว้น element ที่เนื้อหาต้องมีขนาด เช่น `.map-canvas`
- หน้าที่ต้องเต็มกรอบให้ App ใส่ `window-content flush`; ห้าม page ล้าง padding เอง
- เปิดหน้าอื่นผ่าน callback prop เช่น `onOpenDatabase`; ห้าม import App กลับเข้ามา

### กติกาของไฟล์ใน `pages/` และ `App.tsx`
### เปิดและตั้งชื่อหน้าต่าง

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
- ทุกทาง (Sidebar, File/Help, callback) ต้องผ่าน `open(id: Kind)` ใน App เท่านั้น ห้ามแทรก state เปิดหน้าต่างที่อื่น
- หน้าต่างใหม่ตั้ง `maximized: true` เสมอ; `createChildWindow` เตรียมขนาด/ตำแหน่งสำรองสำหรับ Restore
- หนึ่ง Kind มีได้หนึ่งบาน: เปิดซ้ำให้ `focus(id)` และคืน `minimized: false`
- ประกอบชื่อที่ `windowTitle(id)` แห่งเดียวจาก `titles[id]` และ `sources[id]`: `{ชื่อหน้า} - {basename ของไฟล์ page ไม่รวมนามสกุล}` ห้าม hardcode ชื่อประกอบที่อื่น
- ใช้ `windowTitle(id)` กับหัวหน้าต่าง, region aria-label, ปุ่ม Minimize/Maximize/Restore/Close, dock, เมนู Window และ status bar; ชื่อที่เห็นต้องตรงกับ accessible name
- คำสั่งเปิดหน้าใน sidebar/เมนู File ใช้ `titles[id]` อย่างเดียว

### เพิ่มหน้าใหม่ ต้องแตะ 4 จุด
### เพิ่มหน้า

1. สร้าง `pages/XxxPage.tsx` ตามกติกาข้างบน
2. เพิ่มค่าใน type `Kind` (`App.tsx`)
3. เพิ่ม entry ใน `titles` และ `icons` (`App.tsx`) — ถ้าไอคอนยังไม่มี ให้เพิ่ม path ใน `Icon.tsx`
4. เพิ่มบรรทัด conditional render ใน `.window-content` (ถ้าต้องเต็มกรอบ ให้เพิ่มเงื่อนไขคลาส `flush` ด้วย)
1. สร้าง `pages/<group>/XxxPage.tsx`
2. เพิ่ม `Kind` ใน App
3. เพิ่ม `titles`, `icons`, `sources` ใน App (`sources` ตรง basename); เพิ่ม path ใน `Icon.tsx` ถ้าจำเป็น
4. เพิ่ม conditional render ใน `.window-content` และเงื่อนไข `flush` ถ้าต้องเต็มกรอบ
5. เพิ่ม Kind ใน `groups` ถ้าต้องแสดง sidebar; เพิ่มคำสั่ง File/เกี่ยวกับเองถ้าต้องการ ส่วนเมนู Window มาจากหน้าต่างที่เปิดอยู่โดยอัตโนมัติ

sidebar และเมนู Window ได้รายการใหม่เองอัตโนมัติ เพราะ render มาจาก `titles` ไม่ต้องแก้เพิ่ม
ส่วนเมนู File ถ้าอยากมีรายการเปิดหน้านั้น ต้องเพิ่มเอง
## Data grid: shared component

- ทุก data grid ทั้งใน page และ dialog ต้องใช้ `SortableTable` จาก `src/renderer/src/SortableTable.tsx`; ห้ามสร้าง `<table>` สำหรับ data grid หรือเขียน logic sort ซ้ำในแต่ละหน้า
- ทุกหัวคอลัมน์ต้องคลิกสลับ ASC/DESC ได้ พร้อมตัวบอกทิศทางและ `aria-sort`; ดูแลพฤติกรรมนี้ที่ shared component แห่งเดียว
- แต่ละหน้ารับผิดชอบโหลด/กรองข้อมูลและกำหนดคอลัมน์ ส่วน state การ sort อยู่ในแต่ละ instance ของ `SortableTable` ห้ามย้ายไป `App.tsx`
- ค่าที่แสดงต่างจากค่าที่ใช้เรียง ให้ส่ง `data-sort-value` บน cell เช่น timestamp สำหรับวันเวลา หรือเลขจริงสำหรับค่าที่แสดงเป็น `-`; เรียงตัวเลขและวันเวลาตามค่า ไม่ใช่ข้อความที่จัดรูปแบบ
- เพิ่ม data grid ใหม่หรือปรับพฤติกรรมร่วม ต้องใช้/แก้ shared component นี้ เพื่อให้ทุกหน้าทำงานเหมือนกัน

## เวอร์ชัน

- `package.json` field `version` เป็นแหล่งเดียว ห้ามสร้างไฟล์เวอร์ชันแยกหรือ hardcode ที่อื่น
- `electron.vite.config.ts` ฉีด `__APP_VERSION__` ตอน build; `TitleBar.tsx` แสดง `PlkGap version {version}`; type อยู่ใน `src/renderer/src/env.d.ts` (renderer เป็น sandbox ไม่อ่านไฟล์ runtime)
- เมื่อ user สั่ง build/ทำตัวติดตั้ง **ต้องถามก่อนว่า "จะอัปเวอร์ชันไหม"** ห้ามอัปเองหรือข้ามคำถาม: ถ้าอัปให้แก้ตามที่ user ระบุ ถ้าไม่อัปให้ใช้เลขเดิม
- `npm run build` / `npm test` ที่ agent รันเพื่อตรวจงานเองไม่ต้องถาม

## ฐานข้อมูล: PGlite + PostGIS

DB เป็น **embedded PostgreSQL (WASM) รันในโปรเซส Electron** ไม่มี server, ไม่มีพอร์ต, ไม่มี Docker
ข้อมูลอยู่ที่ `userData/plkgap-pglite`
Embedded PostgreSQL (WASM) ใน Electron; ไม่มี server/พอร์ต/Docker; ข้อมูลอยู่ `userData/plkgap-pglite`

### กติกา
- DB อยู่ main process เท่านั้น; ห้าม renderer import `@electric-sql/pglite` หรือ `src/main/database.ts`; คง `sandbox: true`, `nodeIntegration: false`
- SQL ทั้งหมดอยู่ `src/main/database.ts`; ฟังก์ชันรับ `db` เป็น argument ไม่อ่าน global ส่วน `index.ts` ต่อสาย/ตรวจสิทธิ์เท่านั้น
- ทุก `ipcMain.handle` เรียก `authorizedWindow(event)` ซึ่งตรวจทั้ง sender และ senderFrame; ห้ามคัดลอกเงื่อนไขหรือข้ามการตรวจ
- PGlite มี instance เดียว เปิดใน `app.whenReady()` ก่อนสร้างหน้าต่าง; คง single-instance lock และห้ามเปิด instance ที่สองชี้ path เดิม
- ปิดแอปสองขั้น: confirm ที่ event `close` ของหน้าต่าง (ไม่ใช่ IPC `window:close`) ให้ครอบคลุม X/Exit/Alt+F4/taskbar แล้วให้ `before-quit` รอ `db.close()`; คง `confirming`/`confirmedExit` กัน dialog ซ้อนและวนซ้ำ
- Schema/migration อยู่ใน `initializeSchema(db)` ที่ `openDatabase()` เรียกก่อน return ต้อง idempotent; ห้ามสร้างตารางแยกใน startup
- Init schema ครั้งแรกและเมื่อเวอร์ชัน component เปลี่ยนเท่านั้น: `schema_init` เก็บเวอร์ชันแต่ละ component; เปิดครั้งถัดไปอ่านหนึ่งแถวต่อ component แล้วข้าม ห้ามไล่ `CREATE`/`ALTER` ทุกครั้ง

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
### ตารางสองกลุ่ม ห้ามสลับวิธี init

### เพิ่ม operation ใหม่ ต้องแตะ 4 จุด (เรียงตามลำดับนี้)
- **`c_*` (120 reference tables)**: โครงสร้าง/แถวมาจาก `src/main/reference/c-tables.json` เป็น upstream ล้วน ผู้ใช้ไม่แก้; เมื่อเวอร์ชันใหม่ `loadReferenceTables()` ใช้ DROP/สร้าง/โหลดใหม่ทั้งชุดได้
- **52 แฟ้ม (`person`, `home`, `service`, ...)**: โครงสร้างจาก `src/main/reference/f43-tables.json` ไม่มีแถวติดมา; ต้องรักษาข้อมูล import สะสมเสมอ
  - `createFileTables()` เป็น additive เท่านั้น: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
  - **ห้าม `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` แม้อัปเกรด schema**; เทสต์ต้องยืนยันว่าแถวเดิมอยู่ครบหลัง re-init/upgrade
- JSON ทั้งคู่สร้างโดย `scripts/pull-reference-tables.mjs` จาก SUB-HDC; รายชื่อ 52 แฟ้มอ่าน `c_file` ห้าม hardcode
- **กลุ่มที่สามคือตารางของแอปเอง** (`import52files_log`, `structure_check_log`, `observ_check`) สร้างใน `createAppTables()`; **ห้ามตั้งชื่อขึ้นต้น `c_`** เพราะ prefix นี้สงวนให้ reference ของ upstream และ `scripts/test-database.ts` นับตารางที่ `LIKE 'c\_%'` เทียบกับจำนวนที่ `loadReferenceTables()` บันทึกไว้

1. `src/shared/api.ts` — เพิ่ม type ของผลลัพธ์ และ method ใน `AppApi` (contract กลางของทั้ง 3 ชั้น)
2. `src/main/database.ts` — เขียนฟังก์ชัน SQL ใส่ generic ให้ `db.query<T>()` ตาม type ข้อ 1
3. `src/main/index.ts` — `ipcMain.handle('ชื่อ:action', (event) => { authorizedWindow(event); ... })`
4. `src/preload/index.ts` — ต่อ `ipcRenderer.invoke` ตาม `AppApi` (ห้าม expose `ipcRenderer` ตรงๆ ผ่าน contextBridge)
### ทะเบียนข้อสังเกต `observ_check`

renderer เรียกผ่าน `window.api` ที่ประกาศ type ไว้ใน `env.d.ts` แล้ว ไม่ต้องแก้เพิ่ม
ตั้งชื่อ channel เป็น `domain:action` เช่น `database:status`, `window:minimize`
ทะเบียนตัดสินว่า *กฎไหนรันและเรียงอย่างไร* ส่วนโค้ดตัดสินว่า *กฎนั้นถามอะไร*

- SQL ของทุกกฎอยู่ใน `observationRules()` (`database.ts`) เท่านั้น **ห้ามย้าย SQL ลงตาราง**; ทะเบียนเก็บเฉพาะ `rule_id`, `table_name`, `detail`, `level`, `sort_order`, `is_active`
- `syncObservationRules()` เป็นตัวเดียวที่เขียนทะเบียน: เพิ่มกฎใหม่ อัปเดตข้อความ/ลำดับ/ระดับ และลบแถวของกฎที่ถูกถอดจากโค้ด — **ห้ามเขียนทับ `is_active`** เพราะเป็นสวิตช์ของผู้ใช้
- version ของ component `observations` เป็น digest ของแคตตาล็อก จึงไม่เขียนอะไรเมื่อไม่มีอะไรเปลี่ยน
- `level` มีสองค่า: `error` เมื่อแถวเป็นจริงพร้อมกันไม่ได้ และ `warning` เมื่อแค่ดูผิดปกติและต้องให้คนตัดสิน

**เพิ่มกฎใหม่ 2 จุด**: เพิ่มค่าใน `ObservationRuleId` (`api.ts`) แล้วเพิ่ม entry ใน `observationRules()` พร้อม `level`, `columns`, `sql` ที่มี `eligible`/`failed` และ scope ด้วย `importedFromZip` บนแฟ้มตั้งต้น
ทะเบียนรับกฎเข้าเองตอนเปิดแอปครั้งถัดไป ไม่ต้องแตะ IPC/preload/หน้าจอ

- วันที่ 8 หลักใช้ `validObservationDate()`; คอลัมน์ `datetime_*` ใช้ `validObservationStamp()` (รับ 8 หรือ 14 หลัก) แล้วเทียบที่ `left(value, 8)`
- **ห้ามแก้ `validObservationDate()` ให้รับ 14 หลัก** เพราะกฎที่มีอยู่เทียบวันที่ด้วย string ตรง ๆ การปนความยาวจะให้ผลเทียบที่ผิดความหมาย

### ปริมาณข้อมูล: รายเดือน vs รายปีงบ

`countByFiscalYears()` แจกแจงรายเดือนเฉพาะแฟ้มที่บันทึกกิจกรรมและมีวันที่ของตัวเอง

- **ประเภทแฟ้มอ่านจาก `c_files_desc.description`** ที่มีบรรทัด "□/☑ แฟ้มสะสม / แฟ้มบริการ / แฟ้มบริการกึ่งสำรวจ" ของคู่มือ 43 แฟ้ม เป็นที่เดียวที่ upstream บอกประเภท (`c_file.type` เป็น null ทั้ง 52 แถว); ห้าม hardcode รายชื่อแฟ้มสะสม
- `byMonth` เป็นจริงเมื่อ **ไม่ใช่แฟ้มสะสม และ `countingColumn()` ไม่ตกมาที่ `d_update`**; แฟ้มสะสมเป็นทะเบียนยืนพื้น ส่วน `d_update` บอกวันที่แก้แถวล่าสุด ไม่ใช่วันที่เกิดกิจกรรม
- `countingColumn()` จับจากชื่อคอลัมน์ `date_*`/`datetime_*` **ห้ามเปลี่ยนไปอ่าน `c_files_schema.type`** เพราะพจนานุกรมไม่น่าเชื่อถือเรื่องนี้: `clinical_refer.datetime_assess` และ `drug_refer.datetime_dstart` ถูก type เป็น `C` ส่วน `icf.date_serv` ไม่มีในพจนานุกรมเลย
  ผลคือแฟ้มบริการที่ตั้งชื่อวันที่เป็นอย่างอื่น (`procedure_refer.timestart`, `death.ddeath`, `newborn.bdate`) ยังรายงานรายปีงบ เป็นข้อจำกัดที่รู้อยู่

### เพิ่ม operation ตามลำดับ

1. `src/shared/api.ts`: เพิ่ม result type และ method ใน `AppApi` (contract ทั้งสามชั้น)
2. `src/main/database.ts`: เพิ่ม SQL function โดยใช้ `db.query<T>()` ตาม result type
3. `src/main/index.ts`: เพิ่ม `ipcMain.handle('domain:action', ...)` พร้อม `authorizedWindow(event)`
4. `src/preload/index.ts`: ต่อ `ipcRenderer.invoke` ตาม `AppApi`; ห้าม expose `ipcRenderer` ตรงผ่าน contextBridge

Renderer ใช้ `window.api` (type มีใน `env.d.ts` แล้ว); channel ใช้ `domain:action` เช่น `database:status`

### เทสต์

- `scripts/test-database.ts` เรียก `database.ts` ตรงบน temp dir — ตรรกะ DB ใหม่ควรเพิ่มเคสที่นี่
- `scripts/test-electron.mjs` รันแอปจริงด้วย Playwright โดยตั้ง `PLKGAP_TEST_DATA_DIR` ให้ redirect `userData`
  เทสต์จะไม่แตะข้อมูลจริงของผู้ใช้
- Playwright คลิก native dialog ไม่ได้ เทสต์จึง stub `dialog.showMessageBox` ผ่าน `application.evaluate`
  ถ้าแก้ flow การปิดแอป ต้องอัปเดต stub นี้ ไม่งั้นเทสต์จะค้าง
- **เทสต์ต้องต่อเน็ต** เพราะยืนยันว่า tile โหลดสำเร็จจริง (`naturalWidth > 0`) ไม่ใช่แค่มี `<img>`
  ตัวนี้มีไว้จับกรณีมีคนรัด CSP กลับจนบล็อกภาพ
- `scripts/test-database.ts` เรียก database.ts บน temp dir; เพิ่มเคสเมื่อเพิ่มตรรกะ DB
- `scripts/test-electron.mjs` รันแอปจริงด้วย Playwright; ใช้ `PLKGAP_TEST_DATA_DIR` redirect userData เพื่อไม่แตะข้อมูลจริง
- Stub `dialog.showMessageBox` ผ่าน `application.evaluate` เพราะ Playwright คลิก native dialog ไม่ได้; แก้ flow ปิดแอปต้องอัปเดต stub เพื่อไม่ให้เทสต์ค้าง
- เทสต์ต้องต่อเน็ตและตรวจ tile `naturalWidth > 0` ไม่ใช่เพียงมี `<img>` เพื่อจับ CSP บล็อกภาพ

## REST API ในตัว: `src/main/server.ts`

HTTP server จาก `node:http` ใน main process เปิดพร้อมแอปหลัง `openDatabase()` ใช้ PGlite instance เดียวกับหน้าจอ

- **ผูกกับ `127.0.0.1` เท่านั้น และห้ามส่ง CORS header** — ถ้าใส่ `Access-Control-Allow-Origin` เว็บใดก็ตามที่ผู้ใช้เปิดอยู่จะอ่านฐานข้อมูลสุขภาพผ่านเบราว์เซอร์ได้ทันที
- พอร์ตเริ่มต้น 9988 ปรับด้วย env `PLKGAP_API_PORT` (เทสต์ใช้ 9989 จะได้ไม่ชนกับแอปที่เปิดค้างไว้)
- พอร์ตไม่ว่างให้ log แล้วปล่อยผ่าน แอปต้องเปิดได้เสมอ; ปิด server ก่อน `db.close()` ใน `before-quit`
- **`server.ts` ไม่เขียน SQL เอง** ทำหน้าที่ route กับแปลง JSON เท่านั้น ตามกติกาเดียวกับ `index.ts`
- `POST /sql` รันใน read-only transaction พร้อม `statement_timeout` 15 วินาที
  - **ให้ PostgreSQL เป็นคนปฏิเสธการเขียน ห้ามใช้ blacklist คำสั่ง** เพราะ data-modifying CTE (`WITH x AS (DELETE ...)`) เล็ดลอดการตรวจ keyword ได้ และข้อมูล 52 แฟ้มห้ามถูกลบเด็ดขาด
  - timeout จำเป็นเพราะ PGlite อยู่โปรเซสเดียวกับหน้าจอ query ที่วิ่งยาวจะทำให้แอปค้าง
  - ผลลัพธ์เป็น JSON array ล้วนตามสัญญา ส่วน metadata (`X-Row-Count`, `X-Truncated`, `X-Columns`) อยู่ใน header
- endpoint ใหม่ให้เพิ่มใน `route()` แล้วเพิ่มรายการใน `help` ด้วยเสมอ `GET /help` คือเอกสารเดียวของ API นี้

### Guardrail ข้อมูลส่วนบุคคลของ `POST /sql`

รายชื่อคอลัมน์ที่ปิดบังอยู่ที่ `blockedApiColumns` ใน `database.ts` ที่เดียว ค่าที่ได้คือ `***`

- **ปิดบังในฐานข้อมูล ไม่ใช่ที่ชื่อคอลัมน์ของผลลัพธ์** — `createApiSchema()` สร้าง view หนึ่งตัวต่อหนึ่งตารางใน schema `api` โดยแทนค่าคอลัมน์ที่ห้ามด้วย `'***'` แล้ว `runReadOnlySql()` ทำ `SET LOCAL ROLE plkgap_api` + `SET LOCAL search_path = api, public`
- **ห้ามเปลี่ยนไปตรวจชื่อคอลัมน์ที่ query คืนมา** เพราะ `SELECT cid AS x`, `length(cid)` และ subquery เลี่ยงได้หมด แต่การแทนค่าใน view กันได้ทั้งสามแบบ (มีเทสต์ยืนยันทุกเคส)
- role `plkgap_api` **ไม่มีสิทธิ์ใด ๆ บน schema `public`** มีแค่ `USAGE` ไว้ให้ฟังก์ชัน PostGIS resolve ได้ ดังนั้น `SELECT ... FROM public.person` ถูกปฏิเสธ ไม่ใช่ตอบกลับ
- entry ที่ระบุ `table` จะปิดบังเฉพาะแฟ้มนั้น (เช่น `home.house`) ส่วน entry ที่ไม่ระบุจะปิดบังทุกแฟ้มที่มีคอลัมน์ชื่อนั้น
- component `api` ใน `schema_init` คุมการ rebuild ด้วย digest ของรายชื่อที่ห้าม + โครงสร้างทุกตาราง จึงสร้าง view ใหม่เมื่อมีคอลัมน์เปลี่ยนเท่านั้น และต้องรันเป็นขั้นสุดท้ายของ `initializeSchema()`
- `GET /desc` และ `GET /tables` ยังรันในสิทธิ์เจ้าของ จึงบอกได้ว่าคอลัมน์ที่ปิดบังมีอยู่ แต่ไม่คืนค่าของมัน

## เครือข่าย & CSP

แอปนี้ **ไม่ใช่ offline-only** เรียก API ภายนอกได้ และจะมีเพิ่มอีกมาก
CSP อยู่ใน meta tag ที่ `src/renderer/index.html`
CSP อยู่ meta tag ใน `src/renderer/index.html`; แอปเรียก API ภายนอกได้ ไม่ใช่ offline-only

- `img-src 'self' data: https:` และ `connect-src 'self' https: ws://localhost:*`
  → **เพิ่ม API ใหม่ไม่ต้องแก้ CSP** ไม่ต้องไล่ whitelist host ทีละอัน
- **`script-src 'self'` ห้ามผ่อนเด็ดขาด** ห้ามใส่ CDN, `'unsafe-inline'`, `'unsafe-eval'` ใน production
  ต้องการ lib ไหนให้ลงผ่าน npm แล้วให้ Vite bundle
  (`'unsafe-inline'` ถูกเติมเฉพาะตอน dev โดย plugin ใน `electron.vite.config.ts` ไม่หลุดไป build)
- การพาผู้ใช้ออกนอกแอปยังถูกบล็อกหมด (`will-navigate`, `setWindowOpenHandler`) ดึงข้อมูลเข้าได้ แต่ navigate ออกไม่ได้
- เรียก API ที่ renderer ด้วย `fetch` ได้ตามปกติ **แต่ถ้ามี API key หรือ secret ให้ย้ายไปเรียกใน main process**
  แล้วส่งผลกลับผ่าน IPC — CSP ไม่ได้กันการรั่วของ key และโค้ด renderer ผู้ใช้เปิดดูได้
- คง `img-src 'self' data: https:` และ `connect-src 'self' https: ws://localhost:*`; เพิ่ม API/layer ไม่ต้อง whitelist host หรือแก้ CSP
- **ห้ามผ่อน `script-src 'self'` ใน production**: ห้าม CDN, `'unsafe-inline'`, `'unsafe-eval'`; ลง library ผ่าน npm ให้ Vite bundle (`'unsafe-inline'` เติมเฉพาะ dev โดย plugin ใน `electron.vite.config.ts`)
- คงการบล็อก navigate ออกด้วย `will-navigate`/`setWindowOpenHandler`; ดึงข้อมูลเข้าได้
- Renderer ใช้ `fetch` ได้ แต่ API ที่มี key/secret ต้องเรียกจาก main แล้วส่งผลผ่าน IPC; CSP ไม่ป้องกัน key รั่ว

## แผนที่: Leaflet

`pages/MapPage.tsx` ใช้ Leaflet 1.9 ตรงๆ (ไม่มี react-leaflet)
`MapPage` ใช้ Leaflet 1.9 โดยตรง ไม่มี react-leaflet

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
- สร้าง map ใน `useEffect`; cleanup ต้อง `map.remove()` เพื่อรองรับ StrictMode
- ต้องมี `ResizeObserver` → `map.invalidateSize()` รองรับ MDI resize/maximize
- คงการแก้ marker URL ครั้งเดียวที่หัวไฟล์: import PNG ผ่าน Vite ร่วมกับ `L.Icon.Default.mergeOptions` หรือ `delete L.Icon.Default.prototype._getIconUrl` + `L.icon(...)`; ห้ามลบหรือทำซ้ำ
- สลับ base layer ด้วย `L.control.layers`: OSM (`Street map`) และ Esri (`Satellite`)
- PostGIS ใช้ `ST_AsGeoJSON` ผ่านขั้นตอนเพิ่ม operation แล้วส่ง GeoJSON เป็น props; ห้าม `MapPage` เรียก `window.api` เอง
