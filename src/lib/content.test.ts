import { describe, expect, it } from 'vitest'
import { requirementLabel } from './data'
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

describe('requirementLabel', () => {
  it('joins nested alternatives with "or"', () => {
    expect(requirementLabel(['bombs', 'megaton-hammer'])).toBe('Bombs or Megaton Hammer')
    expect(requirementLabel('bombs')).toBe('Bombs')
    expect(requirementLabel('unknown-key')).toBe('unknown-key')
  })
})
