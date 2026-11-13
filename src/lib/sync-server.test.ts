import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  flushSyncPersistence,
  getSyncState,
  handleSyncApiRequest,
  MAX_SYNC_BODY_BYTES,
  resetSyncStateForTests,
  resolveSyncFilePath,
  subscribeSyncUpdates,
  updateSyncState,
  type SyncState,
} from './sync-server'

function createMockReq(method: string, bodyChunks: Array<string | Buffer> = []): http.IncomingMessage {
  const emitter = new EventEmitter() as http.IncomingMessage
  emitter.method = method
  emitter.destroy = () => emitter

  queueMicrotask(() => {
    for (const chunk of bodyChunks) {
      emitter.emit('data', typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
    }
    emitter.emit('end')
  })

  return emitter
}

function createMockRes() {
  let statusCode = 200
  const headers: Record<string, string> = {}
  let body = ''
  let ended = false

  const res = {
    get statusCode() {
      return statusCode
    },
    set statusCode(code: number) {
      statusCode = code
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v
        }
      }
      return res
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        body += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      }
      ended = true
      return res
    },
    get writableEnded() {
      return ended
    },
  } as unknown as http.ServerResponse

  return {
    res,
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getJson: () => (body ? (JSON.parse(body) as Record<string, unknown>) : null),
  }
}

