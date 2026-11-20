export type Locale =
  | 'en'
  | 'es'
  | 'fr'
  | 'pt'
  | 'zh-CN'
  | 'zh-TW'
  | 'de'
  | 'it'
  | 'ja'
  | 'ko'
  | 'nl'
  | 'ru'
  | 'pl'
  | 'tr'
  | 'uk'

export type GuidePlaceTranslation = {
  intro?: string
}

export type GuideItemTranslation = {
  name?: string
  desc?: string
  hint?: string | null
}

export type GuideTranslationFile = {
  places: Record<string, GuidePlaceTranslation>
  items: Record<string, GuideItemTranslation>
}

export type LocaleBundle<TKey extends string = string> = {
  messages: Record<TKey, string>
  categories: Record<string, string>
  places: Record<string, string>
  regions: Record<string, string>
  requirements: Record<string, string>
  guides?: GuideTranslationFile
}
