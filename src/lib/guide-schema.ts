import type { Dataset } from './types'

export type GuideValidationResult = {
  valid: boolean
  errors: string[]
}

const ALLOWED_TOP_LEVEL_KEYS = new Set(['places', 'items'])
const ALLOWED_PLACE_KEYS = new Set(['intro'])
const ALLOWED_ITEM_KEYS = new Set(['name', 'desc', 'hint'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks whether a string has balanced `**` bold markdown delimiters
 * and contains no empty `****` bold spans.
 */
export function hasBalancedBoldMarkers(text: string): boolean {
  if (text.includes('****')) return false
  const matches = text.match(/\*\*/g)
  if (!matches) return true
  return matches.length % 2 === 0
}

/**
 * Validates a community guide translation JSON object against a `Dataset`.
 *
 * Checks:
 * - Top-level structure (`places` and `items` plain objects, no unexpected keys)
 * - Every `place.id` in `dataset.places` has a non-empty string `intro` and no unexpected keys
 * - No unknown place IDs exist in `guide.places`
 * - Every `item.id` in `dataset.items` has non-empty string `name` and `desc` and no unexpected keys
 * - No unknown item IDs exist in `guide.items`
 * - `hint` parity with `dataset.items` (items with non-null `hint` in dataset must have a non-empty string `hint`; items with `hint: null` must not define a non-null `hint`)
 * - Balanced `**` bold markdown markers across all `intro`, `name`, `desc`, and `hint` strings
 */
export function validateGuideTranslation(
  guide: unknown,
  dataset: Dataset,
): GuideValidationResult {
  const errors: string[] = []

  if (!isPlainObject(guide)) {
    return {
      valid: false,
      errors: ['Guide translation root must be a plain JSON object.'],
    }
  }

  for (const key of Object.keys(guide)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Unexpected top-level key "${key}". Expected only "places" and "items".`)
    }
  }

  const placesRaw = guide.places
  const itemsRaw = guide.items

  if (!isPlainObject(placesRaw)) {
    errors.push('Missing or invalid top-level "places" object.')
  }
  if (!isPlainObject(itemsRaw)) {
    errors.push('Missing or invalid top-level "items" object.')
  }

  if (!isPlainObject(placesRaw) || !isPlainObject(itemsRaw)) {
    return {
      valid: false,
      errors,
    }
  }

  const datasetPlaceIds = new Set<string>()
  for (const place of dataset.places) {
    datasetPlaceIds.add(place.id)
    const entry = placesRaw[place.id]
    if (!isPlainObject(entry)) {
      errors.push(`places.${place.id}: missing or invalid place translation object.`)
      continue
    }

    for (const key of Object.keys(entry)) {
      if (!ALLOWED_PLACE_KEYS.has(key)) {
        errors.push(`places.${place.id}: unexpected key "${key}".`)
      }
    }

    if (typeof entry.intro !== 'string' || entry.intro.trim().length === 0) {
      errors.push(`places.${place.id}.intro: must be a non-empty string.`)
    } else if (!hasBalancedBoldMarkers(entry.intro)) {
      errors.push(`places.${place.id}.intro: unbalanced "**" bold markdown markers.`)
    }
  }

  for (const placeId of Object.keys(placesRaw)) {
    if (!datasetPlaceIds.has(placeId)) {
      errors.push(`places.${placeId}: unknown place ID not present in dataset.`)
    }
  }

  const datasetItemIds = new Set<string>()
  for (const item of dataset.items) {
    datasetItemIds.add(item.id)
    const entry = itemsRaw[item.id]
    if (!isPlainObject(entry)) {
      errors.push(`items.${item.id}: missing or invalid item translation object.`)
      continue
    }

    for (const key of Object.keys(entry)) {
      if (!ALLOWED_ITEM_KEYS.has(key)) {
        errors.push(`items.${item.id}: unexpected key "${key}".`)
      }
    }

    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      errors.push(`items.${item.id}.name: must be a non-empty string.`)
    } else if (!hasBalancedBoldMarkers(entry.name)) {
      errors.push(`items.${item.id}.name: unbalanced "**" bold markdown markers.`)
    }

    if (typeof entry.desc !== 'string' || entry.desc.trim().length === 0) {
      errors.push(`items.${item.id}.desc: must be a non-empty string.`)
    } else if (!hasBalancedBoldMarkers(entry.desc)) {
      errors.push(`items.${item.id}.desc: unbalanced "**" bold markdown markers.`)
    }

    if (item.hint !== null) {
      if (typeof entry.hint !== 'string' || entry.hint.trim().length === 0) {
        errors.push(
          `items.${item.id}.hint: must be a non-empty string (dataset item has a hint).`,
        )
      } else if (!hasBalancedBoldMarkers(entry.hint)) {
        errors.push(`items.${item.id}.hint: unbalanced "**" bold markdown markers.`)
      }
    } else if (entry.hint !== undefined && entry.hint !== null) {
      errors.push(
        `items.${item.id}.hint: unexpected hint translation (dataset item has hint: null).`,
      )
    }
  }

  for (const itemId of Object.keys(itemsRaw)) {
    if (!datasetItemIds.has(itemId)) {
      errors.push(`items.${itemId}: unknown item ID not present in dataset.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
