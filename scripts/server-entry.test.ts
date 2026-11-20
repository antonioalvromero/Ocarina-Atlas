import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LichiiTelemetryState } from '../src/lib/lichii-types'

const MOCK_ACTIVE_SAVE_DIR = 'C:\\Users\\testuser\\AppData\\Roaming\\lichii\\save\\slot_00'

const mockTelemetryState: LichiiTelemetryState = {
  connected: true,
  emulatorRunning: true,
  scene: 0x51,
  placeId: 'kokiri-forest',
  placeSlug: 'kokiri-forest',
  placeName: 'Kokiri Forest',
  mapId: 'kokiri-forest',
  age: 'child',
  position: { x: 10, y: 20, z: 30, yaw: 90 },
  mapFraction: { x: 0.5, y: 0.5 },
  worldMapFraction: null,
  skulltulaCount: 3,
  collectedSkulltulaIds: ['gs-1'],
  authoritativeSkulltulas: true,
  lastCollectedSkulltulaId: null,
  lastPickedItem: null,
  activeSaveDir: MOCK_ACTIVE_SAVE_DIR,
  source: 'memory',
  updatedAt: 1700000000000,
}

vi.mock('../src/lib/lichii-server', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/lichii-server')>('../src/lib/lichii-server')
  return {
    ...actual,
    getLichiiTelemetryState: vi.fn(async () => ({ ...mockTelemetryState })),
    closeLichiiRpc: vi.fn(),
  }
})

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>

interface CapturedResponse {
  statusCode: number
  headers: Record<string, string | string[]>
  body: string
}

function createMockReq(options: {
  method: string
  url: string
  remoteAddress: string
  headers?: Record<string, string>
  body?: string
}): http.IncomingMessage {
  const emitter = new EventEmitter() as http.IncomingMessage
  emitter.method = options.method
  emitter.url = options.url
  emitter.headers = { host: '127.0.0.1:3000', ...options.headers }
  emitter.socket = { remoteAddress: options.remoteAddress } as http.IncomingMessage['socket']

  if (options.body !== undefined) {
    queueMicrotask(() => {
      emitter.emit('data', Buffer.from(options.body ?? '', 'utf8'))
      emitter.emit('end')
    })
  } else {
    queueMicrotask(() => {
      emitter.emit('end')
    })
  }

  return emitter
}

function invokeHandler(
  handler: RequestHandler,
  options: {
    method: string
    url: string
    remoteAddress: string
    headers?: Record<string, string>
    body?: string
  },
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const req = createMockReq(options)
    const headerMap: Record<string, string | string[]> = {}
    const chunks: Buffer[] = []
    let statusCode = 200
    let finished = false

    const res = new EventEmitter() as unknown as http.ServerResponse & {
      statusCode: number
      headersSent: boolean
      writableEnded: boolean
      writableFinished: boolean
      destroyed: boolean
    }
    res.statusCode = 200
    res.headersSent = false
    res.writableEnded = false
    res.writableFinished = false
    res.destroyed = false

    res.setHeader = ((name: string, value: string | number | readonly string[]) => {
      headerMap[name.toLowerCase()] = Array.isArray(value) ? [...value] : String(value)
      return res
    }) as http.ServerResponse['setHeader']

    res.getHeader = ((name: string) => headerMap[name.toLowerCase()]) as http.ServerResponse['getHeader']

    res.writeHead = ((
      code: number,
      reasonOrHeaders?: string | http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
      maybeHeaders?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
    ) => {
      statusCode = code
      res.statusCode = code
      res.headersSent = true
      const rawHeaders = typeof reasonOrHeaders === 'object' ? reasonOrHeaders : maybeHeaders
      if (rawHeaders && !Array.isArray(rawHeaders)) {
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (v !== undefined) {
            headerMap[k.toLowerCase()] = Array.isArray(v) ? v.map(String) : String(v)
          }
        }
      }
      return res
    }) as http.ServerResponse['writeHead']

    res.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
      return true
    }) as http.ServerResponse['write']

    res.end = ((chunk?: string | Uint8Array | (() => void)) => {
      if (finished) return res
      finished = true
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
      }
      res.writableEnded = true
      res.writableFinished = true
      res.emit('finish')
      resolve({
        statusCode: res.statusCode || statusCode,
        headers: headerMap,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      return res
    }) as http.ServerResponse['end']

    Promise.resolve(handler(req, res)).catch(reject)
  })
}

