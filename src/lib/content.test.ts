import { describe, expect, it } from 'vitest'
import { matchesAge, requirementLabel } from './data'
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
