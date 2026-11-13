import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export const SYNC_KEY_PREFIX = 'oot-map:v1:'
export const MAX_SYNC_BODY_BYTES = 256 * 1024
const MAX_SYNC_KEY_LENGTH = 256

export type SyncState = {
  version: number
  updatedAt: number
  entries: Record<string, string>
}

export type SyncUpdateListener = (state: SyncState) => void

let loadedFilePath: string | null = null
let currentState: SyncState = {
  version: 0,
  updatedAt: 0,
  entries: {},
}
const listeners = new Set<SyncUpdateListener>()
let writeQueue: Promise<void> = Promise.resolve()
let writeSequence = 0

/** Resolves the sync-state JSON file path from env or OS-standard user data directory. */
export function resolveSyncFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OCARINA_ATLAS_SYNC_FILE?.trim()
  if (explicit) {
    return path.resolve(explicit)
  }

  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(localAppData, 'OcarinaAtlas', 'sync-state.json')
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), '.local', 'share')
  return path.join(xdgDataHome, 'ocarina-atlas', 'sync-state.json')
}

export function isValidSyncKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  if (!key.startsWith(SYNC_KEY_PREFIX)) return false
  if (key.length <= SYNC_KEY_PREFIX.length || key.length > MAX_SYNC_KEY_LENGTH) return false
  // Reject ASCII control characters.
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

export function isValidSyncValue(value: unknown): value is string | null {
  if (value === null) return true
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_SYNC_BODY_BYTES
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneSyncState(state: SyncState): SyncState {
  return {
    version: state.version,
    updatedAt: state.updatedAt,
    entries: { ...state.entries },
  }
}

function parsePersistedState(raw: unknown): SyncState | null {
  if (!isPlainObject(raw)) return null
  const version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 0 ? raw.version : 0
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0 ? raw.updatedAt : 0

  if (!isPlainObject(raw.entries)) return null
  const entries: Record<string, string> = {}
  for (const [key, val] of Object.entries(raw.entries)) {
    if (isValidSyncKey(key) && typeof val === 'string' && Buffer.byteLength(val, 'utf8') <= MAX_SYNC_BODY_BYTES) {
      entries[key] = val
    }
  }

  return { version, updatedAt, entries }
}

function ensureLoaded(): string {
  const targetPath = resolveSyncFilePath()
  if (loadedFilePath === targetPath) {
    return targetPath
  }

  loadedFilePath = targetPath
  currentState = { version: 0, updatedAt: 0, entries: {} }

  try {
    const text = fs.readFileSync(targetPath, 'utf8')
    const parsed = parsePersistedState(JSON.parse(text) as unknown)
    if (parsed) {
      currentState = parsed
    }
  } catch {
    // Missing or unreadable sync file starts with an empty state.
  }

  return targetPath
}

function schedulePersist(targetPath: string, snapshot: SyncState): void {
  const seq = ++writeSequence
  const payload = JSON.stringify(snapshot, null, 2)

  writeQueue = writeQueue
    .then(async () => {
      const dir = path.dirname(targetPath)
      await fs.promises.mkdir(dir, { recursive: true })
      const tmpPath = `${targetPath}.${process.pid}.${seq}.tmp`
      await fs.promises.writeFile(tmpPath, payload, 'utf8')
      await fs.promises.rename(tmpPath, targetPath)
    })
    .catch(() => {
      // Persistence errors must never crash the live telemetry/sync server.
    })
}

/** Returns a snapshot of the current PC<->tablet sync state. */
export function getSyncState(): SyncState {
  ensureLoaded()
  return cloneSyncState(currentState)
}

/**
 * Merges a patch of `oot-map:v1:*` entries (`null` deletes a key), increments
 * `version` when anything changes, persists asynchronously, and notifies subscribers.
 */
export function updateSyncState(patchEntries: Record<string, string | null>): SyncState {
  const targetPath = ensureLoaded()
  if (!isPlainObject(patchEntries)) {
    throw new TypeError('patchEntries must be a plain object')
  }

  const nextEntries = { ...currentState.entries }
  let changed = false

  for (const [key, value] of Object.entries(patchEntries)) {
    if (!isValidSyncKey(key)) {
      throw new TypeError(`Invalid sync key: ${key}`)
    }
    if (!isValidSyncValue(value)) {
      throw new TypeError(`Invalid sync value for key: ${key}`)
    }

    if (value === null) {
      if (Object.prototype.hasOwnProperty.call(nextEntries, key)) {
        delete nextEntries[key]
        changed = true
      }
    } else if (nextEntries[key] !== value) {
      nextEntries[key] = value
      changed = true
    }
  }

  if (!changed) {
    return cloneSyncState(currentState)
  }

  currentState = {
    version: currentState.version + 1,
    updatedAt: Date.now(),
    entries: nextEntries,
  }

  const snapshot = cloneSyncState(currentState)
  schedulePersist(targetPath, snapshot)

  for (const listener of listeners) {
    try {
      listener(cloneSyncState(snapshot))
    } catch {
      // Isolate listener errors so one bad subscriber cannot break others.
    }
  }

  return snapshot
}

/** Subscribes to sync state updates and returns an unsubscribe function. */
export function subscribeSyncUpdates(listener: SyncUpdateListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Waits for any queued async disk persistence writes to finish. */
export function flushSyncPersistence(): Promise<void> {
  return writeQueue
}

/** Resets in-memory sync state and listeners for unit tests. */
export function resetSyncStateForTests(): void {
  loadedFilePath = null
  currentState = {
    version: 0,
    updatedAt: 0,
    entries: {},
  }
  listeners.clear()
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown, headOnly = false): void {
  const json = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Length': Buffer.byteLength(json).toString(),
  })
  if (headOnly) {
    res.end()
    return
  }
  res.end(json)
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds 256 KB limit')
  }
}

function readJsonBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      totalBytes += buf.byteLength
      if (totalBytes > maxBytes) {
        req.destroy()
        fail(new PayloadTooLargeError())
        return
      }
      chunks.push(buf)
    })

    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as unknown)
      } catch {
        reject(new SyntaxError('Invalid JSON'))
      }
    })

    req.on('error', (err) => {
      fail(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

function extractPatchEntries(body: unknown): Record<string, string | null> | null {
  if (!isPlainObject(body)) return null

  const candidate = Object.prototype.hasOwnProperty.call(body, 'entries') ? body.entries : body
  if (!isPlainObject(candidate)) return null

  const patch: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(candidate)) {
    if (!isValidSyncKey(key) || !isValidSyncValue(value)) {
      return null
    }
    patch[key] = value
  }
  return patch
}

/** Handles `GET`/`HEAD`/`PUT`/`POST /api/sync/state` requests. Returns true if the route matched. */
export async function handleSyncApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== '/api/sync/state') {
    return false
  }

  const method = (req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    sendJson(res, 200, getSyncState(), method === 'HEAD')
    return true
  }

  if (method !== 'PUT' && method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, PUT, POST')
    sendJson(res, 405, { error: 'Method not allowed' })
    return true
  }

  let parsedBody: unknown
  try {
    parsedBody = await readJsonBody(req, MAX_SYNC_BODY_BYTES)
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: 'Payload too large' })
      return true
    }
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return true
  }

  const patch = extractPatchEntries(parsedBody)
  if (!patch) {
    sendJson(res, 400, { error: 'Invalid sync entries payload' })
    return true
  }

  const nextState = updateSyncState(patch)
  sendJson(res, 200, nextState)
  return true
}
