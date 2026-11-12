import type { NetworkInterfaceInfo } from 'node:os'

export const DEFAULT_SERVER_HOST = '0.0.0.0'
export const LOCALHOST_HOST = '127.0.0.1'
export const DEFAULT_SERVER_PORT = 3000

const VIRTUAL_ADAPTER_PATTERN =
  /(?:vethernet|hyper-v|wsl|virtualbox|vbox|vmware|docker|veth|utun|loopback|isatap|teredo)/i

const VALID_HOST_HEADER_PATTERN =
  /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i

export interface ServerConfig {
  host: string
  port: number
}

/** Parses a TCP port string into `0..65535`, returning `fallback` when invalid. */
export function parseServerPort(
  raw: string | undefined,
  fallback = DEFAULT_SERVER_PORT,
): number {
  const trimmed = raw?.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback
  const port = Number.parseInt(trimmed, 10)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : fallback
}

/** Returns true when `host` binds all network interfaces (`0.0.0.0` or `::`). */
export function isWildcardBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return (
    normalized === '0.0.0.0' ||
    normalized === '::' ||
    normalized === '0:0:0:0:0:0:0:0'
  )
}

/** Resolves bind host and port from environment variables and CLI flags (`--lan`, `--local-only`, `--host`, `--port`). */
export function parseServerConfig(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = {},
): ServerConfig {
  let host = env.HOST?.trim() || DEFAULT_SERVER_HOST
  let port = parseServerPort(env.PORT, DEFAULT_SERVER_PORT)

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    const eqIndex = arg.indexOf('=')
    const key = eqIndex > 0 ? arg.slice(0, eqIndex).toLowerCase() : arg.toLowerCase()
    const inlineValue = eqIndex > 0 ? arg.slice(eqIndex + 1) : undefined

    if (key === '--lan') {
      host = DEFAULT_SERVER_HOST
    } else if (key === '--local-only' || key === '--localhost') {
      host = LOCALHOST_HOST
    } else if (key === '--host') {
      const nextValue = inlineValue ?? argv[++i]
      if (nextValue?.trim()) {
        host = nextValue.trim()
      }
    } else if (key === '--port') {
      const nextValue = inlineValue ?? argv[++i]
      port = parseServerPort(nextValue, port)
    }
  }

  return { host, port }
}

/** Validates an incoming HTTP `Host` header for safe local URL parsing. */
export function sanitizeHostHeader(
  rawHost: string | undefined,
  fallbackOriginHost: string,
  boundPort: number,
): string {
  const fallback = `${fallbackOriginHost}:${boundPort}`
  if (!rawHost) return fallback
  const trimmed = rawHost.trim()
  if (!trimmed || trimmed.length > 255 || !VALID_HOST_HEADER_PATTERN.test(trimmed)) {
    return fallback
  }
  return trimmed
}

/** Returns true if an IPv4 address belongs to private LAN or CGNAT space. */
export function isPrivateLanIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false
  }
  const a = parts[0]
  const b = parts[1]
  if (a === undefined || b === undefined) return false
  if (a === 192 && b === 168) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function lanIpv4Rank(interfaceName: string, address: string): number {
  let score = 0
  if (!VIRTUAL_ADAPTER_PATTERN.test(interfaceName)) {
    score += 100
  }
  if (/^(?:wi-?fi|wlan|ethernet)/i.test(interfaceName)) {
    score += 30
  }
  if (address.startsWith('192.168.')) score += 40
  else if (address.startsWith('10.')) score += 30
  else if (isPrivateLanIpv4(address)) score += 20
  return score
}

/** Extracts sorted, deduplicated reachable LAN IPv4 `http://<ip>:<port>` URLs. */
export function collectLanIpv4Urls(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  port: number,
): string[] {
  const candidates: Array<{ address: string; rank: number }> = []
  const seen = new Set<string>()

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue
    for (const entry of entries) {
      const family = entry.family as string | number
      const isIpv4 = family === 'IPv4' || family === 4
      if (!isIpv4 || entry.internal) continue
      const address = entry.address.trim()
      if (!address || address.startsWith('127.') || address.startsWith('169.254.')) {
        continue
      }
      if (seen.has(address)) continue
      seen.add(address)
      candidates.push({ address, rank: lanIpv4Rank(name, address) })
    }
  }

  candidates.sort((a, b) => b.rank - a.rank || a.address.localeCompare(b.address))
  return candidates.map((item) => `http://${item.address}:${port}`)
}

/** Builds deduplicated Vite `allowedHosts` entries including `.local` and the current hostname. */
export function resolveAllowedDevHosts(localHostname: string): string[] {
  const hosts = new Set<string>(['.local'])
  const trimmed = localHostname.trim()
  if (trimmed) {
    hosts.add(trimmed)
    hosts.add(trimmed.toLowerCase())
  }
  return [...hosts]
}
