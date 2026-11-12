import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  collectLanIpv4Urls,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  isPrivateLanIpv4,
  isWildcardBindHost,
  LOCALHOST_HOST,
  parseServerConfig,
  parseServerPort,
  resolveAllowedDevHosts,
  sanitizeHostHeader,
} from './server-network'

function makeIpv4Info(
  address: string,
  internal = false,
): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  }
}

describe('server-network helpers', () => {
  it('defaults to wildcard LAN bind (0.0.0.0) and port 3000', () => {
    expect(parseServerConfig([], {})).toEqual({
      host: DEFAULT_SERVER_HOST,
      port: DEFAULT_SERVER_PORT,
    })
  })

  it('respects env variables and lets CLI flags override cleanly', () => {
    expect(
      parseServerConfig(['--local-only', '--port=4123'], {
        HOST: '0.0.0.0',
        PORT: '3000',
      }),
    ).toEqual({
      host: LOCALHOST_HOST,
      port: 4123,
    })

    expect(
      parseServerConfig(['--lan', '--port', '8080'], {
        HOST: '127.0.0.1',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 8080,
    })

    expect(
      parseServerConfig(['--host', '192.168.1.50'], {
        HOST: '127.0.0.1',
      }),
    ).toEqual({
      host: '192.168.1.50',
      port: DEFAULT_SERVER_PORT,
    })
  })

  it('parses valid ports including 0 and falls back on malformed values', () => {
    expect(parseServerPort('0', 3000)).toBe(0)
    expect(parseServerPort(' 6545 ', 3000)).toBe(6545)
    expect(parseServerPort('70000', 3000)).toBe(3000)
    expect(parseServerPort('abc', 3000)).toBe(3000)
    expect(parseServerPort(undefined, 3000)).toBe(3000)
  })

  it('recognizes wildcard bind hosts accurately', () => {
    expect(isWildcardBindHost('0.0.0.0')).toBe(true)
    expect(isWildcardBindHost('::')).toBe(true)
    expect(isWildcardBindHost('127.0.0.1')).toBe(false)
    expect(isWildcardBindHost('192.168.1.10')).toBe(false)
  })

  it('validates Host headers and rejects untrusted characters', () => {
    expect(sanitizeHostHeader('192.168.1.25:3000', '127.0.0.1', 3000)).toBe(
      '192.168.1.25:3000',
    )
    expect(sanitizeHostHeader('[::1]:3000', '127.0.0.1', 3000)).toBe('[::1]:3000')
    expect(sanitizeHostHeader('attacker.example/evil', '127.0.0.1', 3000)).toBe(
      '127.0.0.1:3000',
    )
    expect(sanitizeHostHeader('user@192.168.1.25:3000', '127.0.0.1', 3000)).toBe(
      '127.0.0.1:3000',
    )
    expect(sanitizeHostHeader(undefined, '127.0.0.1', 3000)).toBe('127.0.0.1:3000')
  })

  it('identifies private LAN IPv4 ranges and prioritizes physical LAN adapters', () => {
    expect(isPrivateLanIpv4('192.168.1.42')).toBe(true)
    expect(isPrivateLanIpv4('10.0.0.15')).toBe(true)
    expect(isPrivateLanIpv4('172.16.0.5')).toBe(true)
    expect(isPrivateLanIpv4('172.32.0.5')).toBe(false)
    expect(isPrivateLanIpv4('100.64.1.2')).toBe(true)
    expect(isPrivateLanIpv4('127.0.0.1')).toBe(false)

    const urls = collectLanIpv4Urls(
      {
        'Loopback Pseudo-Interface': [makeIpv4Info('127.0.0.1', true)],
        'vEthernet (WSL)': [makeIpv4Info('172.24.16.1')],
        'Ethernet Link-Local': [makeIpv4Info('169.254.10.2')],
        'Wi-Fi': [
          makeIpv4Info('192.168.1.88'),
          makeIpv4Info('192.168.1.88'),
          {
            address: 'fe80::1',
            netmask: 'ffff:ffff:ffff:ffff::',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: 'fe80::1/64',
            scopeid: 0,
          },
        ],
      },
      3000,
    )

    expect(urls).toEqual(['http://192.168.1.88:3000', 'http://172.24.16.1:3000'])
  })

  it('includes .local and case variants of the local hostname in allowedHosts', () => {
    expect(resolveAllowedDevHosts('DESKTOP-HYRULE')).toEqual([
      '.local',
      'DESKTOP-HYRULE',
      'desktop-hyrule',
    ])
    expect(resolveAllowedDevHosts('hyrule')).toEqual(['.local', 'hyrule'])
  })
})
