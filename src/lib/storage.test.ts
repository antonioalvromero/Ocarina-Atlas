import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addPin,
  ageFilterSlot,
  itemCountVisibleSlot,
  officialDoneSlot,
  officialRevealedSlot,
  officialVisibleSlot,
  pinsSlot,
  read,
  removePin,
  setInList,
  toggleInList,
  updatePin,
  useStored,
  write,
} from './storage'

function fakeWindow() {
  const entries = new Map<string, string>()
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

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
