# PlkGap

ห้ามเพิ่ม แก้ไข หรือลบเอกสารนี้โดยไม่ได้รับอนุญาตจาก user

## SSO และบัญชีที่จำไว้ในเครื่อง

- อ่าน `SSO.md` ก่อนแก้ระบบบัญชี; config อยู่ `src/main/sso-config.json` และต้องใช้ Public + PKCE ไม่มี client secret
- ผู้ใช้กำหนดให้จำบัญชีจนกด Logout: ห้ามเพิ่ม auto logout ตามอายุ access token หรือบังคับต่อ SSO ทุกครั้งที่เปิดแอป
- `signed-in` คือบัญชีที่จำไว้ในเครื่อง ไม่ใช่หลักฐานว่า token ยังใช้ได้; ห้ามใช้สถานะนี้อนุญาต remote API หรือยืดอายุ token เอง
- ถ้าเพิ่มหน้าที่ต้อง login ให้ทำทั้ง renderer gate และตรวจ main-process snapshot หลัง `authorizedWindow(event)` ใน IPC; การซ่อนเมนูอย่างเดียวไม่ใช่การป้องกัน ดูตัวอย่างใน `SSO.md` (ปัจจุบันยังไม่ได้บังคับ login ทุกหน้า)
- บัญชีและ token เก็บแบบเข้ารหัสผ่าน `sso-store.ts` ใน main process เท่านั้น; renderer รับเฉพาะสถานะและ profile
- Logout ต้องล้างบัญชีในเครื่องแม้ติดต่อ SSO ไม่ได้; คงการตรวจ JWT ตอน login และการป้องกัน login/restore ที่เสร็จช้ามาทับ Logout
- แก้ lifecycle ให้ตรวจ `npm run test:sso` และหลัง build รัน `node scripts/test-sso-persistence.mjs`; test หลังนี้ยังไม่ได้รวมใน `npm test`

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

## Data grid: shared component

- ทุก data grid ทั้งใน page และ dialog ต้องใช้ `SortableTable` จาก `src/renderer/src/SortableTable.tsx`; ห้ามสร้าง `<table>` สำหรับ data grid หรือเขียน logic sort ซ้ำในแต่ละหน้า
- ทุกหัวคอลัมน์ต้องคลิกสลับ ASC/DESC ได้ พร้อมตัวบอกทิศทางและ `aria-sort`; ดูแลพฤติกรรมนี้ที่ shared component แห่งเดียว
- แต่ละหน้ารับผิดชอบโหลด/กรองข้อมูลและกำหนดคอลัมน์ ส่วน state การ sort อยู่ในแต่ละ instance ของ `SortableTable` ห้ามย้ายไป `App.tsx`
- ค่าที่แสดงต่างจากค่าที่ใช้เรียง ให้ส่ง `data-sort-value` บน cell เช่น timestamp สำหรับวันเวลา หรือเลขจริงสำหรับค่าที่แสดงเป็น `-`; เรียงตัวเลขและวันเวลาตามค่า ไม่ใช่ข้อความที่จัดรูปแบบ

## เวอร์ชัน

- `package.json` field `version` เป็นแหล่งเดียว ห้ามสร้างไฟล์เวอร์ชันแยกหรือ hardcode ที่อื่น
- `electron.vite.config.ts` ฉีด `__APP_VERSION__` ตอน build; `TitleBar.tsx` แสดง `PlkGap version {version}`; type อยู่ใน `src/renderer/src/env.d.ts` (renderer เป็น sandbox ไม่อ่านไฟล์ runtime)
- เมื่อ user สั่ง build/ทำตัวติดตั้ง **ต้องถามก่อนว่า "จะอัปเวอร์ชันไหม"** ห้ามอัปเองหรือข้ามคำถาม: ถ้าอัปให้แก้ตามที่ user ระบุ ถ้าไม่อัปให้ใช้เลขเดิม
- `npm run build` / `npm test` ที่ agent รันเพื่อตรวจงานเองไม่ต้องถาม

## ฐานข้อมูล: PGlite + PostGIS

Embedded PostgreSQL (WASM) ใน Electron; ไม่มี server/พอร์ต/Docker; ข้อมูลอยู่ `userData/plkgap-pglite`

### กติกา

