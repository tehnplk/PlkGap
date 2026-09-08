import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { PGlite } from '@electric-sql/pglite'
import { blockedApiColumns, describeTable, listTables, MASK, runReadOnlySql } from './database'

/**
 * A small HTTP front door onto the same PGlite instance the app uses, for tools on this machine.
 *
 * Bound to loopback on purpose: the API is never reachable from the network, and it sends no CORS
 * headers, so a web page the user happens to be visiting cannot read the database through the
 * browser. Any program running as this user still can — that is the intended, and only, access.
 * SQL lives in `database.ts`; this file routes and serialises, and writes none of its own.
 */
const HOST = '127.0.0.1'
export const apiPort = Number(process.env.PLKGAP_API_PORT) || 9988
const MAX_BODY = 1024 * 1024
const MAX_ROWS = 5000

const help = {
  service: 'PlkGap local API',
  baseUrl: `http://localhost:${apiPort}`,
  note: 'บริการนี้ผูกกับ 127.0.0.1 เท่านั้น เครื่องอื่นในเครือข่ายเรียกไม่ได้',
  endpoints: [
    { method: 'GET', path: '/help', returns: 'เอกสารชุดนี้' },
    {
      method: 'GET', path: '/tables',
      returns: 'รายชื่อตารางทั้งหมดพร้อมกลุ่ม: file43 (52 แฟ้ม), reference (c_*), app (ของ PlkGap), postgis',
      query: { rows: 'ใส่ rows=1 เพื่อนับจำนวนแถวจริงของทุกตาราง ไม่ใส่จะได้ rowCount เป็น null และตอบเร็ว' },
      example: `curl http://localhost:${apiPort}/tables?rows=1`,
    },
    {
      method: 'GET', path: '/desc/{table_name}',
      returns: 'โครงสร้างตาราง: คอลัมน์ ชนิด primary key index จำนวนแถว และคำอธิบายภาษาไทยจากคู่มือ 43 แฟ้ม',
      example: `curl http://localhost:${apiPort}/desc/person`,
    },
    {
      method: 'POST', path: '/sql',
      body: 'SQL หนึ่งคำสั่ง ส่งเป็น text/plain ตรง ๆ หรือ application/json รูปแบบ {"sql": "..."}',
      returns: 'JSON array ของแถวผลลัพธ์ แถวละหนึ่ง object',
      masked: {
        columns: blockedApiColumns.map((entry) => entry.table ? `${entry.table}.${entry.column}` : entry.column),
        value: MASK,
        how: 'ปิดบังตั้งแต่ในฐานข้อมูล คำสั่งจึงได้ค่า ' + MASK + ' เสมอ ไม่ว่าจะเปลี่ยนชื่อคอลัมน์ ใส่ฟังก์ชัน หรือใช้ SELECT *',
      },
      headers: {
        'X-Row-Count': 'จำนวนแถวที่คำสั่งได้จริง',
        'X-Truncated': `true เมื่อผลลัพธ์เกิน ${MAX_ROWS} แถวและถูกตัด`,
        'X-Columns': 'ชื่อคอลัมน์คั่นด้วยจุลภาค มีประโยชน์เมื่อผลลัพธ์ว่าง',
      },
      examples: [
        `curl -X POST http://localhost:${apiPort}/sql -H 'Content-Type: text/plain' --data 'SELECT hospcode, pid FROM person LIMIT 10'`,
        `curl -X POST http://localhost:${apiPort}/sql -H 'Content-Type: application/json' -d '{"sql":"SELECT COUNT(*) AS n FROM service"}'`,
      ],
    },
  ],
  rules: [
    'อ่านอย่างเดียว: คำสั่งรันใน read-only transaction ที่ PostgreSQL บังคับเอง INSERT/UPDATE/DELETE/DROP/TRUNCATE จะถูกปฏิเสธ',
    `ข้อมูลส่วนบุคคลถูกปิดบังเป็น ${MASK} ดูรายชื่อคอลัมน์ที่ masked ได้ในหัวข้อ /sql`,
    'เรียกชื่อตารางเปล่า ๆ เช่น FROM person อย่านำหน้าด้วย public. เพราะ API อ่านได้เฉพาะ view ที่ปิดบังไว้แล้ว',
    'หนึ่งคำขอต่อหนึ่งคำสั่ง ปิดท้ายด้วย ; ได้แต่ใส่หลายคำสั่งไม่ได้',
    `ผลลัพธ์ถูกตัดที่ ${MAX_ROWS} แถว ใส่ LIMIT/OFFSET เองเมื่อต้องการมากกว่านั้น`,
    'คำสั่งที่รันเกิน 15 วินาทีจะถูกยกเลิก เพราะฐานข้อมูลอยู่ในโปรเซสเดียวกับหน้าจอ',
    'ชื่อตารางทั้งหมดดูได้จาก GET /tables หรือ SELECT file_name FROM c_file สำหรับ 52 แฟ้ม',
  ],
  errors: { shape: '{"error": "ข้อความ"}', statuses: [400, 404, 405, 413, 500] },
}

