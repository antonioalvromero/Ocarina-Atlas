import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_VIEW } from './coords'
import {
  activeProfileSlot,
  addPin,
  ageFilterSlot,
  applyExplorationPreset,
  applyRemoteSyncState,
  exportProgressBackup,
  hideDoneSlot,
  importProgressBackup,
  initRemoteSync,
  isSyncableKey,
  itemCountVisibleSlot,
  nearestFinderSlot,
  officialDoneSlot,
  officialRevealedSlot,
  officialVisibleSlot,
  ownedPrereqsSlot,
  parseAndValidateProgressBackup,
  pinsSlot,
  prereqAutoSyncSlot,
  prereqFilterEnabledSlot,
  read,
  removePin,
  resetSyncForTests,
  setInList,
  spoilerFreeSlot,
  switchSaveProfile,
  toggleInList,
  updatePin,
  useStored,
  viewSlot,
  write,
  zoomSlot,
} from './storage'

function fakeWindow() {
  const entries = new Map<string, string>()
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: {
      get length() {
        return entries.size
      },
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
    },
  }
}

afterEach(() => {
  resetSyncForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('without a window', () => {
  it('reads empty values and ignores writes', () => {
    expect(read(officialVisibleSlot)).toBe(false)
    expect(() => write(officialVisibleSlot, true)).not.toThrow()
    expect(read(pinsSlot('a', 'b'))).toEqual([])
  })
})

describe('with localStorage', () => {
  let win: ReturnType<typeof fakeWindow>

  beforeEach(() => {
    win = fakeWindow()
    vi.stubGlobal('window', win)
  })

  it('keeps pins separate per place and per map', () => {
    addPin('kokiri', 'principal', 'Chest', { x: 0.1, y: 0.2 })
    addPin('kokiri', 'other', 'Door', { x: 0.3, y: 0.4 })
    addPin('deku', 'principal', 'Web', { x: 0.5, y: 0.6 })
    expect(read(pinsSlot('kokiri', 'principal')).map((p) => p.name)).toEqual(['Chest'])
    expect(read(pinsSlot('kokiri', 'other')).map((p) => p.name)).toEqual(['Door'])
    expect(read(pinsSlot('deku', 'principal')).map((p) => p.name)).toEqual(['Web'])
  })

  it('stores fractional coordinates and supports rename, complete, delete', () => {
    const pin = addPin('kokiri', 'principal', 'Chest', { x: 0.1, y: 0.2 })
    expect(pin).toMatchObject({ x: 0.1, y: 0.2, done: false })
    updatePin('kokiri', 'principal', pin.id, { name: 'Big chest', done: true })
    expect(read(pinsSlot('kokiri', 'principal'))[0]).toMatchObject({ name: 'Big chest', done: true })
    removePin('kokiri', 'principal', pin.id)
    expect(read(pinsSlot('kokiri', 'principal'))).toEqual([])
  })

  it('returns a stable snapshot until the value changes', () => {
    write(officialDoneSlot, ['a'])
    const first = read(officialDoneSlot)
    expect(read(officialDoneSlot)).toBe(first)
    toggleInList(officialDoneSlot, 'b')
    expect(read(officialDoneSlot)).toEqual(['a', 'b'])
    toggleInList(officialDoneSlot, 'a')
    expect(read(officialDoneSlot)).toEqual(['b'])
  })

  it('treats corrupt or invalid entries as empty', () => {
    win.localStorage.setItem('oot-map:v1:official-done', '{nope')
    expect(read(officialDoneSlot)).toEqual([])
    win.localStorage.setItem(
      'oot-map:v1:pins:p:m',
      JSON.stringify([{ id: 'a', name: 'ok', x: 0.5, y: 0.5, done: false }, { id: 'b', x: 7 }]),
    )
    expect(read(pinsSlot('p', 'm')).map((p) => p.id)).toEqual(['a'])
  })

  it('stores the age filter and falls back to both', () => {
    expect(read(ageFilterSlot)).toBe('both')
    write(ageFilterSlot, 'adult')
    expect(read(ageFilterSlot)).toBe('adult')
    win.localStorage.setItem('oot-map:v1:age-filter', '"elderly"')
    expect(read(ageFilterSlot)).toBe('both')
  })

  it('renders the empty value during server rendering, whatever is stored', () => {
    write(officialVisibleSlot, true)
    const Probe = () => createElement('i', null, String(useStored(officialVisibleSlot)))
    expect(renderToString(createElement(Probe))).toContain('false')
  })

  it('hides item counts by default and shows them per place', () => {
    expect(read(itemCountVisibleSlot)).toEqual([])
    toggleInList(itemCountVisibleSlot, 'p1')
    expect(read(itemCountVisibleSlot)).toEqual(['p1'])
    toggleInList(itemCountVisibleSlot, 'p1')
    expect(read(itemCountVisibleSlot)).toEqual([])
  })

  it('stores hideDoneSlot with default false and strict boolean parsing', () => {
    expect(read(hideDoneSlot)).toBe(false)
    write(hideDoneSlot, true)
    expect(win.localStorage.getItem('oot-map:v1:hide-done')).toBe('true')
    expect(read(hideDoneSlot)).toBe(true)
    win.localStorage.setItem('oot-map:v1:hide-done', '"yes"')
    expect(read(hideDoneSlot)).toBe(false)
  })

  it('stores spoilerFreeSlot with default false and strict boolean parsing', () => {
    expect(read(spoilerFreeSlot)).toBe(false)
    write(spoilerFreeSlot, true)
    expect(win.localStorage.getItem('oot-map:v1:spoiler-free')).toBe('true')
    expect(read(spoilerFreeSlot)).toBe(true)
    win.localStorage.setItem('oot-map:v1:spoiler-free', '"yes"')
    expect(read(spoilerFreeSlot)).toBe(false)
  })

  it('stores nearestFinderSlot with default false, strict boolean parsing, and syncable key', () => {
    expect(isSyncableKey('nearest-finder')).toBe(true)
    expect(read(nearestFinderSlot)).toBe(false)
    write(nearestFinderSlot, true)
    expect(win.localStorage.getItem('oot-map:v1:nearest-finder')).toBe('true')
    expect(read(nearestFinderSlot)).toBe(true)
    win.localStorage.setItem('oot-map:v1:nearest-finder', '"yes"')
    expect(read(nearestFinderSlot)).toBe(false)
  })

  it('applies discovery and full exploration presets across officialVisibleSlot and spoilerFreeSlot', () => {
    expect(read(officialVisibleSlot)).toBe(false)
    expect(read(spoilerFreeSlot)).toBe(false)

    applyExplorationPreset('discovery')
    expect(read(officialVisibleSlot)).toBe(false)
    expect(read(spoilerFreeSlot)).toBe(true)

    applyExplorationPreset('full')
    expect(read(officialVisibleSlot)).toBe(true)
    expect(read(spoilerFreeSlot)).toBe(false)

    applyExplorationPreset('discovery')
    expect(read(officialVisibleSlot)).toBe(false)
    expect(read(spoilerFreeSlot)).toBe(true)
  })

  it('survives a storage that refuses writes', () => {
    win.localStorage.setItem = () => {
      throw new Error('quota')
    }
    expect(() => write(officialVisibleSlot, true)).not.toThrow()
  })
})

describe('pin types and reveals', () => {
  beforeEach(() => vi.stubGlobal('window', fakeWindow()))

  it('reads pins saved before types existed as Other', () => {
    const slot = pinsSlot('p', 'm')
    window.localStorage.setItem(
      `oot-map:v1:${slot.key}`,
      JSON.stringify([{ id: 'a', name: 'Old', x: 0.1, y: 0.2, done: false }]),
    )
    expect(read(slot)[0]?.type).toBe('other')
  })

  it('keeps and updates a pin type', () => {
    const pin = addPin('p2', 'm', 'Gold Skulltula', { x: 0.1, y: 0.2 }, 'gs')
    expect(read(pinsSlot('p2', 'm'))[0]?.type).toBe('gs')
    updatePin('p2', 'm', pin.id, { type: 'bean' })
    expect(read(pinsSlot('p2', 'm'))[0]?.type).toBe('bean')
  })

  it('sets list membership without duplicates', () => {
    setInList(officialRevealedSlot, 'a', true)
    setInList(officialRevealedSlot, 'a', true)
    expect(read(officialRevealedSlot)).toEqual(['a'])
    setInList(officialRevealedSlot, 'a', false)
    expect(read(officialRevealedSlot)).toEqual([])
  })
})

describe('saved views', () => {
  beforeEach(() => vi.stubGlobal('window', fakeWindow()))

  it('starts from the initial view', () => {
    expect(read(viewSlot('world'))).toEqual(INITIAL_VIEW)
  })

  it('keeps one view per map', () => {
    write(viewSlot('world'), { cx: 0.2, cy: 0.7, zoom: 3 })
    expect(read(viewSlot('world'))).toEqual({ cx: 0.2, cy: 0.7, zoom: 3 })
    expect(read(viewSlot('forest:f1'))).toEqual(INITIAL_VIEW)
  })

  it.each([
    ['a zoom out of range', { cx: 0.5, cy: 0.5, zoom: 99 }],
    ['a centre off the map', { cx: 2, cy: 0.5, zoom: 2 }],
    ['missing fields', { zoom: 2 }],
    ['the wrong type', 'zoomed'],
  ])('falls back to the initial view on %s', (_, stored) => {
    write(viewSlot('bad') as never, stored as never)
    expect(read(viewSlot('bad'))).toEqual(INITIAL_VIEW)
  })

  it('stores shared zoomSlot clamped to [0.5, 10] and falls back to 1 on invalid values', () => {
    expect(read(zoomSlot)).toBe(1)
    write(zoomSlot, 2.5)
    expect(read(zoomSlot)).toBe(2.5)
    write(zoomSlot, 0.1)
    expect(read(zoomSlot)).toBe(0.5)
    write(zoomSlot, 42)
    expect(read(zoomSlot)).toBe(10)
    window.localStorage.setItem('oot-map:v1:view-zoom', '"bad"')
    expect(read(zoomSlot)).toBe(1)
    window.localStorage.setItem('oot-map:v1:view-zoom', 'null')
    expect(read(zoomSlot)).toBe(1)
  })

  it('stores prerequisite slots with expected defaults and validation', () => {
    expect(read(prereqFilterEnabledSlot)).toBe(false)
    write(prereqFilterEnabledSlot, true)
    expect(read(prereqFilterEnabledSlot)).toBe(true)

    expect(read(prereqAutoSyncSlot)).toBe(true)
    write(prereqAutoSyncSlot, false)
    expect(read(prereqAutoSyncSlot)).toBe(false)
    window.localStorage.setItem('oot-map:v1:prereq-auto-sync', '"invalid"')
    expect(read(prereqAutoSyncSlot)).toBe(true)

    expect(read(ownedPrereqsSlot)).toEqual([])
    window.localStorage.setItem('oot-map:v1:owned-prereqs', JSON.stringify(['bombs', 42, null, 'bow']))
    expect(read(ownedPrereqsSlot)).toEqual(['bombs', 'bow'])
  })
})

describe('PC↔tablet remote sync', () => {
  beforeEach(() => {
    resetSyncForTests()
    vi.stubGlobal('window', fakeWindow())
  })

  it('distinguishes syncable progress keys from per-device view keys', () => {
    expect(isSyncableKey('official-visible')).toBe(true)
    expect(isSyncableKey('official-done')).toBe(true)
    expect(isSyncableKey('official-revealed')).toBe(true)
    expect(isSyncableKey('hidden-categories')).toBe(true)
    expect(isSyncableKey('hide-done')).toBe(true)
    expect(isSyncableKey('spoiler-free')).toBe(true)
    expect(isSyncableKey('item-count-visible')).toBe(true)
    expect(isSyncableKey('age-filter')).toBe(true)
    expect(isSyncableKey('age')).toBe(true)
    expect(isSyncableKey('prereq-filter-enabled')).toBe(true)
    expect(isSyncableKey('owned-prereqs')).toBe(true)
    expect(isSyncableKey('prereq-auto-sync')).toBe(true)
    expect(isSyncableKey('pins:kokiri:principal')).toBe(true)
    expect(isSyncableKey('oot-map:v1:pins:deku:1F')).toBe(true)

    expect(isSyncableKey('view-zoom')).toBe(false)
    expect(isSyncableKey('oot-map:v1:view-zoom')).toBe(false)
    expect(isSyncableKey('view:world')).toBe(false)
    expect(isSyncableKey('oot-map:v1:view:forest:1F')).toBe(false)
    expect(isSyncableKey('lichii-follow')).toBe(false)
    expect(isSyncableKey('lichii-auto-skulltula')).toBe(false)
  })

  it('applies remote sync state without triggering a PUT echo loop and ignores view:* keys', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    write(viewSlot('world'), { cx: 0.25, cy: 0.75, zoom: 2 })
    fetchMock.mockClear()

    const changed = applyRemoteSyncState({
      version: 2,
      entries: {
        'oot-map:v1:official-done': JSON.stringify(['kokiri-gs-01']),
        'oot-map:v1:age-filter': JSON.stringify('adult'),
        'oot-map:v1:pins:kokiri:principal': JSON.stringify([
          { id: 'p1', name: 'Remote Pin', type: 'other', x: 0.3, y: 0.4, done: false },
        ]),
        'oot-map:v1:view:world': JSON.stringify({ cx: 0.9, cy: 0.9, zoom: 4 }),
      },
    })

    expect(changed).toBe(true)
    expect(read(officialDoneSlot)).toEqual(['kokiri-gs-01'])
    expect(read(ageFilterSlot)).toBe('adult')
    expect(read(pinsSlot('kokiri', 'principal'))).toHaveLength(1)
    expect(read(viewSlot('world'))).toEqual({ cx: 0.25, cy: 0.75, zoom: 2 })
    expect(fetchMock).not.toHaveBeenCalled()

    // Stale or duplicate versions are ignored.
    expect(
      applyRemoteSyncState({
        version: 2,
        entries: { 'oot-map:v1:official-done': JSON.stringify([]) },
      }),
    ).toBe(false)
    expect(read(officialDoneSlot)).toEqual(['kokiri-gs-01'])
  })

  it('debounces PUT /api/sync/state for syncable writes and skips view:* writes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 3, updatedAt: Date.now(), entries: {} }),
    })
    vi.stubGlobal('fetch', fetchMock)

    write(viewSlot('world'), { cx: 0.4, cy: 0.6, zoom: 3 })
    await vi.advanceTimersByTimeAsync(200)
    expect(fetchMock).not.toHaveBeenCalled()

    write(officialDoneSlot, ['item-1'])
    write(officialDoneSlot, ['item-1', 'item-2'])
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(150)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sync/state',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          entries: { 'oot-map:v1:official-done': JSON.stringify(['item-1', 'item-2']) },
        }),
      }),
    )
  })

  it('initRemoteSync merges server entries and pushes local entries when server is empty', async () => {
    write(officialDoneSlot, ['local-only-gs'])
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: 0, updatedAt: 0, entries: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 1,
          updatedAt: Date.now(),
          entries: { 'oot-map:v1:official-done': JSON.stringify(['local-only-gs']) },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await initRemoteSync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sync/state')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sync/state')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' })
  })
})

