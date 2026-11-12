import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  closeLichiiRpc,
  getLichiiTelemetryState,
  setStaticAssetRoots,
} from '../src/lib/lichii-server'
import type { LichiiTelemetryState } from '../src/lib/lichii-types'

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production'
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3000

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

type SsrFetchModule = {
  default?: {
    fetch?: (request: Request) => Promise<Response> | Response
  }
}

function parseServerPort(raw: string | undefined, fallback = DEFAULT_PORT): number {
  const trimmed = raw?.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback
  const port = Number.parseInt(trimmed, 10)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : fallback
}

function hasValidDistLayout(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'client')) &&
    fs.existsSync(path.join(dir, 'server', 'server.js'))
  )
}

function resolveDistDir(): string {
  const explicit = process.env.APP_DIST_DIR?.trim()
  if (explicit) {
    return path.resolve(explicit)
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(scriptDir, 'dist'),
    scriptDir,
    path.resolve(scriptDir, '..', 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ]

  for (const dir of candidates) {
    if (hasValidDistLayout(dir)) {
      return dir
    }
  }

  return path.resolve(process.cwd(), 'dist')
}

function offlineFallbackState(): LichiiTelemetryState {
  return {
    connected: false,
    emulatorRunning: false,
    scene: null,
    placeId: null,
    placeSlug: null,
    placeName: null,
    mapId: null,
    age: null,
    position: null,
    mapFraction: null,
    worldMapFraction: null,
    skulltulaCount: null,
    collectedSkulltulaIds: [],
    authoritativeSkulltulas: false,
    lastCollectedSkulltulaId: null,
    lastPickedItem: null,
    source: 'none',
    updatedAt: Date.now(),
  }
}

async function handleTelemetryApi(
  method: string,
  res: http.ServerResponse,
): Promise<void> {
  let payload: LichiiTelemetryState
  try {
    payload = await getLichiiTelemetryState()
  } catch {
    payload = offlineFallbackState()
  }

  const body = JSON.stringify(payload)
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Length': Buffer.byteLength(body).toString(),
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  res.end(body)
}

function getCacheControlForAsset(pathname: string): string {
  if (pathname === '/sw.js') return 'no-cache'
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

async function tryServeStaticAsset(
  pathname: string,
  method: string,
  clientDir: string,
  res: http.ServerResponse,
): Promise<boolean> {
  if (pathname === '/' || (method !== 'GET' && method !== 'HEAD')) {
    return false
  }

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Bad Request')
    return true
  }

  if (decodedPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Bad Request')
    return true
  }

  const relPath = decodedPath.replace(/^\/+/, '')
  if (!relPath) return false

  const resolvedClientDir = path.resolve(clientDir)
  const clientPrefix = resolvedClientDir.endsWith(path.sep)
    ? resolvedClientDir
    : resolvedClientDir + path.sep
  const targetPath = path.resolve(resolvedClientDir, relPath)

  if (targetPath !== resolvedClientDir && !targetPath.startsWith(clientPrefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Forbidden')
    return true
  }

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(targetPath)
  } catch {
    return false
  }

  if (!stat.isFile()) {
    return false
  }

  const ext = path.extname(targetPath).toLowerCase()
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size.toString(),
    'Cache-Control': getCacheControlForAsset(pathname),
  })

  if (method === 'HEAD') {
    res.end()
    return true
  }

  await new Promise<void>((resolve) => {
    const stream = fs.createReadStream(targetPath)
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      if (!res.writableEnded) res.end()
      resolve()
    })
    res.on('close', () => {
      stream.destroy()
      resolve()
    })
    res.on('finish', resolve)
    stream.pipe(res)
  })

  return true
}

function nodeHeadersToWebHeaders(rawHeaders: http.IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [key, val] of Object.entries(rawHeaders)) {
    if (!key || key.startsWith(':') || val === undefined) continue
    if (Array.isArray(val)) {
      for (const item of val) {
        headers.append(key, item)
      }
    } else {
      headers.set(key, val)
    }
  }
  return headers
}