describe('scripts/server-entry.ts', () => {
  let tempDistDir = ''
  let capturedHandler: RequestHandler | null = null
  let capturedServer: http.Server | null = null
  let baseUrl = ''

  const prevEnv = {
    HOST: process.env.HOST,
    PORT: process.env.PORT,
    APP_DIST_DIR: process.env.APP_DIST_DIR,
  }

  beforeAll(async () => {
    tempDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocarina-server-entry-test-'))
    const clientDir = path.join(tempDistDir, 'client')
    const serverDir = path.join(tempDistDir, 'server')
    fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true })
    fs.mkdirSync(serverDir, { recursive: true })

    fs.writeFileSync(path.join(clientDir, 'hello.txt'), 'hello-world', 'utf8')
    fs.writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log("ok")', 'utf8')
    fs.writeFileSync(
      path.join(serverDir, 'server.js'),
      [
        'export default {',
        '  async fetch(request) {',
        '    const url = new URL(request.url)',
        '    if (url.pathname === "/ssr-500") {',
        '      throw new Error("Simulated SSR failure")',
        '    }',
        '    if (url.pathname === "/ssr-ok") {',
        '      return new Response("ssr-ok", { status: 200, headers: { "Content-Type": "text/plain" } })',
        '    }',
        '    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } })',
        '  },',
        '}',
      ].join('\n'),
      'utf8',
    )

    process.env.HOST = '127.0.0.1'
    process.env.PORT = '0'
    process.env.APP_DIST_DIR = tempDistDir

    const origCreateServer = http.createServer.bind(http)
    const spy = vi.spyOn(http, 'createServer').mockImplementation(((...args: unknown[]) => {
      const listener = typeof args[0] === 'function' ? (args[0] as RequestHandler) : (args[1] as RequestHandler)
      capturedHandler = listener
      const srv = (origCreateServer as (...a: unknown[]) => http.Server)(...args)
      capturedServer = srv
      return srv
    }) as typeof http.createServer)

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await import('./server-entry')

      const deadline = Date.now() + 5000
      while ((!capturedServer || !capturedServer.listening || !capturedHandler) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 15))
      }

      if (!capturedServer || !capturedServer.listening) {
        throw new Error('Standalone server failed to start listening within timeout')
      }

      const addr = capturedServer.address()
      if (!addr || typeof addr === 'string') {
        throw new Error('Expected TCP address from server')
      }
      baseUrl = `http://127.0.0.1:${addr.port}`
    } finally {
      spy.mockRestore()
      consoleLogSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    }
  })

  afterAll(async () => {
    if (capturedServer) {
      await new Promise<void>((resolve) => {
        capturedServer?.close(() => resolve())
        capturedServer?.closeAllConnections?.()
      })
    }

    if (prevEnv.HOST === undefined) delete process.env.HOST
    else process.env.HOST = prevEnv.HOST
    if (prevEnv.PORT === undefined) delete process.env.PORT
    else process.env.PORT = prevEnv.PORT
    if (prevEnv.APP_DIST_DIR === undefined) delete process.env.APP_DIST_DIR
    else process.env.APP_DIST_DIR = prevEnv.APP_DIST_DIR

    if (tempDistDir) {
      fs.rmSync(tempDistDir, { recursive: true, force: true })
    }
  })

  it('sets X-Content-Type-Options: nosniff on responses', async () => {
    const res = await fetch(`${baseUrl}/hello.txt`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await res.text()).toBe('hello-world')
  })

  it('blocks static path traversal attempts', async () => {
    expect(capturedHandler).not.toBeNull()
    const res = await invokeHandler(capturedHandler!, {
      method: 'GET',
      url: '/%2e%2e/server/server.js',
      remoteAddress: '127.0.0.1',
    })
    expect([403, 404]).toContain(res.statusCode)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).not.toContain('Simulated SSR failure')

    if (process.platform === 'win32') {
      const winTraversal = await invokeHandler(capturedHandler!, {
        method: 'GET',
        url: '/..%5cserver/server.js',
        remoteAddress: '127.0.0.1',
      })
      expect(winTraversal.statusCode).toBe(403)
      expect(winTraversal.headers['x-content-type-options']).toBe('nosniff')
      expect(winTraversal.body).toBe('Forbidden')
    }
  })

  it('returns 400 on protocol-relative // URLs', async () => {
    expect(capturedHandler).not.toBeNull()
    const res = await invokeHandler(capturedHandler!, {
      method: 'GET',
      url: '//evil.example.com/foo',
      remoteAddress: '127.0.0.1',
    })
    expect(res.statusCode).toBe(400)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('returns full telemetry on loopback and redacts activeSaveDir on remote GET /api/lichii/state', async () => {
    const loopbackRes = await fetch(`${baseUrl}/api/lichii/state`)
    expect(loopbackRes.status).toBe(200)
    expect(loopbackRes.headers.get('x-content-type-options')).toBe('nosniff')
    const loopbackJson = (await loopbackRes.json()) as LichiiTelemetryState
    expect(loopbackJson.activeSaveDir).toBe(MOCK_ACTIVE_SAVE_DIR)

    const remoteRes = await invokeHandler(capturedHandler!, {
      method: 'GET',
      url: '/api/lichii/state',
      remoteAddress: '192.168.1.42',
    })
    expect(remoteRes.statusCode).toBe(200)
    expect(remoteRes.headers['x-content-type-options']).toBe('nosniff')
    const remoteJson = JSON.parse(remoteRes.body) as LichiiTelemetryState
    expect(remoteJson.activeSaveDir).toBe('slot_00')
    expect(remoteJson.activeSaveDir).not.toContain('testuser')
  })

  it('returns 403 on POST /api/saves/slot from non-loopback clients', async () => {
    const res = await invokeHandler(capturedHandler!, {
      method: 'POST',
      url: '/api/saves/slot',
      remoteAddress: '192.168.1.42',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: 'slot_01' }),
    })
    expect(res.statusCode).toBe(403)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(JSON.parse(res.body)).toEqual({
      error: 'Save slot switching is only allowed from loopback clients',
    })
  })

  it('handles SSR 404 and 500 error responses cleanly', async () => {
    const notFoundRes = await fetch(`${baseUrl}/missing-route`)
    expect(notFoundRes.status).toBe(404)
    expect(notFoundRes.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await notFoundRes.text()).toBe('Not Found')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const errorRes = await fetch(`${baseUrl}/ssr-500`)
      expect(errorRes.status).toBe(500)
      expect(errorRes.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await errorRes.text()).toBe('Internal Server Error')
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