describe('JSON backup export/import & save-slot profile isolation', () => {
  beforeEach(() => {
    resetSyncForTests()
    vi.stubGlobal('window', fakeWindow())
  })

  it('exports syncable entries while excluding view/zoom/profile metadata', () => {
    switchSaveProfile('slot_01')
    write(officialDoneSlot, ['deku-gs-01'])
    addPin('kokiri', 'principal', 'Secret Grotto', { x: 0.25, y: 0.75 }, 'other')
    write(zoomSlot, 2.5)
    write(viewSlot('world'), { cx: 0.5, cy: 0.5, zoom: 2 })

    const backup = exportProgressBackup()
    expect(backup.format).toBe('ocarina-atlas-backup')
    expect(backup.version).toBe(1)
    expect(backup.activeProfile).toBe('slot_01')
    expect(typeof backup.exportedAt).toBe('string')
    expect(backup.entries['oot-map:v1:official-done']).toBe(JSON.stringify(['deku-gs-01']))
    expect(backup.entries['oot-map:v1:pins:kokiri:principal']).toContain('Secret Grotto')
    expect(backup.entries['oot-map:v1:view-zoom']).toBeUndefined()
    expect(backup.entries['oot-map:v1:view:world']).toBeUndefined()
    expect(backup.entries['oot-map:v1:active-profile']).toBeUndefined()
    expect(backup.entries['oot-map:v1:profiles']).toBeUndefined()
  })

  it('validates and normalizes backup payloads and rejects corrupt or oversized payloads', () => {
    const valid = parseAndValidateProgressBackup(
      JSON.stringify({
        format: 'ocarina-atlas-backup',
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'slot_02',
        entries: {
          'official-done': JSON.stringify(['kokiri-gs-01']),
          'oot-map:v1:hide-done': JSON.stringify(true),
        },
      }),
    )
    expect(valid.activeProfile).toBe('slot_02')
    expect(valid.entries['oot-map:v1:official-done']).toBe(JSON.stringify(['kokiri-gs-01']))
    expect(valid.entries['oot-map:v1:hide-done']).toBe('true')

    expect(() => parseAndValidateProgressBackup('{bad json')).toThrow()
    expect(() =>
      parseAndValidateProgressBackup({
        format: 'wrong',
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'default',
        entries: {},
      }),
    ).toThrow()
    expect(() =>
      parseAndValidateProgressBackup({
        format: 'ocarina-atlas-backup',
        version: 2,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'default',
        entries: {},
      }),
    ).toThrow()
    expect(() =>
      parseAndValidateProgressBackup({
        format: 'ocarina-atlas-backup',
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'default',
        entries: [],
      }),
    ).toThrow()
    expect(() =>
      parseAndValidateProgressBackup({
        format: 'ocarina-atlas-backup',
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'default',
        entries: { 'oot-map:v1:view-zoom': '2' },
      }),
    ).toThrow()
    expect(() =>
      parseAndValidateProgressBackup({
        format: 'ocarina-atlas-backup',
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'default',
        entries: { 'oot-map:v1:official-done': 123 },
      }),
    ).toThrow()
    expect(() =>
      parseAndValidateProgressBackup({
        format: 'ocarina-atlas-backup',
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'default',
        entries: { 'oot-map:v1:official-done': '{not-json' },
      }),
    ).toThrow()
    expect(() =>
      parseAndValidateProgressBackup({
        format: 'ocarina-atlas-backup',
        version: 1,
        exportedAt: '2026-11-20T00:00:00.000Z',
        activeProfile: 'default',
        entries: { 'oot-map:v1:official-done': '{"not":"array"}' },
      }),
    ).toThrow()

    const oversized = 'x'.repeat(2 * 1024 * 1024 + 10)
    expect(() => parseAndValidateProgressBackup(oversized)).toThrow()
  })

  it('imports validated backup, switches activeProfile, and schedules LAN sync', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 4, updatedAt: Date.now(), entries: {} }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = importProgressBackup({
      format: 'ocarina-atlas-backup',
      version: 1,
      exportedAt: '2026-11-20T00:00:00.000Z',
      activeProfile: 'slot_01',
      entries: {
        'oot-map:v1:official-done': JSON.stringify(['jabu-gs-01']),
        'oot-map:v1:spoiler-free': JSON.stringify(true),
      },
    })

    expect(result).toEqual({ importedKeys: 2, activeProfile: 'slot_01' })
    expect(read(activeProfileSlot)).toBe('slot_01')
    expect(read(officialDoneSlot)).toEqual(['jabu-gs-01'])
    expect(read(spoilerFreeSlot)).toBe(true)

    await vi.advanceTimersByTimeAsync(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sync/state')
  })

  it('isolates playthrough-specific keys per save slot while preserving global preferences', () => {
    write(officialVisibleSlot, true)
    write(hideDoneSlot, true)
    write(spoilerFreeSlot, true)
    write(zoomSlot, 3.2)

    expect(read(activeProfileSlot)).toBe('default')
    expect(switchSaveProfile(null)).toBe('default')
    expect(switchSaveProfile('   ')).toBe('default')

    expect(switchSaveProfile('slot_00')).toBe('slot_00')
    write(officialDoneSlot, ['deku-gs-01'])
    write(officialRevealedSlot, ['deku-gs-01'])
    write(ownedPrereqsSlot, ['bombs'])
    addPin('kokiri', 'principal', 'Slot 0 Pin', { x: 0.2, y: 0.3 }, 'other')

    // Switch to brand-new slot_01: playthrough keys are clean, global UI prefs persist.
    expect(switchSaveProfile('slot_01')).toBe('slot_01')
    expect(read(activeProfileSlot)).toBe('slot_01')
    expect(read(officialDoneSlot)).toEqual([])
    expect(read(officialRevealedSlot)).toEqual([])
    expect(read(ownedPrereqsSlot)).toEqual([])
    expect(read(pinsSlot('kokiri', 'principal'))).toEqual([])
    expect(read(officialVisibleSlot)).toBe(true)
    expect(read(hideDoneSlot)).toBe(true)
    expect(read(spoilerFreeSlot)).toBe(true)
    expect(read(zoomSlot)).toBe(3.2)

    // Add slot_01-specific progress and switch back to slot_00.
    write(officialDoneSlot, ['espiritu-gs-01'])
    addPin('kokiri', 'principal', 'Slot 1 Pin', { x: 0.8, y: 0.7 }, 'gs')

    expect(switchSaveProfile('slot_00')).toBe('slot_00')
    expect(read(officialDoneSlot)).toEqual(['deku-gs-01'])
    expect(read(officialRevealedSlot)).toEqual(['deku-gs-01'])
    expect(read(ownedPrereqsSlot)).toEqual(['bombs'])
    expect(read(pinsSlot('kokiri', 'principal')).map((p) => p.name)).toEqual(['Slot 0 Pin'])

    // Switch back to slot_01 and verify its state was preserved.
    expect(switchSaveProfile('slot_01')).toBe('slot_01')
    expect(read(officialDoneSlot)).toEqual(['espiritu-gs-01'])
    expect(read(pinsSlot('kokiri', 'principal')).map((p) => p.name)).toEqual(['Slot 1 Pin'])
  })
})