/** Postgres hands back bigint as BigInt and timestamps as Date; neither survives JSON as it is. */
function jsonSafe(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}

function send(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  const body = Buffer.from(JSON.stringify(payload, jsonSafe, 2) + '\n', 'utf8')
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.byteLength,
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(body)
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY) { reject(new Error('too-large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/** Accepts the statement as plain text, or as `{ "sql": "..." }` when sent as JSON. */
function statementOf(body: string, contentType: string) {
  if (!contentType.includes('application/json')) return body
  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { sql?: unknown }).sql !== 'string') {
    throw new Error('รูปแบบ JSON ต้องเป็น {"sql": "..."}')
  }
  return (parsed as { sql: string }).sql
}

async function route(db: PGlite, request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', `http://${HOST}:${apiPort}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (request.method === 'GET' && (path === '/' || path === '/help')) return send(response, 200, help)
  if (path === '/tables') {
    if (request.method !== 'GET') return send(response, 405, { error: 'ต้องเรียกด้วย GET' }, { Allow: 'GET' })
    const rows = (url.searchParams.get('rows') ?? '').toLowerCase()
    return send(response, 200, await listTables(db, ['1', 'true', 'yes'].includes(rows)))
  }
  if (path.startsWith('/desc/')) {
    if (request.method !== 'GET') return send(response, 405, { error: 'ต้องเรียกด้วย GET' }, { Allow: 'GET' })
    const table = decodeURIComponent(path.slice('/desc/'.length))
    const description = await describeTable(db, table)
    return description
      ? send(response, 200, description)
      : send(response, 404, { error: `ไม่พบตาราง ${table}` })
  }
  if (path === '/sql') {
    if (request.method !== 'POST') return send(response, 405, { error: 'ต้องเรียกด้วย POST' }, { Allow: 'POST' })
    const body = await readBody(request)
    const answer = await runReadOnlySql(db, statementOf(body, request.headers['content-type'] ?? ''), MAX_ROWS)
    // The rows themselves are the body, as asked; everything about them travels in headers.
    return send(response, 200, answer.rows, {
      'X-Row-Count': String(answer.rowCount),
      'X-Truncated': String(answer.truncated),
      'X-Columns': answer.columns.join(','),
    })
  }
  send(response, 404, { error: `ไม่รู้จัก ${path} — ดู GET /help` })
}

/**
 * Starts the API. A port already in use is reported and then let go: the app itself must still
 * open, so the API is simply absent for that run.
 */
export async function startApiServer(db: PGlite) {
  const server = createServer((request, response) => {
    void route(db, request, response).catch((reason: unknown) => {
      // Everything that reaches here came out of the caller's own request or SQL, so it is a 400.
      const message = reason instanceof Error ? reason.message : String(reason)
      if (message === 'too-large') return send(response, 413, { error: `คำขอใหญ่เกิน ${MAX_BODY} ไบต์` })
      send(response, 400, { error: message })
    })
  })
  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      console.error(error.code === 'EADDRINUSE'
        ? `PlkGap: port ${apiPort} is taken, the local API is not running`
        : `PlkGap: the local API failed to start — ${error.message}`)
      resolve(false)
    })
    server.listen(apiPort, HOST, () => {
      console.log(`PlkGap: local API on http://${HOST}:${apiPort} (GET /help)`)
      resolve(true)
    })
  })
  return {
    port: apiPort,
    listening,
    close: () => new Promise<void>((resolve) => {
      if (!listening) return resolve()
      // Keep-alive sockets would hold the close open past the app's own shutdown.
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}
