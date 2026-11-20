import { describe, expect, it } from 'vitest'
import { dataset, matchesAge, requirementLabel } from './data'
import type { Item } from './types'
import { parseRichText } from './richText'

describe('parseRichText', () => {
  it('splits paragraphs and bold spans', () => {
    expect(parseRichText('Use **Bombs** here.\n\nThen <b>leave</b>.')).toEqual([
      [
        { text: 'Use ', bold: false },
        { text: 'Bombs', bold: true },
        { text: ' here.', bold: false },
      ],
      [{ text: 'Then <b>leave</b>.', bold: false }],
    ])
  })

  it('leaves unmatched markers as text', () => {
    expect(parseRichText('2 ** 3')).toEqual([[{ text: '2 ** 3', bold: false }]])
  })
})

describe('matchesAge', () => {
  const aged = (age: string | null) => ({ age }) as Item

  it('keeps only items reachable at the chosen age', () => {
    expect(matchesAge(aged('child'), 'child')).toBe(true)
    expect(matchesAge(aged('adult'), 'child')).toBe(false)
    expect(matchesAge(aged('child'), 'adult')).toBe(false)
    expect(matchesAge(aged('both'), 'adult')).toBe(true)
  })

  it('keeps items with no recorded age', () => {
    expect(matchesAge(aged(null), 'child')).toBe(true)
    expect(matchesAge(aged(null), 'adult')).toBe(true)
  })

  it('keeps everything for both', () => {
    expect(matchesAge(aged('child'), 'both')).toBe(true)
    expect(matchesAge(aged('adult'), 'both')).toBe(true)
  })
})

describe('requirementLabel', () => {
  it('joins nested alternatives with "or"', () => {
    expect(requirementLabel(['bombs', 'megaton-hammer'])).toBe('Bombs or Megaton Hammer')
    expect(requirementLabel('bombs')).toBe('Bombs')
    expect(requirementLabel('unknown-key')).toBe('unknown-key')
  })
})

describe('dataset pin placements', () => {
  it('places lonlon-gs-02 in Hyrule Field (llanura) at the grotto southeast of Lon Lon Ranch (Issue #48)', () => {
    const skulltula = dataset.items.find((item) => item.id === 'lonlon-gs-02')
    const thought = dataset.items.find((item) => item.id === 'llanura-thought-03')

    expect(skulltula).toBeDefined()
    expect(thought).toBeDefined()
    expect(skulltula?.place).toBe('llanura')
    expect(skulltula?.at).toEqual({ map: 'principal', x: 0.6442, y: 0.7654 })
    expect(skulltula?.at).not.toEqual(thought?.at)
  })

  it('marks "Wall of the ranch garden" Fairy Thought as child-only (Issue #50)', () => {
    const thought = dataset.items.find((item) => item.name === 'Wall of the ranch garden')

    expect(thought).toBeDefined()
    expect(thought?.id).toBe('lonlon-thought-01')
    expect(thought?.place).toBe('lonlon')
    expect(thought?.age).toBe('child')
  })

  it('places llanura-heart-01 (Business Scrub by the moat) at its calibrated Hyrule Field coordinates as child-only', () => {
    const heart = dataset.items.find((item) => item.id === 'llanura-heart-01')

    expect(heart).toBeDefined()
    expect(heart?.place).toBe('llanura')
    expect(heart?.at).toEqual({ map: 'principal', x: 0.647, y: 0.1344 })
    expect(heart?.age).toBe('child')
  })

  it('places llanura-heart-02 and llanura-thought-02 at the calibrated chest cave hollow in Hyrule Field', () => {
    const heart = dataset.items.find((item) => item.id === 'llanura-heart-02')
    const thought = dataset.items.find((item) => item.id === 'llanura-thought-02')

    expect(heart).toBeDefined()
    expect(thought).toBeDefined()
    expect(heart?.place).toBe('llanura')
    expect(heart?.at).toEqual({ map: 'principal', x: 0.2545, y: 0.3576 })
    expect(heart?.age).toBe('child')
    expect(thought?.place).toBe('llanura')
    expect(thought?.at).toEqual({ map: 'principal', x: 0.2445, y: 0.3576 })
    expect(thought?.age).toBe('adult')
  })
})