- DB อยู่ main process เท่านั้น; ห้าม renderer import `@electric-sql/pglite` หรือ `src/main/database.ts`; คง `sandbox: true`, `nodeIntegration: false`
- SQL ทั้งหมดอยู่ `src/main/database.ts`; ฟังก์ชันรับ `db` เป็น argument ไม่อ่าน global ส่วน `index.ts` ต่อสาย/ตรวจสิทธิ์เท่านั้น
- ทุก `ipcMain.handle` เรียก `authorizedWindow(event)` ซึ่งตรวจทั้ง sender และ senderFrame; ห้ามคัดลอกเงื่อนไขหรือข้ามการตรวจ
- PGlite มี instance เดียว เปิดใน `app.whenReady()` ก่อนสร้างหน้าต่าง; คง single-instance lock และห้ามเปิด instance ที่สองชี้ path เดิม
- ปิดแอปสองขั้น: confirm ที่ event `close` ของหน้าต่าง (ไม่ใช่ IPC `window:close`) ให้ครอบคลุม X/Exit/Alt+F4/taskbar แล้วให้ `before-quit` รอ `db.close()`; คง `confirming`/`confirmedExit` กัน dialog ซ้อนและวนซ้ำ
- Schema/migration อยู่ใน `initializeSchema(db)` ที่ `openDatabase()` เรียกก่อน return ต้อง idempotent; ห้ามสร้างตารางแยกใน startup
- Init schema ครั้งแรกและเมื่อเวอร์ชัน component เปลี่ยนเท่านั้น: `schema_init` เก็บเวอร์ชันแต่ละ component; เปิดครั้งถัดไปอ่านหนึ่งแถวต่อ component แล้วข้าม ห้ามไล่ `CREATE`/`ALTER` ทุกครั้ง

### ตารางสี่ประเภท: ห้ามสลับวิธี init

ทุกตารางใน `public` อยู่ในประเภทใดประเภทหนึ่งข้างล่างนี้ ตอนเพิ่มตารางใหม่ให้เลือกประเภทก่อน แล้วทำตามวิธี init ของประเภทนั้น

ตอนติดตั้งใหม่ ทุกตารางเป็นหนึ่งในสองแบบนี้ ใช้สองคำนี้เรียกให้ตรงกันทั้งเอกสารและโค้ด

- **fresh table** — ติดตั้งใหม่ได้แค่โครงสร้าง ต้องนับได้ **0 แถว**: ประเภทที่ 3 และ 4; ห้ามมีข้อมูลผู้ใช้หรือแถวตัวอย่างติดมากับตัวติดตั้งเด็ดขาด
- **initial table** — ติดตั้งใหม่มีแถวตั้งต้นมาด้วย และแถวนั้นมาจากโค้ดหรือไฟล์ใน repo เท่านั้น: ประเภทที่ 1 และ 2 (`schema_init` หนึ่งแถวต่อ component ที่ init จริง, `observ_check` คือทะเบียนกฎจาก `observationRules()` ทุกกฎเริ่มที่ `is_active = true`)

`scripts/test-database.ts` ตรวจทั้งสองแบบทันทีหลัง `openDatabase()` ครั้งแรก

**1. ตารางระบบ (2 ตาราง, initial table)** — สถานะของตัวแอปเอง ไม่ใช่ข้อมูลสุขภาพ

- `schema_init` เก็บเวอร์ชันของแต่ละ component สร้างโดย `ensureInitTable()` ก่อนใครเพื่อน; `observ_check` คือทะเบียนกฎข้อสังเกต ดูหัวข้อ "ทะเบียนข้อสังเกต" ข้างล่าง
- `observ_check` seed จาก `observationRules()` ทุกครั้งที่แคตตาล็อกเปลี่ยน — แถวเป็นของโค้ด ไม่ใช่ของผู้ใช้ ยกเว้น `observ_check.is_active` ที่เป็นสวิตช์ของผู้ใช้ **ห้ามเขียนทับตอน seed**

**2. ตารางรหัสมาตรฐาน (128 ตาราง ขึ้นต้น `c_` ทั้งหมด, initial table)** — รายการรหัสและพจนานุกรม มาเต็มชุดตั้งแต่ติดตั้ง; ไม่มีข้อมูลผู้ใช้ จึงสร้างใหม่ได้ทั้งชุด แต่มาจากคนละไฟล์และคนละ component

