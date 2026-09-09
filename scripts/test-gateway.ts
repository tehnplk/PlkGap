import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGateway } from '../src/main/gateway.ts'

/** A listener that records how often it was started and closed, without binding a port. */
function fakeServer() {
  const calls = { started: 0, closed: 0 }
  let listening = true
  const start = async () => {
    calls.started += 1
    const handle = {
      get listening() { return listening },
      close: async () => { calls.closed += 1 },
    }
    return handle
  }
  return { calls, start, fail: () => { listening = false }, recover: () => { listening = true } }
}

const preference = async (directory: string) =>
  JSON.parse(await readFile(join(directory, 'api-gateway.json'), 'utf8'))

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'plkgap-gateway-'))
  try {
    // A fresh install keeps the behaviour it always had: the local API comes up with the app.
    const first = fakeServer()
    const gateway = createGateway(directory, 9988, first.start)
    assert.deepEqual(gateway.state(), { enabled: true, listening: false, port: 9988 },
      'nothing listens until restore runs')
    assert.deepEqual(await gateway.restore(), { enabled: true, listening: true, port: 9988 })
    assert.equal(first.calls.started, 1)
    await assert.rejects(readFile(join(directory, 'api-gateway.json'), 'utf8'),
      'restoring the default writes no preference')
    console.log('PASS: with no saved preference the API starts, exactly as before the toggle existed')

    assert.deepEqual(await gateway.setEnabled(false), { enabled: false, listening: false, port: 9988 })
    assert.equal(first.calls.closed, 1, 'turning it off closes the listener')
    assert.deepEqual(await preference(directory), { enabled: false }, 'the choice is written to disk')
    assert.deepEqual(await gateway.setEnabled(false), { enabled: false, listening: false, port: 9988 })
    assert.equal(first.calls.closed, 1, 'turning it off twice does not close twice')
    assert.deepEqual(await gateway.setEnabled(true), { enabled: true, listening: true, port: 9988 })
    assert.equal(first.calls.started, 2, 'turning it back on starts a new listener')
    assert.deepEqual(await gateway.setEnabled(true), { enabled: true, listening: true, port: 9988 })
    assert.equal(first.calls.started, 2, 'an already listening server is not started again')
    console.log('PASS: the switch opens and closes the port and each state is idempotent')

    // Shutdown must leave the user's choice alone, or a restart would silently change it.
    await gateway.setEnabled(false)
    const off = fakeServer()
    const reopened = createGateway(directory, 9988, off.start)
    assert.deepEqual(await reopened.restore(), { enabled: false, listening: false, port: 9988 })
    assert.equal(off.calls.started, 0, 'a saved "off" keeps the port closed on the next start')
    await reopened.close()
    assert.deepEqual(await preference(directory), { enabled: false }, 'closing does not rewrite the choice')

    await reopened.resume()
    assert.deepEqual(await reopened.setEnabled(true), { enabled: true, listening: true, port: 9988 })
    await reopened.close()
    assert.equal(off.calls.closed, 1, 'shutdown closes a running listener')
    assert.deepEqual(await preference(directory), { enabled: true },
      'shutdown leaves the saved choice as the user left it')
    await assert.rejects(reopened.setEnabled(false), /stopping/, 'a stopping app refuses to change the setting')
    assert.deepEqual(reopened.state(), { enabled: true, listening: false, port: 9988 })
    const resumed = createGateway(directory, 9988, off.start)
    assert.deepEqual(await resumed.restore(), { enabled: true, listening: true, port: 9988 },
      'and the next start opens the port again')
    await resumed.close()
    console.log('PASS: the saved choice survives shutdown and decides the next start')

    // A port already in use is reported, not silently swallowed; the app still runs.
    const busy = fakeServer()
    busy.fail()
    const blocked = createGateway(directory, 9988, busy.start)
    const failed = await blocked.restore()
    assert.equal(failed.listening, false)
    assert.equal(failed.enabled, true, 'the choice stays on so the user can retry')
    assert.match(failed.error ?? '', /9988/, 'the message names the port')
    busy.recover()
    const retried = await blocked.setEnabled(true)
    assert.deepEqual(retried, { enabled: true, listening: true, port: 9988 }, 'retrying clears the error')
    await blocked.close()
    console.log('PASS: a port that will not open is reported and can be retried')

    // Persist first: if the choice cannot be written, nothing changes. A directory sitting where
    // the temporary file goes fails the write on every platform.
    const blockedWrite = join(directory, 'blocked')
    await mkdir(blockedWrite)
    await writeFile(join(blockedWrite, 'api-gateway.json'), JSON.stringify({ enabled: true }))
    await mkdir(join(blockedWrite, 'api-gateway.json.tmp'))
    const guarded = fakeServer()
    const unwritable = createGateway(blockedWrite, 9988, guarded.start)
    await unwritable.restore()
    await assert.rejects(unwritable.setEnabled(false), 'the write failure reaches the caller')
    assert.equal(unwritable.state().listening, true, 'a failed write leaves the service running')
    assert.equal(unwritable.state().enabled, true, 'and leaves the in-memory choice alone')
    assert.deepEqual(await preference(blockedWrite), { enabled: true }, 'and the saved choice alone')
    await unwritable.close()
    console.log('PASS: a preference that cannot be saved changes nothing')

    // Two clicks in a row must not race the listener into a state nobody asked for.
    const racing = fakeServer()
    const concurrent = createGateway(directory, 9988, racing.start)
    await concurrent.restore()
    const results = await Promise.all([
      concurrent.setEnabled(false), concurrent.setEnabled(true), concurrent.setEnabled(false),
    ])
    assert.deepEqual(results.map((entry) => entry.enabled), [false, true, false], 'each call answers in order')
    assert.deepEqual(concurrent.state(), { enabled: false, listening: false, port: 9988 })
    assert.deepEqual(await preference(directory), { enabled: false }, 'the last click is the one that sticks')
    await concurrent.close()
    console.log('PASS: rapid switching is serialised and ends where the last click asked')

    // A damaged preference file is not a reason to refuse to start.
    await writeFile(join(directory, 'api-gateway.json'), '{ not json')
    const damaged = fakeServer()
    const recovered = createGateway(directory, 9988, damaged.start)
    assert.deepEqual(await recovered.restore(), { enabled: true, listening: true, port: 9988 })
    await recovered.close()
    console.log('PASS: an unreadable preference falls back to the default instead of failing')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
