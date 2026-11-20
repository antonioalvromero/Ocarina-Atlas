import net from 'node:net'

export const DEFAULT_LICHII_HOST = '127.0.0.1'
export const DEFAULT_LICHII_PORT = 6545

/** Resolves the Lichii/Fritchii TCP debug host from LICHII_HOST or FRITCHII_HOST (default '127.0.0.1'). */
export function getLichiiHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.LICHII_HOST?.trim() || env.FRITCHII_HOST?.trim()
  return raw ? raw : DEFAULT_LICHII_HOST
}

/** Parses a TCP port string into 1..65535, falling back when unset or invalid. */
export function parseLichiiPort(raw: string | undefined, fallback = DEFAULT_LICHII_PORT): number {
  const trimmed = raw?.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback
  const port = Number.parseInt(trimmed, 10)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback
}

/** Resolves the Lichii/Fritchii TCP debug port from LICHII_PORT or FRITCHII_PORT (default 6545). */
export function getLichiiPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LICHII_PORT?.trim() ? env.LICHII_PORT : env.FRITCHII_PORT
  return parseLichiiPort(raw, DEFAULT_LICHII_PORT)
}

type RpcResponse = {
  id?: number
  result?: Record<string, unknown>
  error?: unknown
}

type PendingRpc = {
  method: string
  params: Record<string, unknown>
  timeoutMs: number
  resolve: (val: Record<string, unknown> | null) => void
}

export type LichiiRpcClientOptions = {
  host?: string
  port?: number
  onDisconnect?: () => void
}

/**
 * Single persistent, strictly-serialized TCP JSON-RPC client for Lichii's
 * single-threaded Boost.Asio debug server (prevents CLOSE_WAIT/socket exhaustion
 * and 500ms FPS sleep stalls).
 */
export class LichiiRpcClient {
  private readonly explicitHost?: string
  private readonly explicitPort?: number
  private activeHost: string | null = null
  private activePort: number | null = null
  private readonly onDisconnect?: () => void
  private socket: net.Socket | null = null
  private connecting: Promise<boolean> | null = null
  private buffer = ''
  private reqId = 1
  private queue: PendingRpc[] = []
  private inFlight: {
    id: number
    timer: ReturnType<typeof setTimeout>
    resolve: (val: Record<string, unknown> | null) => void
  } | null = null
  private lastConnectFailureAt = 0

  constructor(options: LichiiRpcClientOptions = {}) {
    this.explicitHost = options.host
    this.explicitPort = options.port
    this.onDisconnect = options.onDisconnect
  }

  getHost(): string {
    return this.explicitHost ?? getLichiiHost()
  }

  getPort(): number {
    return this.explicitPort ?? getLichiiPort()
  }

  isConnected(): boolean {
    return Boolean(
      this.socket &&
        !this.socket.destroyed &&
        this.socket.writable &&
        !this.socket.writableEnded &&
        !this.socket.readableEnded,
    )
  }

  close(): void {
    this.lastConnectFailureAt = 0
    this.resetSocket(false)
  }