- **พจนานุกรมและทะเบียนหน่วยบริการ (5 ตาราง)**: รายชื่ออยู่ที่ `src/main/reference/tables-in-use.json` ที่เดียว — พจนานุกรมและรายชื่อแฟ้ม (`c_files_schema`, `c_files_desc`, `c_file`) กับทะเบียนหน่วยบริการ (`c_hospital`, `c_hostype`); โครงสร้าง/แถวมาจาก `c-tables.json` เป็น upstream ล้วน ผู้ใช้ไม่แก้ `loadReferenceTables()` DROP/สร้าง/โหลดใหม่ทั้งชุดได้
  - `c-tables.json` ยังมีตาราง lookup ติดมาครบ แต่ **ไม่ seed** และถูก DROP ทิ้งตอน re-init; **ห้ามเอากลับมาใช้ตรวจรหัส** เพราะสำเนาของมันแตกกันเอง (เช่น `c_home_housetype` มีรหัส 6 แต่ `c_address_housetype` ไม่มี)
  - เปลี่ยนรายชื่อในไฟล์แล้วต้องบวก `REFERENCE_TABLES_REVISION` ไม่งั้นเครื่องที่ติดตั้งแล้วจะไม่ re-seed
- **catalog รหัสมาตรฐานของ PlkGap เอง (120 ตาราง)**: ดูหัวข้อ "รหัสมาตรฐาน" ข้างล่าง; `loadStructureCodeTables()` สร้างใหม่ได้ทั้งชุด
- **เขตปกครอง (3 ตาราง)**: `c_province`, `c_district`, `c_subdistrict` จาก `loadGeographyTables()` — ชื่อและรหัสมาจาก `geography.json` ส่วนคอลัมน์ `geom` เป็น boundary จาก `boundaries.json` ที่ `UPDATE` ทับลงบนแถวชื่อ ไม่ได้แยกเป็นตารางของตัวเอง; DROP/สร้างใหม่ทั้งชุดเมื่อ version เปลี่ยน
  - รหัสในไฟล์ boundary เป็น `TH65`/`TH6501`/`TH650101` ตัด `TH` ออกแล้วตรงกับ CHANGWAT/AMPUR/TAMBON ของ 43 แฟ้ม; ไม่มีรูปจังหวัดมาตรง ๆ รูปจังหวัดจึงเป็น union ของอำเภอ
  - สามตารางนี้ **ไม่นับรวมในสถิติรหัสมาตรฐาน**: `databaseStatus()` รวมเฉพาะ component `reference` กับ `structure_codes` และ `scripts/test-database.ts` `NOT IN ('c_province', 'c_district', 'c_subdistrict')` ตอนนับ — เพิ่มตารางภูมิศาสตร์ใหม่ต้องแก้ข้อยกเว้นทั้งสองที่

**3. ตารางข้อมูลบริการตามโครงสร้างมาตรฐานกระทรวงสาธารณสุข (52 แฟ้ม: `person`, `home`, `service`, ..., fresh table)** — ที่เดียวที่เก็บข้อมูลผู้ใช้

- โครงสร้างจาก `src/main/reference/f43-tables.json` ไม่มีแถวติดมา; ต้องรักษาข้อมูล import สะสมเสมอ
- `createFileTables()` เป็น additive เท่านั้น: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- **ห้าม `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` แม้อัปเกรด schema**; เทสต์ต้องยืนยันว่าแถวเดิมอยู่ครบหลัง re-init/upgrade

**4. ตาราง log (2 ตาราง, fresh table)** — ผลการทำงานที่บันทึกไว้ให้ผู้ใช้ดูย้อนหลัง

- `import52files_log` หนึ่งแถวต่อหนึ่งรอบ import **เป็นข้อมูลผู้ใช้ ต้องรักษาไว้** (`log_import_id` ในแฟ้มอ้างถึงแถวนี้)
- `structure_check_log` คำนวณใหม่จากแถวที่ import ได้เสมอ จึง DROP/สร้างใหม่ตอนอัปเกรดได้

**กติกาข้ามประเภท**

