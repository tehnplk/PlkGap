import { BrowserWindow } from 'electron'

/**
 * The window that stands in for the app while the embedded database opens. First start seeds the
 * whole catalog and the geography lookup, which takes long enough that an empty screen looks hung.
 *
 * The page is a static data URL with no script of its own: main writes the status line into it, so
 * there is nothing to load from disk and nothing for the page to execute.
 */
const phases: Record<string, string> = {
  postgis: 'เปิดฐานข้อมูลและส่วนขยายเชิงพื้นที่',
  reference: 'เตรียมพจนานุกรมและทะเบียนหน่วยบริการ',
  geography: 'เตรียมข้อมูลพื้นที่ จังหวัด อำเภอ ตำบล',
  app: 'เตรียมตารางของแอป',
  observations: 'เตรียมทะเบียนข้อสังเกต',
  files43: 'เตรียมตาราง 52 แฟ้ม',
  structure_codes: 'เตรียมรหัสมาตรฐาน',
  api: 'เตรียมมุมมองสำหรับ API',
}

const page = (version: string) => `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html lang="th"><head><meta charset="utf-8"><title>PlkGap</title><style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; justify-content: center;
    gap: 14px; padding: 30px 34px; font-family: "Segoe UI", sans-serif; color: #30263f;
    background: linear-gradient(140deg, #ffffff 0%, #f3eef9 55%, #e7dcf7 100%);
    border: 1px solid #ddd2eb; border-radius: 10px; user-select: none; cursor: default; }
  h1 { margin: 0; font-size: 30px; letter-spacing: 1px; color: #7843b5; font-weight: 600; }
  /* The version rides on the title line, small enough not to compete with the name. */
  h1 span { margin-left: 10px; font-size: 13px; font-weight: 500; letter-spacing: 0; color: #6d607d; }
  p { margin: 0; font-size: 12px; color: #6d607d; }
  #status { min-height: 16px; font-size: 12px; color: #473655; }
  .bar { height: 5px; border-radius: 4px; background: #e2d5f4; overflow: hidden; }
  .bar span { display: block; width: 40%; height: 100%; border-radius: 4px; background: #7843b5;
    animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
</style></head><body>
  <h1>PLK GAP <span>version ${version}</span></h1>
  <p>ระบบตรวจคุณภาพข้อมูล 43 แฟ้ม</p>
  <div class="bar"><span></span></div>
  <p id="status">กำลังเริ่มต้น...</p>
</body></html>`)}`

export function createSplash(version: string) {
  const window = new BrowserWindow({
    width: 420,
    height: 220,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Never take the keyboard: the app window has to come up focused behind it.
    focusable: false,
    show: false,
    backgroundColor: '#f3eef9',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.showInactive() })
  void window.loadURL(page(version))
  const shownAt = Date.now()
  return {
    phase(name: string) {
      const label = phases[name] ?? name
      if (window.isDestroyed()) return
      void window.webContents.executeJavaScript(
        `document.getElementById('status').textContent = ${JSON.stringify(label)}`).catch(() => {})
    },
    /** Never blink: a warm start finishes in milliseconds, and a flash reads as a glitch. */
    async close(minimumMs = 700) {
      const left = minimumMs - (Date.now() - shownAt)
      if (left > 0) await new Promise((resolve) => setTimeout(resolve, left))
      if (!window.isDestroyed()) window.destroy()
    },
  }
}