  call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 800,
  ): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      if (this.queue.length >= 24) {
        // Drop oldest stale queued reads rather than piling up backlog
        const dropped = this.queue.shift()
        dropped?.resolve(null)
      }
      this.queue.push({ method, params, timeoutMs, resolve })
      void this.pump()
    })
  }

  private async ensureConnected(): Promise<boolean> {
    const targetHost = this.getHost()
    const targetPort = this.getPort()

    if (this.isConnected()) {
      if (this.activeHost === targetHost && this.activePort === targetPort) {
        return true
      }
      this.resetSocket(false)
    }
    if (this.connecting) return this.connecting

    const now = Date.now()
    if (now - this.lastConnectFailureAt < 1000) {
      return false
    }

    this.connecting = new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host: targetHost, port: targetPort })
      let settled = false
      const settle = (ok: boolean) => {
        if (settled) return
        settled = true
        this.connecting = null
        clearTimeout(connectTimer)
        if (!ok) {
          this.lastConnectFailureAt = Date.now()
          try {
            sock.removeAllListeners()
            sock.destroy()
          } catch {
            // ignore
          }
          if (this.socket === sock) {
            this.socket = null
            this.activeHost = null
            this.activePort = null
          }
          this.onDisconnect?.()
        }
        resolve(ok)
      }

      const connectTimer = setTimeout(() => settle(false), 750)

      sock.setNoDelay(true)
      sock.on('connect', () => {
        this.socket = sock
        this.activeHost = targetHost
        this.activePort = targetPort
        this.buffer = ''
        settle(true)
      })
      sock.on('data', (chunk) => this.handleData(chunk))
      sock.on('error', () => {
        if (this.socket === sock) {
          this.resetSocket(true)
        }
        settle(false)
      })
      sock.on('close', () => {
        if (this.socket === sock) {
          this.resetSocket(true)
        }
        settle(false)
      })
      sock.on('end', () => {
        if (this.socket === sock) {
          this.resetSocket(true)
        }
        settle(false)
      })
    })

    return this.connecting
  }

  private drainQueue() {
    while (this.queue.length > 0) {
      const item = this.queue.shift()
      item?.resolve(null)
    }
  }

  private resetSocket(notifyDisconnect = true) {
    const hadActiveOrPending = Boolean(this.socket || this.inFlight || this.queue.length > 0)
    const sock = this.socket
    this.socket = null
    this.activeHost = null
    this.activePort = null
    if (sock) {
      try {
        sock.removeAllListeners()
        sock.destroy()
      } catch {
        // ignore
      }
    }
    this.buffer = ''

    const pendingInFlight = this.inFlight
    this.inFlight = null
    if (pendingInFlight) {
      clearTimeout(pendingInFlight.timer)
    }

    const queued = this.queue.splice(0, this.queue.length)

    if (notifyDisconnect && hadActiveOrPending) {
      this.onDisconnect?.()
    }

    if (pendingInFlight) {
      pendingInFlight.resolve(null)
    }
    for (const item of queued) {
      item.resolve(null)
    }
  }

  private handleData(chunk: Buffer | string) {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    while (true) {
      const nl = this.buffer.indexOf('\n')
      if (nl === -1) break
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.trim()) continue

      let parsed: (RpcResponse & { id?: number }) | null = null
      try {
        parsed = JSON.parse(line) as RpcResponse & { id?: number }
      } catch {
        parsed = null
      }

      if (this.inFlight && (!parsed?.id || parsed.id === this.inFlight.id)) {
        const cur = this.inFlight
        this.inFlight = null
        clearTimeout(cur.timer)
        cur.resolve(parsed?.result ?? null)
        void this.pump()
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.inFlight || this.queue.length === 0) return

    const ok = await this.ensureConnected()
    if (!ok || !this.isConnected()) {
      this.drainQueue()
      return
    }

    if (this.inFlight || this.queue.length === 0 || !this.socket) return
    const next = this.queue.shift()!
    const id = this.reqId++

    const timer = setTimeout(() => {
      if (this.inFlight?.id === id) {
        this.resetSocket(true)
      }
    }, next.timeoutMs)

    this.inFlight = { id, timer, resolve: next.resolve }
    try {
      const payload = JSON.stringify({ id, method: next.method, params: next.params }) + '\n'
      this.socket.write(payload)
    } catch {
      this.resetSocket(true)
    }
  }
}

export function bigintToHex(addr: bigint): string {
  return '0x' + addr.toString(16)
}

export function u64ToLeHex(val: bigint): string {
  const buf = Buffer.allocUnsafe(8)
  buf.writeBigUInt64LE(val, 0)
  return buf.toString('hex')
}

export const MAIN_MOD0_OFFSET = 0x03c4705cn
export const MAIN_MOD0_PATTERN_HEX = '4d4f44305467030124fb0f016c342501' // "MOD0" + u32[0x1036754, 0x10ffb24, 0x125346c]
export const OWL_MOD0_PATTERN_HEX = '4f776c2e6e7373004d4f4430' // "Owl.nss\0MOD0" (hit + 8 = MOD0)
export const MAIN_BASE_RESCAN_THROTTLE_MS = 1500

export const MAIN_SUB6_BSS_OFFSET = 0x04e6c7a8n
export const MAIN_SUB24_BSS_OFFSET = 0x04e6c938n
export const MAIN_GDM_BSS_OFFSET = 0x04e90ce8n
export const DEFAULT_MIN_GUEST_HEAP_PTR = 0x1000000000n // Longshot uses HOS_HEAP_BASE=0x1000000000; Lichii/Fritchii/Eden use 0x2000000000+
// NX2Saria and OOT-PC use host addresses as guest addresses. With tracker API on, heap starts at 0x1030000000;
// builds without that heap move place it near 0x130000000, so accept pointers from 4 GiB.
export const NX2SARIA_MIN_GUEST_HEAP_PTR = 0x100000000n
// Set from each RPC status response and reset on disconnect
export let MIN_GUEST_HEAP_PTR = DEFAULT_MIN_GUEST_HEAP_PTR

/** Returns the lowest valid guest heap pointer for the emulator named in an RPC status response. */
export function getMinGuestHeapPtr(emulator: unknown): bigint {
  return emulator === 'nx2saria' || emulator === 'ootpc'
    ? NX2SARIA_MIN_GUEST_HEAP_PTR
    : DEFAULT_MIN_GUEST_HEAP_PTR
}

