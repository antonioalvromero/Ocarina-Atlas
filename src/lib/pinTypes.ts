/** The type of a pin that matches no official category and never merges. */
export const OTHER_PIN = 'other'

/** Keys match dataset categories, so a pin can be compared with official items. */
export const PIN_TYPES = [
  { key: 'gs', label: 'Gold Skulltula' },
  { key: 'heart', label: 'Piece of Heart' },
  { key: 'container', label: 'Heart Container' },
  { key: 'bean', label: 'Magic Bean soil' },
  { key: 'fairy', label: 'Great Fairy' },
  { key: 'bottle', label: 'Bottle' },
  { key: 'key', label: 'Key' },
  { key: 'thought', label: 'Fairy Thought' },
  { key: OTHER_PIN, label: 'Other' },
]

export function pinTypeLabel(type: string): string {
  return PIN_TYPES.find((candidate) => candidate.key === type)?.label ?? type
}