describe('sync-server', () => {
  let tempDir: string
  let syncFilePath: string
  const prevEnvSyncFile = process.env.OCARINA_ATLAS_SYNC_FILE

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocarina-atlas-sync-test-'))
    syncFilePath = path.join(tempDir, 'nested', 'sync-state.json')
    process.env.OCARINA_ATLAS_SYNC_FILE = syncFilePath
    resetSyncStateForTests()
  })

  afterEach(async () => {
    await flushSyncPersistence()
    resetSyncStateForTests()
    if (prevEnvSyncFile === undefined) {
      delete process.env.OCARINA_ATLAS_SYNC_FILE
    } else {
      process.env.OCARINA_ATLAS_SYNC_FILE = prevEnvSyncFile
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves explicit env path or OS default path', () => {
    expect(resolveSyncFilePath({ OCARINA_ATLAS_SYNC_FILE: syncFilePath })).toBe(path.resolve(syncFilePath))
    const fallbackPath = resolveSyncFilePath({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' })
    expect(fallbackPath).toContain('sync-state.json')
  })

  it('starts empty, merges entries, deletes with null, and increments version only on actual changes', () => {
    const initial = getSyncState()
    expect(initial).toEqual({ version: 0, updatedAt: 0, entries: {} })

    const s1 = updateSyncState({
      'oot-map:v1:official-done': '["gs-1"]',
      'oot-map:v1:age-filter': '"adult"',
    })
    expect(s1.version).toBe(1)
    expect(s1.updatedAt).toBeGreaterThan(0)
    expect(s1.entries).toEqual({
      'oot-map:v1:official-done': '["gs-1"]',
      'oot-map:v1:age-filter': '"adult"',
    })

    // Re-applying identical values is a no-op (version stays 1).
    const s1Again = updateSyncState({
      'oot-map:v1:official-done': '["gs-1"]',
      'oot-map:v1:nonexistent': null,
    })
    expect(s1Again.version).toBe(1)

    // Deleting an existing key and updating another bumps version to 2.
    const s2 = updateSyncState({
      'oot-map:v1:age-filter': null,
      'oot-map:v1:official-done': '["gs-1","gs-2"]',
    })
    expect(s2.version).toBe(2)
    expect(s2.entries).toEqual({
      'oot-map:v1:official-done': '["gs-1","gs-2"]',
    })
  })

  it('notifies subscribers on updates and stops after unsubscribe', () => {
    const received: SyncState[] = []
    const unsubscribe = subscribeSyncUpdates((state) => {
      received.push(state)
    })

    // Throwing subscriber must not break subsequent subscribers.
    const unsubscribeBad = subscribeSyncUpdates(() => {
      throw new Error('boom')
    })

    updateSyncState({ 'oot-map:v1:official-visible': 'true' })
    expect(received).toHaveLength(1)
    expect(received[0]?.version).toBe(1)
    expect(received[0]?.entries['oot-map:v1:official-visible']).toBe('true')

    // No-op does not notify.
    updateSyncState({ 'oot-map:v1:official-visible': 'true' })
    expect(received).toHaveLength(1)

    unsubscribe()
    unsubscribeBad()
    updateSyncState({ 'oot-map:v1:official-visible': 'false' })
    expect(received).toHaveLength(1)
  })

  it('persists state asynchronously and reloads cleanly from disk', async () => {
    const updated = updateSyncState({
      'oot-map:v1:pins:kokiri:main': '[{"id":"p1","name":"Test","done":false,"x":0.5,"y":0.5,"type":"other"}]',
    })
    await flushSyncPersistence()

    expect(fs.existsSync(syncFilePath)).toBe(true)

    resetSyncStateForTests()
    const reloaded = getSyncState()
    expect(reloaded).toEqual(updated)
  })

  it('recovers gracefully when persisted JSON is corrupt', () => {
    fs.mkdirSync(path.dirname(syncFilePath), { recursive: true })
    fs.writeFileSync(syncFilePath, '{not valid json', 'utf8')

    expect(getSyncState()).toEqual({ version: 0, updatedAt: 0, entries: {} })
  })

  it('rejects invalid keys or values in updateSyncState', () => {
    expect(() => updateSyncState({ 'bad-key': '1' })).toThrow()
    expect(() => updateSyncState({ 'oot-map:v1:': '1' })).toThrow()
    expect(() => updateSyncState({ 'oot-map:v1:ok\n': '1' })).toThrow()
  })

  it('handles GET, PUT, POST, validation errors, 405, and 256 KB body limit in handleSyncApiRequest', async () => {
    const unmatched = await handleSyncApiRequest(createMockReq('GET'), createMockRes().res, '/api/other')
    expect(unmatched).toBe(false)

    // PUT with { entries: ... }
    const putMock = createMockRes()
    const handledPut = await handleSyncApiRequest(
      createMockReq('PUT', [JSON.stringify({ entries: { 'oot-map:v1:official-done': '["gs-1"]' } })]),
      putMock.res,
      '/api/sync/state',
    )
    expect(handledPut).toBe(true)
    expect(putMock.getStatus()).toBe(200)
    expect(putMock.getJson()).toMatchObject({
      version: 1,
      entries: { 'oot-map:v1:official-done': '["gs-1"]' },
    })

    // POST with flat map
    const postMock = createMockRes()
    await handleSyncApiRequest(
      createMockReq('POST', [JSON.stringify({ 'oot-map:v1:age-filter': '"child"' })]),
      postMock.res,
      '/api/sync/state',
    )
    expect(postMock.getStatus()).toBe(200)
    expect(postMock.getJson()).toMatchObject({
      version: 2,
      entries: {
        'oot-map:v1:official-done': '["gs-1"]',
        'oot-map:v1:age-filter': '"child"',
      },
    })

    // GET returns current state
    const getMock = createMockRes()
    await handleSyncApiRequest(createMockReq('GET'), getMock.res, '/api/sync/state')
    expect(getMock.getStatus()).toBe(200)
    expect(getMock.getJson()).toMatchObject({ version: 2 })

    // Invalid key -> 400
    const badKeyMock = createMockRes()
    await handleSyncApiRequest(
      createMockReq('PUT', [JSON.stringify({ entries: { 'not-oot': '1' } })]),
      badKeyMock.res,
      '/api/sync/state',
    )
    expect(badKeyMock.getStatus()).toBe(400)

    // Invalid JSON -> 400
    const badJsonMock = createMockRes()
    await handleSyncApiRequest(createMockReq('PUT', ['{bad']), badJsonMock.res, '/api/sync/state')
    expect(badJsonMock.getStatus()).toBe(400)

    // Body > 256 KB -> 413
    const hugeMock = createMockRes()
    const oversized = Buffer.alloc(MAX_SYNC_BODY_BYTES + 10, 'a')
    await handleSyncApiRequest(createMockReq('PUT', [oversized]), hugeMock.res, '/api/sync/state')
    expect(hugeMock.getStatus()).toBe(413)

    // Unsupported method -> 405
    const delMock = createMockRes()
    await handleSyncApiRequest(createMockReq('DELETE'), delMock.res, '/api/sync/state')
    expect(delMock.getStatus()).toBe(405)
  })
})