export function updateMinGuestHeapPtr(status: Record<string, unknown> | null): void {
  MIN_GUEST_HEAP_PTR = getMinGuestHeapPtr(status?.emulator)
}

export const LEGACY_SUB36_VT1 = 0x84fce818n
export const LEGACY_SUB36_VT2 = 0x84311f8cn
export const WORK_BANC_SCENE_PATTERN_HEX = '576f726b2f42616e632f5363656e652f' // "Work/Banc/Scene/"

export type DynamicVtables = {
  sub36Vt1: bigint
  sub36Vt2: bigint
  pObjVt: bigint
  gdmVt: bigint
  gdmBoolVt: bigint
  gdmStockVt: bigint
  gdmCountVt: bigint
}

/** Validates the Switch main NSO module header (`u32[0] == 1` and `u32[1] == MOD0 offset 0x03c4705c`). */
export function validateMainBaseHeader(buf: Buffer | null): boolean {
  if (!buf || buf.length < 8) return false
  return buf.readUInt32LE(0) === 1 && buf.readUInt32LE(4) === Number(MAIN_MOD0_OFFSET)
}

/** Derives ASLR-adjusted vtable pointers from the discovered main NSO base address. */
export function deriveDynamicVtables(mainBase: bigint): DynamicVtables {
  return {
    sub36Vt1: mainBase + 0x04ba1818n,
    sub36Vt2: mainBase + 0x03ee4f8cn,
    pObjVt: mainBase + 0x04ba27c8n,
    gdmVt: mainBase + 0x04c58270n,
    gdmBoolVt: mainBase + 0x04c20658n,
    gdmStockVt: mainBase + 0x04c20718n,
    gdmCountVt: mainBase + 0x04c20e98n,
  }
}

function isValidCoord(x: number, y: number, z: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(z) &&
    Math.abs(x) < 15000 &&
    Math.abs(y) < 15000 &&
    Math.abs(z) < 15000 &&
    (Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001)
  )
}

/** Validates Sub[36] player telemetry struct header vtables and non-zero coordinates. */
export function isValidSub36Buffer(
  buf: Buffer | null,
  expectedVt1 = LEGACY_SUB36_VT1,
  expectedVt2 = LEGACY_SUB36_VT2,
): buf is Buffer {
  if (!buf || buf.length < 0x40) return false
  const vt1 = buf.readBigUInt64LE(0)
  const vt2 = buf.readBigUInt64LE(8)
  if (vt1 !== expectedVt1 || vt2 !== expectedVt2) return false
  const x = buf.readFloatLE(0x1c)
  const y = buf.readFloatLE(0x20)
  const z = buf.readFloatLE(0x24)
  return isValidCoord(x, y, z)
}

/** Validates a GameDataMgr container header (`cnt`, `entriesPtr`, `hashTablePtr`, `cap`). */
export function parseGdmContainerHeader(
  buf: Buffer | null,
  maxCnt = 65536,
  maxCap = 131072,
): { cnt: number; entriesPtr: bigint; hashTablePtr: bigint; cap: number } | null {
  if (!buf || buf.length < 0x28) return null
  const cnt = buf.readUInt32LE(0x08)
  const entriesPtr = buf.readBigUInt64LE(0x10)
  const hashTablePtr = buf.readBigUInt64LE(0x18)
  const cap = buf.readUInt32LE(0x24)
  if (
    cnt === 0 ||
    cnt > maxCnt ||
    cap < cnt ||
    cap > maxCap ||
    entriesPtr <= MIN_GUEST_HEAP_PTR ||
    hashTablePtr <= MIN_GUEST_HEAP_PTR
  ) {
    return null
  }
  return { cnt, entriesPtr, hashTablePtr, cap }
}

const rpcDisconnectListeners = new Set<() => void>()

export function registerRpcDisconnectListener(fn: () => void): void {
  rpcDisconnectListeners.add(fn)
}

function notifyRpcDisconnect(): void {
  updateMinGuestHeapPtr(null)
  cachedMainBase = 0n
  lastMainBaseScanTime = 0
  for (const listener of rpcDisconnectListeners) {
    listener()
  }
}

export const lichiiRpc = new LichiiRpcClient({
  onDisconnect: () => notifyRpcDisconnect(),
})

/** Closes any active Lichii RPC socket and clears pending calls during server shutdown. */
export function closeLichiiRpc(): void {
  lichiiRpc.close()
  notifyRpcDisconnect()
}

export function callLichiiRpc(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 800,
): Promise<Record<string, unknown> | null> {
  return lichiiRpc.call(method, params, timeoutMs)
}

export async function readMemoryBuffer(
  addressHex: string,
  size: number,
  timeoutMs = 600,
): Promise<Buffer | null> {
  if (!addressHex || addressHex === '0x0') return null
  const res = await callLichiiRpc(
    'read_memory',
    { address: addressHex, size, as: 'hex' },
    timeoutMs,
  )
  const hex = typeof res?.hex === 'string' ? res.hex : null
  if (!hex) return null
  return Buffer.from(hex, 'hex')
}