async function sendWebResponse(
  webRes: Response,
  method: string,
  res: http.ServerResponse,
): Promise<void> {
  res.statusCode = webRes.status

  const setCookies =
    typeof webRes.headers.getSetCookie === 'function' ? webRes.headers.getSetCookie() : []
  if (setCookies.length > 0) {
    res.setHeader('Set-Cookie', setCookies)
  }

  webRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'transfer-encoding') return
    if (lower === 'set-cookie' && setCookies.length > 0) return
    res.setHeader(key, value)
  })

  if (method === 'HEAD' || !webRes.body) {
    await webRes.body?.cancel().catch(() => {})
    if (!res.writableEnded) res.end()
    return
  }

  const reader = webRes.body.getReader()
  try {
    while (!res.destroyed) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.byteLength > 0) {
        const canContinue = res.write(value)
        if (!canContinue && !res.destroyed) {
          await once(res, 'drain')
        }
      }
    }
  } finally {
    reader.releaseLock()
    if (!res.writableEnded && !res.destroyed) {
      res.end()
    }
  }
}

async function main(): Promise<void> {
  const host = process.env.HOST?.trim() || DEFAULT_HOST
  const port = parseServerPort(process.env.PORT, DEFAULT_PORT)
  const distDir = resolveDistDir()
  const clientDir = path.join(distDir, 'client')
  const serverEntryPath = path.join(distDir, 'server', 'server.js')

  if (!hasValidDistLayout(distDir)) {
    console.error(
      `FATAL: Could not locate dist/client and dist/server/server.js (resolved APP_DIST_DIR=${distDir}).`,
    )
    process.exit(1)
  }

  setStaticAssetRoots([clientDir])

  const ssrModule = (await import(pathToFileURL(serverEntryPath).href)) as SsrFetchModule
  const ssrFetch = ssrModule.default?.fetch
  if (typeof ssrFetch !== 'function') {
    console.error(`FATAL: SSR entry at ${serverEntryPath} does not export default.fetch().`)
    process.exit(1)
  }

  let boundPort = port
  const server = http.createServer(async (req, res) => {
    const method = (req.method || 'GET').toUpperCase()
    const rawUrl = req.url || '/'
    if (rawUrl.startsWith('//')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Bad Request')
      return
    }
    const fallbackOriginHost =
      host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    const hostHeader = req.headers.host || `${fallbackOriginHost}:${boundPort}`

    let requestUrl: URL
    try {
      requestUrl = new URL(rawUrl, `http://${hostHeader}`)
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Bad Request')
      return
    }

    if (requestUrl.pathname === '/api/lichii/state' && (method === 'GET' || method === 'HEAD')) {
      await handleTelemetryApi(method, res)
      return
    }

    if (await tryServeStaticAsset(requestUrl.pathname, method, clientDir, res)) {
      return
    }

    const abortController = new AbortController()
    const onClose = () => {
      if (!res.writableFinished) {
        abortController.abort()
      }
    }
    res.on('close', onClose)

    try {
      const hasBody = method !== 'GET' && method !== 'HEAD'
      const requestInit: RequestInit & { duplex?: 'half' } = {
        method,
        headers: nodeHeadersToWebHeaders(req.headers),
        signal: abortController.signal,
      }
      if (hasBody) {
        requestInit.body = Readable.toWeb(req) as unknown as BodyInit
        requestInit.duplex = 'half'
      }

      const webReq = new Request(requestUrl.href, requestInit)
      const webRes = await ssrFetch(webReq)
      await sendWebResponse(webRes, method, res)
    } catch (err) {
      if (!abortController.signal.aborted && !res.destroyed) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        }
        if (!res.writableEnded) {
          const message = err instanceof Error ? err.message : 'Internal Server Error'
          res.end(message)
        }
      }
    } finally {
      res.off('close', onClose)
    }
  })

  server.on('error', (err) => {
    console.error(`HTTP server error: ${err instanceof Error ? err.message : String(err)}`)
    closeLichiiRpc()
    process.exit(1)
  })

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    closeLichiiRpc()
    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.()
      process.exit(0)
    }, 1500)
    forceTimer.unref()

    server.close(() => {
      clearTimeout(forceTimer)
      process.exit(0)
    })
    server.closeIdleConnections?.()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  server.listen(port, host, () => {
    const addr = server.address()
    boundPort = typeof addr === 'object' && addr ? addr.port : port
    const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    console.log(`READY http://${displayHost}:${boundPort}`)
  })
}

void main()