- ประเภทที่ 1, 3, 4 สร้างใน `createAppTables()`/`createFileTables()` — **ห้ามตั้งชื่อขึ้นต้น `c_`** เพราะ prefix นี้สงวนให้ประเภทที่ 2 และ `scripts/test-database.ts` นับตารางที่ `LIKE 'c\_%'` เทียบกับผลรวมของ `loadReferenceTables()` กับ `loadStructureCodeTables()`; บวก `APP_SCHEMA_VERSION` เมื่อเปลี่ยนรูปตารางระบบหรือ log
- ประเภทไม่ได้ตรงกับ component ใน `schema_init` แบบหนึ่งต่อหนึ่ง: ประเภทที่ 2 กระจายอยู่ใน `reference`, `structure_codes`, `geography` ส่วนประเภทที่ 1 กับ 4 อยู่ใน `app` (และ `observations` สำหรับแถวในทะเบียน) — **ห้ามเปลี่ยนชื่อ component ให้ตรงประเภท** เพราะเครื่องที่ติดตั้งแล้วจะ init ซ้ำทั้งหมด
- `c-tables.json` และ `f43-tables.json` สร้างโดย `scripts/pull-reference-tables.mjs`, `geography.json` โดย `scripts/pull-geography.mjs`, `boundaries.json` โดย `scripts/pull-boundaries.mjs`; รายชื่อ 52 แฟ้มอ่าน `c_file` ห้าม hardcode
- ไฟล์ทุกไฟล์ใน `src/main/reference/` ถูก `import` แบบ static ใน `database.ts` จึงถูก bundle ลง `out/main/index.js` และแพ็กเข้าตัวติดตั้ง; ตารางเกิดตอนเปิดแอปครั้งแรก ไม่ใช่ตอน install

### รหัสมาตรฐาน: `structure-codes.json`

รหัสที่ใช้ตรวจ 52 แฟ้มเป็นแคตตาล็อกของ PlkGap เอง **ไม่ใช้ตาราง lookup ที่ติดมากับ `c-tables.json`** มีสองแหล่งตามลำดับ

1. รายการรหัสมาตรฐานที่เผยแพร่ → `scripts/pull-standard-codes.mjs` → `src/main/reference/standard-codes.json`
2. `c_files_schema.description` เฉพาะฟิลด์ที่แหล่งแรกไม่ครอบคลุม — **รายการที่เผยแพร่ชนะเสมอ** คำอธิบายในพจนานุกรมห้ามทับ

`scripts/generate-structure-codes.mjs` รวมสองแหล่งเป็น `structure-codes.json` แล้ว `loadStructureCodeTables()` seed ภายใต้ component `structure_codes` **ก่อน** สร้าง api view

- ทุก entry ใน pull script ต้องระบุ `fields` เป็น `<แฟ้ม>.<คอลัมน์>` และ script จะ throw ถ้าฟิลด์นั้นไม่มีใน `c_files_schema`
- รายการที่ใช้ร่วมกันหลายฟิลด์ทำเป็น **ตารางเดียว + binding หลายเส้น** (`c_instype`, `c_servplace`, `c_chargeitem`, `c_diagtype`, `c_fptype`, `c_housetype`, `c_person_prename`, `c_person_nation`, `c_person_sex`) ห้ามทำสำเนาตารางต่อฟิลด์
- `ruleTests()` หาตารางจาก binding ก่อน แล้วค่อยตกไปที่สูตรชื่อ `c_<แฟ้ม>_<คอลัมน์>`; **เทสต์บังคับว่าต้องไม่มีฟิลด์ไหนพึ่งสูตรชื่อล้วน** และทุกตารางต้องมี binding หรืออยู่ใน `unbound` พร้อมเหตุผล
- `c_clinic_department` ตั้งใจไม่ผูก เพราะ `CLINIC` เป็นรหัสประกอบ หลักที่ 4-5 หน่วยบริการกำหนดเอง
- ลำดับกฎต่อค่า: `required` → `width` → `unitcode` → `code` รายงานเฉพาะข้อแรกที่ตก — กฎหลังต้องข้ามค่าที่กฎก่อนหน้ารายงานไปแล้วเสมอ ไม่งั้นแถวเดียวถูกนับซ้ำ
- ฟิลด์ที่รายการรหัสมีค่ายาวกว่าความกว้างในพจนานุกรม (`epi.vaccinetype` เป็น C3 แต่มี `HPVG91`) **ไม่ตรวจ width** ตัดสินด้วยรายการอย่างเดียว และกฎ `code` ต้องเห็นทุกค่าที่ไม่ว่าง ไม่งั้นค่ายาวผิด ๆ จะรอดทุกกฎ
- **รหัสที่มาตรฐานถอดออกแล้วถือว่าผิด** ไม่ใช่ผ่านแบบ historical เพราะรหัสที่ยกเลิกมีตัวแทนเสมอ; ข้อความกฎ `code` คือ `ไม่ตรงตามรหัสมาตรฐาน` ไม่ต้องบอกชื่อตารางรหัสในข้อความ — หน้าจอมีปุ่มชื่อฟิลด์ที่เปิดรายการรหัสจาก `finding.reference` อยู่แล้ว
- ฟิลด์รหัสหน่วยบริการต้องเป็นตัวเลขครบตามความกว้าง (5 หรือ 9); คัดฟิลด์จากข้อความในพจนานุกรมด้วย `UNIT_CODE_FIELD` ห้าม hardcode รายชื่อ — `clinic`, `ward*`, `drg`, `an*` กว้างเท่ากันแต่ไม่ใช่รหัสหน่วยบริการ
- รายละเอียดการตัดสินใจแต่ละข้ออยู่ใน `STRUCTURE_CODE_AUDIT.md`

