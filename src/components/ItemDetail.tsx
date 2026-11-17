import { Check, Moon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { categoryName } from '../lib/data'
import { useI18n, type TranslationKey } from '../lib/i18n'
import { isRequirementClauseMet, type RequirementEvalOptions } from '../lib/prerequisites'
import type { Item } from '../lib/types'
import { RichText } from './RichText'

const ageLabelKeys: Record<string, TranslationKey> = {
  child: 'panel.ageChild',
  adult: 'panel.ageAdult',
  both: 'panel.ageChildOrAdult',
}

type ChipTone = 'neutral' | 'met' | 'missing'

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  neutral: 'border-ink-600 bg-ink-800 text-parchment-200',
  met: 'border-moss/55 bg-moss/15 text-moss',
  missing: 'border-ember/60 bg-ember/10 text-ember',
}

function Chip({ children, tone = 'neutral', title }: { children: ReactNode; tone?: ChipTone; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${CHIP_TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}

function Photo({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full rounded-md border border-ink-600"
    />
  )
}

export function ItemDetail({
  item,
  ownedExpanded,
  evalOptions,
}: {
  item: Item
  ownedExpanded?: ReadonlySet<string>
  evalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
}) {
  const { t, tCategory, tRequirement, tItemName, tItemDesc, tItemHint } = useI18n()
  const itemName = tItemName(item.id, item.name)
  const ageKey = item.age ? ageLabelKeys[item.age] : undefined
  const requirementOptions = evalOptions ? { ...evalOptions, item } : { item }
  return (
    <div className="space-y-3 px-2 pt-1 pb-3 text-sm leading-relaxed text-parchment-200">
      <div className="flex flex-wrap gap-1">
        <Chip>{tCategory(item.cat, categoryName(item.cat))}</Chip>
        {item.age && <Chip>{ageKey ? t(ageKey) : item.age}</Chip>}
        {item.night && (
          <Chip>
            <Moon size={11} /> {t('item.nightOnly')}
          </Chip>
        )}
      </div>
      <RichText text={tItemDesc(item.id, item.desc)} />
      {item.hint && (
        <div className="rounded-md border-l-2 border-parchment-400 bg-ink-800 px-3 py-2">
          <p className="text-[11px] font-medium tracking-wide text-parchment-400 uppercase">{t('item.hint')}</p>
          <RichText text={tItemHint(item.id, item.hint)} />
        </div>
      )}
      {item.requires.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-parchment-400 uppercase">{t('item.requires')}</p>
          <ul className="flex flex-wrap gap-1">
            {item.requires.map((requirement, index) => {
              const met = ownedExpanded
                ? isRequirementClauseMet(requirement, ownedExpanded, requirementOptions)
                : null
              return (
                <li key={index}>
                  <Chip
                    tone={met === true ? 'met' : met === false ? 'missing' : 'neutral'}
                    title={met === false ? t('filter.missingReqs') : undefined}
                  >
                    {met === true && <Check size={10} strokeWidth={3} aria-hidden />}
                    {tRequirement(requirement)}
                  </Chip>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {item.images.map((src, index) => (
        <Photo key={src} src={src} alt={t('item.imageAlt', { name: itemName, index: index + 1 })} />
      ))}
    </div>
  )
}
