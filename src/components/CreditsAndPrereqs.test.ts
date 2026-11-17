import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { expandOwnedRequirements } from '../lib/prerequisites'
import type { Item } from '../lib/types'
import { CreditsModal, OFFICIAL_GITHUB_URL, ORIGINAL_MAP_GITHUB_URL } from './CreditsModal'
import { GearChecklistModal } from './GearChecklistModal'
import { ItemDetail } from './ItemDetail'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'test-item',
    n: 1,
    cat: 'gs',
    place: 'kokiri',
    at: null,
    name: 'Test Item',
    desc: 'Test description',
    hint: null,
    age: 'both',
    night: false,
    requires: ['hookshot', 'zeldas-lullaby'],
    images: [],
    ...overrides,
  }
}

describe('CreditsModal', () => {
  it('renders nothing when closed and renders official attributions when open', () => {
    const closedHtml = renderToString(
      createElement(CreditsModal, { open: false, onClose: vi.fn() }),
    )
    expect(closedHtml).toBe('')

    const openHtml = renderToString(
      createElement(CreditsModal, { open: true, onClose: vi.fn() }),
    ).replace(/<!-- -->/g, '')

    expect(openHtml).toContain('antonioalvromero')
    expect(openHtml).toContain('lucasriondel')
    expect(openHtml).toContain('Nintendúo')
    expect(openHtml).toContain(OFFICIAL_GITHUB_URL)
    expect(openHtml).toContain(ORIGINAL_MAP_GITHUB_URL)
    expect(openHtml).toContain('GNU AGPL-3.0')
    expect(openHtml).toContain('forks must preserve credits and share source')
  })
})

describe('GearChecklistModal', () => {
  it('renders grouped 33-item checklist when open', () => {
    const closedHtml = renderToString(
      createElement(GearChecklistModal, { open: false, onClose: vi.fn() }),
    )
    expect(closedHtml).toBe('')

    const openHtml = renderToString(
      createElement(GearChecklistModal, { open: true, onClose: vi.fn() }),
    ).replace(/<!-- -->/g, '')

    expect(openHtml).toContain('0/33')
    expect(openHtml).toContain('Tools &amp; Weapons')
    expect(openHtml).toContain('Gear &amp; Upgrades')
    expect(openHtml).toContain('Songs')
    expect(openHtml).toContain('Situational')
    expect(openHtml).toContain('Longshot')
    expect(openHtml).toContain('Auto-sync gear')
  })
})

describe('ItemDetail prerequisite highlighting', () => {
  it('highlights met vs missing requirement badges when ownedExpanded is provided', () => {
    const item = makeItem()
    const html = renderToString(
      createElement(ItemDetail, {
        item,
        ownedExpanded: expandOwnedRequirements(['longshot']),
      }),
    ).replace(/<!-- -->/g, '')

    // Hookshot is satisfied via longshot upgrade implication; Zelda's Lullaby is missing.
    expect(html).toContain('Hookshot')
    expect(html).toContain("Zelda&#x27;s Lullaby")
    expect(html).toContain('text-moss')
    expect(html).toContain('text-ember')
  })
})
