import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FloorGrid as Grid } from '../lib/floorGrid'
import type { CustomPin } from '../lib/storage'
import type { Item, Place } from '../lib/types'
import { FloorGrid } from './FloorGrid'
import { CustomMarker, OfficialMarker } from './Pins'

vi.mock('../lib/useLichiiTracker', async () => {
  const actual = await vi.importActual<typeof import('../lib/useLichiiTracker')>('../lib/useLichiiTracker')
  return {
    ...actual,
    useLichiiPosition: vi.fn(() => ({
      position: { x: 12.5, y: 0, z: -24.5, yaw: 90 },
      mapFraction: { x: 0.4, y: 0.6 },
      worldMapFraction: null,
    })),
  }
})

const sampleItem: Item = {
  id: 'deku-gs-1',
  n: 1,
  cat: 'skulltula',
  place: 'deku-tree',
  at: { map: 'f1', x: 0.25, y: 0.75 },
  name: 'Deku Tree Skulltula',
  desc: 'Behind the vines.',
  hint: null,
  age: 'child',
  night: false,
  requires: [],
  images: [],
}

const floor1Map = { id: 'f1', label: '1F', image: '/maps/deku-1f.png', aspect: 1 }
const floorB1Map = { id: 'b1', label: 'S1', image: '/maps/deku-b1.png', aspect: 1 }

const samplePlace: Place = {
  id: 'deku-tree',
  slug: 'deku-tree',
  kind: 'dungeon',
  name: 'Inside the Deku Tree',
  region: 'Kokiri Forest',
  intro: '',
  pin: { x: 0.5, y: 0.5 },
  maps: [floor1Map, floorB1Map],
  startMap: 'f1',
}

const sampleGrid: Grid = {
  aspect: 2,
  cells: [
    {
      map: floor1Map,
      left: 0,
      top: 0,
      width: 0.45,
      height: 1,
    },
    {
      map: floorB1Map,
      left: 0.55,
      top: 0,
      width: 0.45,
      height: 1,
    },
  ],
}

describe('OfficialMarker', () => {
  it('renders a 44x44 (size-11) hit area, DoneBadge, and opacity-50 when completed and unselected', () => {
    const html = renderToString(
      createElement(OfficialMarker, {
        item: sampleItem,
        at: { x: 0.25, y: 0.75 },
        done: true,
        selected: false,
        merge: null,
        onSelect: () => {},
      }),
    )

    expect(html).toContain('data-pin="true"')
    expect(html).toContain('size-11')
    expect(html).toContain('opacity-50')
    expect(html).toContain('bg-moss')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Completed')
  })

  it('keeps opacity-100 and omits DoneBadge when incomplete', () => {
    const html = renderToString(
      createElement(OfficialMarker, {
        item: sampleItem,
        at: { x: 0.25, y: 0.75 },
        done: false,
        selected: false,
        merge: null,
        onSelect: () => {},
      }),
    )

    expect(html).toContain('size-11')
    expect(html).toContain('opacity-100')
    expect(html).not.toContain('opacity-50')
    expect(html).not.toContain('bg-moss')
  })
})

describe('CustomMarker', () => {
  it('renders custom pin label, completed styling, and DoneBadge when done', () => {
    const pin: CustomPin = {
      id: 'custom-1',
      name: 'Secret Chest',
      type: 'other',
      x: 0.5,
      y: 0.5,
      done: true,
    }

    const html = renderToString(
      createElement(CustomMarker, {
        pin,
        selected: true,
        onSelect: () => {},
      }),
    )

    expect(html).toContain('data-pin="true"')
    expect(html).toContain('Secret Chest')
    expect(html).toContain('line-through')
    expect(html).toContain('bg-moss')
    expect(html).toContain('aria-pressed="true"')
  })
})

describe('FloorGrid', () => {
  it('renders floor cells with formatted labels, official markers, and LiveFloorPlayerPin', () => {
    const html = renderToString(
      createElement(FloorGrid, {
        place: samplePlace,
        grid: sampleGrid,
        viewport: null,
        draft: null,
        onDraft: () => {},
        onCreate: () => {},
        officialItems: [sampleItem],
        done: new Set(['deku-gs-1']),
        selectedCustom: null,
        selectedItem: null,
        merge: null,
        player: { mapId: 'f1', live: true },
        onSelectCustom: () => {},
        onSelectItem: () => {},
      }),
    )

    expect(html).toContain('data-floor="f1"')
    expect(html).toContain('data-floor="b1"')
    expect(html).toContain('>1F<')
    expect(html).toContain('>B1<')
    expect(html).toContain('Deku Tree Skulltula')
    expect(html).toContain('data-player-pin="true"')
  })
})
