import type { Item, ItemRequirement } from './types'

export const REQUIREMENT_GROUPS = {
  tools: [
    'slingshot',
    'bombs',
    'bombchus',
    'deku-sticks',
    'boomerang',
    'bow',
    'hookshot',
    'longshot',
    'megaton-hammer',
    'lens-of-truth',
    'ocarina',
    'dins-fire',
  ],
  gear: [
    'goron-bracelet',
    'silver-gauntlets',
    'golden-gauntlets',
    'silver-scale',
    'golden-scale',
    'zora-tunic',
    'iron-boots',
    'mirror-shield',
    'gerudo-card',
  ],
  songs: [
    'zeldas-lullaby',
    'eponas-song',
    'sarias-song',
    'suns-song',
    'song-of-time',
    'bolero-of-fire',
    'song-of-storms',
    'scarecrows-song',
  ],
  situational: ['epona', 'planted-bean', 'bugs', 'blue-fire'],
} as const

export type RequirementGroupKey = keyof typeof REQUIREMENT_GROUPS

export const ALL_PREREQUISITE_KEYS: readonly string[] = [
  ...REQUIREMENT_GROUPS.tools,
  ...REQUIREMENT_GROUPS.gear,
  ...REQUIREMENT_GROUPS.songs,
  ...REQUIREMENT_GROUPS.situational,
]

/** Maps each item that requires a planted Magic Bean to its exact soft-soil item ID in oot.json. */
const ITEM_BEAN_SPOT_MAP: Readonly<Record<string, string>> = {
  'perdido-gs-03': 'perdido-bean-02',
  'cementerio-heart-04': 'cementerio-bean-01',
  'sendero-heart-01': 'sendero-bean-01',
  'crater-heart-02': 'crater-bean-01',
  'lago-heart-02': 'lago-bean-01',
  'coloso-heart-01': 'coloso-bean-01',
  'coloso-gs-02': 'coloso-bean-01',
}

export type RequirementEvalOptions = {
  collectedBeanIds?: ReadonlySet<string>
  beanAutoSynced?: boolean
  item?: Pick<Item, 'id' | 'place'>
}

/**
 * Expands an owned prerequisite set with strict item-tier upgrade implications:
 * - `longshot` -> `hookshot`
 * - `golden-scale` -> `silver-scale`
 * - `golden-gauntlets` -> `silver-gauntlets` -> `goron-bracelet`
 */
export function expandOwnedRequirements(owned: Iterable<string>): Set<string> {
  const expanded = new Set<string>(owned)
  if (expanded.has('longshot')) {
    expanded.add('hookshot')
  }
  if (expanded.has('golden-scale')) {
    expanded.add('silver-scale')
  }
  if (expanded.has('golden-gauntlets')) {
    expanded.add('silver-gauntlets')
  }
  if (expanded.has('silver-gauntlets')) {
    expanded.add('goron-bracelet')
  }
  return expanded
}

function isSingleRequirementMet(
  key: string,
  ownedExpanded: ReadonlySet<string>,
  options?: RequirementEvalOptions,
): boolean {
  if (key === 'planted-bean' && options?.beanAutoSynced && options.collectedBeanIds) {
    if (options.item) {
      const exactSpotId = ITEM_BEAN_SPOT_MAP[options.item.id]
      if (exactSpotId) {
        return options.collectedBeanIds.has(exactSpotId)
      }
      const placePrefix = `${options.item.place}-bean-`
      for (const beanId of options.collectedBeanIds) {
        if (beanId.startsWith(placePrefix)) return true
      }
      return false
    }
    return options.collectedBeanIds.size > 0
  }
  return ownedExpanded.has(key)
}

/**
 * Evaluates a single requirement clause (`string | string[]`), where an array represents OR options.
 * Can be called directly by ItemDetail to show met vs. missing requirement badges.
 */
export function isRequirementClauseMet(
  clause: ItemRequirement,
  ownedExpanded: ReadonlySet<string>,
  options?: RequirementEvalOptions,
): boolean {
  if (typeof clause === 'string') {
    return isSingleRequirementMet(clause, ownedExpanded, options)
  }
  return clause.some((optionKey) => isSingleRequirementMet(optionKey, ownedExpanded, options))
}

/**
 * Evaluates whether all AND clauses in `item.requires` are satisfied by `ownedExpanded`.
 * Deliberately ignores `item.night` (and `item.age`, which is handled by the age filter).
 */
export function meetsItemRequirements(
  item: Pick<Item, 'id' | 'place' | 'requires'>,
  ownedExpanded: ReadonlySet<string>,
  options?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>,
): boolean {
  if (item.requires.length === 0) return true
  const evalOptions: RequirementEvalOptions | undefined = options
    ? { ...options, item }
    : undefined
  return item.requires.every((clause) => isRequirementClauseMet(clause, ownedExpanded, evalOptions))
}