### ทะเบียนข้อสังเกต `observ_check`

ทะเบียนตัดสินว่า *กฎไหนรันและเรียงอย่างไร* ส่วนโค้ดตัดสินว่า *กฎนั้นถามอะไร*

- SQL ของทุกกฎอยู่ใน `observationRules()` (`database.ts`) เท่านั้น **ห้ามย้าย SQL ลงตาราง**; ทะเบียนเก็บเฉพาะ `rule_id`, `table_name`, `detail`, `level`, `sort_order`, `is_active`
- `syncObservationRules()` เป็นตัวเดียวที่เขียนทะเบียน: เพิ่มกฎใหม่ อัปเดตข้อความ/ลำดับ/ระดับ และลบแถวของกฎที่ถูกถอดจากโค้ด — **ห้ามเขียนทับ `is_active`** เพราะเป็นสวิตช์ของผู้ใช้
- version ของ component `observations` เป็น digest ของแคตตาล็อก จึงไม่เขียนอะไรเมื่อไม่มีอะไรเปลี่ยน
- `level` มีสองค่า: `error` เมื่อแถวเป็นจริงพร้อมกันไม่ได้ และ `warning` เมื่อแค่ดูผิดปกติและต้องให้คนตัดสิน — เก็บไว้ในทะเบียน แต่**หน้าจอไม่แสดงระดับ** ทั้งในผลตรวจและตัวเลือกกฎ

**ขอบเขตการค้น**: แถวที่ *รายงาน* จำกัดที่ zip ที่ตรวจเสมอ (`importedFromZip` บนแฟ้มตั้งต้น) แต่แถวที่ใช้ *เทียบ* ค้นข้าม zip ได้ทั้งฐาน — **ต้องผูก `hospcode` เท่ากันทุกครั้ง** เพราะ PID/HID/CID เป็นเลขภายในของแต่ละหน่วยบริการ คนละ `hospcode` คือคนละทะเบียน

- ทุก join/subquery ข้ามแฟ้มต้องมี `hospcode` เป็นเงื่อนไขแรก (`p.hospcode = s.hospcode AND p.pid = s.pid`); `duplicate-cid` นับ CID ซ้ำข้าม zip ด้วย `PARTITION`/`GROUP BY hospcode, cid`
- กฎที่นับข้าม zip ให้ group ครั้งเดียวแล้ว join ห้ามยิง subquery ต่อแถว เพราะ PERSON โตได้เป็นล้านแถว

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

- `scripts/test-database.ts` เรียก database.ts บน temp dir; เพิ่มเคสเมื่อเพิ่มตรรกะ DB
- เทสต์เทียบ `buildStructureCodes(referenceData)` กับ `structure-codes.json` แบบ deepEqual **ต้องรัน `generate-structure-codes.mjs` ทุกครั้งที่แก้ generator หรือดึงข้อมูลใหม่** ไม่งั้นเทสต์ตก
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