export async function readU64At(addrHex: string, timeoutMs = 400): Promise<bigint> {
  const buf = await readMemoryBuffer(addrHex, 8, timeoutMs)
  if (!buf || buf.length < 8) return 0n
  return buf.readBigUInt64LE(0)
}

export async function searchMemoryOnce(
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; hits: string[] }> {
  if (!lichiiRpc.isConnected()) return { ok: false, hits: [] }
  const res = await callLichiiRpc('search_memory', params, timeoutMs)
  if (res === null) return { ok: false, hits: [] }
  const hits = Array.isArray(res.hits)
    ? res.hits.filter((h): h is string => typeof h === 'string')
    : []
  return { ok: true, hits }
}

export async function searchHeapWithFallback(options: {
  pattern: string
  start: string
  end: string
  maxHits: number
  fastBudgetMs?: number
  heapBudgetMs?: number
}): Promise<string[]> {
  if (!lichiiRpc.isConnected()) return []
  const fastBudgetMs = options.fastBudgetMs ?? 800
  const heapBudgetMs = options.heapBudgetMs ?? 1500

  const first = await searchMemoryOnce(
    {
      pattern: options.pattern,
      start: options.start,
      end: options.end,
      max_hits: options.maxHits,
      budget_ms: fastBudgetMs,
    },
    Math.max(fastBudgetMs + 300, 1000),
  )
  if (!first.ok || !lichiiRpc.isConnected() || first.hits.length > 0) {
    return first.hits
  }

  const fallback = await searchMemoryOnce(
    {
      pattern: options.pattern,
      regions: 'heap',
      max_hits: options.maxHits,
      budget_ms: heapBudgetMs,
    },
    heapBudgetMs + 300,
  )
  return fallback.hits
}

let cachedMainBase = 0n
let lastMainBaseScanTime = 0

export function resetMainBaseCache(): void {
  cachedMainBase = 0n
  lastMainBaseScanTime = 0
}

async function validateMod0Hits(hits: string[], mod0Adjust = 0n): Promise<bigint> {
  for (const hit of hits) {
    let hitAddr: bigint
    try {
      hitAddr = BigInt(hit)
    } catch {
      continue
    }
    const mainBase = hitAddr + mod0Adjust - MAIN_MOD0_OFFSET
    if (mainBase <= 0n) continue
    const hdr = await readMemoryBuffer(bigintToHex(mainBase), 8, 500)
    if (validateMainBaseHeader(hdr)) {
      return mainBase
    }
  }
  return 0n
}

export async function ensureMainBase(forceRefresh = false): Promise<bigint> {
  if (cachedMainBase !== 0n && !forceRefresh) {
    return cachedMainBase
  }
  const now = Date.now()
  if (!forceRefresh && now - lastMainBaseScanTime < MAIN_BASE_RESCAN_THROTTLE_MS) {
    return 0n
  }
  if (!lichiiRpc.isConnected()) {
    return 0n
  }
  lastMainBaseScanTime = now

  const searchConfigs: Array<{ params: Record<string, unknown>; mod0Adjust: bigint; timeoutMs: number }> = [
    {
      params: {
        pattern: MAIN_MOD0_PATTERN_HEX,
        start: '0x08000000',
        end: '0x200000000',
        regions: 'all',
        max_hits: 4,
        budget_ms: 1000,
      },
      mod0Adjust: 0n,
      timeoutMs: 1300,
    },
    {
      params: {
        pattern: OWL_MOD0_PATTERN_HEX,
        start: '0x08000000',
        end: '0x200000000',
        regions: 'all',
        max_hits: 4,
        budget_ms: 1000,
      },
      mod0Adjust: 8n,
      timeoutMs: 1300,
    },
    {
      params: {
        pattern: MAIN_MOD0_PATTERN_HEX,
        regions: 'all',
        max_hits: 4,
        budget_ms: 1500,
      },
      mod0Adjust: 0n,
      timeoutMs: 1800,
    },
    {
      params: {
        pattern: OWL_MOD0_PATTERN_HEX,
        regions: 'all',
        max_hits: 4,
        budget_ms: 1500,
      },
      mod0Adjust: 8n,
      timeoutMs: 1800,
    },
  ]

  for (const cfg of searchConfigs) {
    if (!lichiiRpc.isConnected()) break
    const res = await searchMemoryOnce(cfg.params, cfg.timeoutMs)
    if (!res.ok) continue
    const found = await validateMod0Hits(res.hits, cfg.mod0Adjust)
    if (found !== 0n) {
      cachedMainBase = found
      return found
    }
  }

  return 0n
}
