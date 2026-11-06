export type Fraction = { x: number; y: number }

export type Category = { key: string; name: string }
export type Requirement = { key: string; name: string }

export type PlaceMap = {
  id: string
  label: string
  image: string
  /** width / height of the image */
  aspect: number
}

export type Place = {
  id: string
  slug: string
  kind: 'zone' | 'dungeon'
  name: string
  region: string
  intro: string
  pin: Fraction
  maps: PlaceMap[]
  startMap: string | null
}

/** A key, or a nested list of keys of which any one is enough. */
export type ItemRequirement = string | string[]

export type Item = {
  id: string
  n: number
  cat: string
  place: string
  at: ({ map: string } & Fraction) | null
  name: string
  desc: string
  hint: string | null
  age: string | null
  night: boolean
  requires: ItemRequirement[]
  images: string[]
}

/** Which of Link's ages the official pins are shown for. */
export type AgeFilter = 'child' | 'adult' | 'both'

export type Dataset = {
  map: { image: string; width: number; height: number }
  categories: Category[]
  requirements: Requirement[]
  places: Place[]
  items: Item[]
}
