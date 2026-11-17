import { describe, expect, it } from 'vitest'
import { dataset } from './data'
import {
  ALL_PREREQUISITE_KEYS,
  REQUIREMENT_GROUPS,
  expandOwnedRequirements,
  isRequirementClauseMet,
  meetsItemRequirements,
} from './prerequisites'
import type { Item } from './types'

describe('REQUIREMENT_GROUPS', () => {
  it('organizes exactly the 33 used requirement keys from oot.json into 4 groups with no duplicates', () => {
    const usedKeys = new Set<string>()
    for (const item of dataset.items) {
      for (const clause of item.requires) {
        if (typeof clause === 'string') usedKeys.add(clause)
        else for (const opt of clause) usedKeys.add(opt)
      }
    }

    expect(usedKeys.size).toBe(33)
    expect(ALL_PREREQUISITE_KEYS).toHaveLength(33)
    expect(new Set(ALL_PREREQUISITE_KEYS)).toEqual(usedKeys)
    expect(REQUIREMENT_GROUPS.tools).toHaveLength(12)
    expect(REQUIREMENT_GROUPS.gear).toHaveLength(9)
    expect(REQUIREMENT_GROUPS.songs).toHaveLength(8)
    expect(REQUIREMENT_GROUPS.situational).toHaveLength(4)
  })
})

describe('expandOwnedRequirements', () => {
  it('expands upgrade implications for longshot, golden-scale, and gauntlets', () => {
    expect(Array.from(expandOwnedRequirements(['longshot'])).sort()).toEqual(['hookshot', 'longshot'])
    expect(Array.from(expandOwnedRequirements(['golden-scale'])).sort()).toEqual([
      'golden-scale',
      'silver-scale',
    ])
    expect(Array.from(expandOwnedRequirements(['silver-gauntlets'])).sort()).toEqual([
      'goron-bracelet',
      'silver-gauntlets',
    ])
    expect(Array.from(expandOwnedRequirements(['golden-gauntlets'])).sort()).toEqual([
      'golden-gauntlets',
      'goron-bracelet',
      'silver-gauntlets',
    ])
  })
})

describe('isRequirementClauseMet and meetsItemRequirements', () => {
  const makeItem = (overrides: Partial<Item> = {}): Item => ({
    id: 'test-item',
    n: 1,
    cat: 'gs',
    place: 'kokiri',
    at: null,
    name: 'Test Item',
    desc: '',
    hint: null,
    age: 'both',
    night: false,
    requires: [],
    images: [],
    ...overrides,
  })

  it('always passes items with empty requires and ignores item.night completely', () => {
    const nightItem = makeItem({ night: true, requires: [] })
    expect(meetsItemRequirements(nightItem, new Set())).toBe(true)

    const nightWithReqs = makeItem({ night: true, requires: ['hookshot'] })
    expect(meetsItemRequirements(nightWithReqs, expandOwnedRequirements(['longshot']))).toBe(true)
    expect(meetsItemRequirements(nightWithReqs, new Set())).toBe(false)
  })

  it('evaluates AND across clauses and OR within nested array clauses', () => {
    const item = makeItem({
      requires: [['bombs', 'goron-bracelet'], 'zeldas-lullaby'],
    })

    expect(isRequirementClauseMet(['bombs', 'goron-bracelet'], expandOwnedRequirements(['silver-gauntlets']))).toBe(
      true,
    )
    expect(isRequirementClauseMet('zeldas-lullaby', expandOwnedRequirements(['silver-gauntlets']))).toBe(false)

    expect(meetsItemRequirements(item, expandOwnedRequirements(['silver-gauntlets']))).toBe(false)
    expect(
      meetsItemRequirements(item, expandOwnedRequirements(['silver-gauntlets', 'zeldas-lullaby'])),
    ).toBe(true)
    expect(meetsItemRequirements(item, expandOwnedRequirements(['bombs', 'zeldas-lullaby']))).toBe(true)
  })

  it('uses per-spot bean matching when beanAutoSynced is true and falls back to planted-bean otherwise', () => {
    const perdidoGs = dataset.items.find((i) => i.id === 'perdido-gs-03')!
    const lagoHeart = dataset.items.find((i) => i.id === 'lago-heart-02')!
    const colosoGs = dataset.items.find((i) => i.id === 'coloso-gs-02')!

    // Manual mode: global 'planted-bean' satisfies all bean spots
    const manualOwned = expandOwnedRequirements(['planted-bean'])
    expect(meetsItemRequirements(perdidoGs, manualOwned)).toBe(true)
    expect(meetsItemRequirements(lagoHeart, manualOwned)).toBe(true)

    // Auto-synced bean mode: checks exact spot (perdido-bean-01 does NOT unlock perdido-gs-03, which needs perdido-bean-02)
    const syncedBeans = new Set(['perdido-bean-01', 'lago-bean-01'])
    expect(
      meetsItemRequirements(perdidoGs, manualOwned, {
        collectedBeanIds: syncedBeans,
        beanAutoSynced: true,
      }),
    ).toBe(false)
    expect(
      meetsItemRequirements(lagoHeart, manualOwned, {
        collectedBeanIds: syncedBeans,
        beanAutoSynced: true,
      }),
    ).toBe(true)
    expect(
      isRequirementClauseMet('planted-bean', manualOwned, {
        item: perdidoGs,
        collectedBeanIds: syncedBeans,
        beanAutoSynced: true,
      }),
    ).toBe(false)

    // OR clause [['planted-bean', 'longshot']] on coloso-gs-02 still passes via longshot even if coloso-bean-01 is unplanted
    expect(
      meetsItemRequirements(colosoGs, expandOwnedRequirements(['planted-bean', 'longshot']), {
        collectedBeanIds: syncedBeans,
        beanAutoSynced: true,
      }),
    ).toBe(true)

    // And passes via exact coloso-bean-01 when planted
    expect(
      meetsItemRequirements(colosoGs, new Set(), {
        collectedBeanIds: new Set(['coloso-bean-01']),
        beanAutoSynced: true,
      }),
    ).toBe(true)
  })
})
