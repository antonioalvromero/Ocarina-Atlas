import { Check, RefreshCw, Trash2, Wrench, X } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useI18n, type TranslationKey } from '../lib/i18n'
import {
  ALL_PREREQUISITE_KEYS,
  REQUIREMENT_GROUPS,
  type RequirementGroupKey,
} from '../lib/prerequisites'
import { ownedPrereqsSlot, toggleInList, useStored, write } from '../lib/storage'
import { useLichiiTracker } from '../lib/useLichiiTracker'
import { useModalFocusTrap } from '../lib/useModalFocusTrap'

const GROUP_ORDER: readonly RequirementGroupKey[] = ['tools', 'gear', 'songs', 'situational']

export type GearChecklistModalProps = {
  open: boolean
  onClose: () => void
}

function GearChecklistDialog({ onClose }: { onClose: () => void }) {
  const { t, tRequirement } = useI18n()
  const ownedPrereqs = useStored(ownedPrereqsSlot)
  const tracker = useLichiiTracker({ trackPosition: false })
  const dialogRef = useRef<HTMLDivElement>(null)

  useModalFocusTrap(true, dialogRef, onClose)

  const ownedSet = useMemo(() => new Set(ownedPrereqs), [ownedPrereqs])
  const ownedCount = useMemo(
    () => ALL_PREREQUISITE_KEYS.filter((key) => ownedSet.has(key)).length,
    [ownedSet],
  )
  const detectedRequirements = tracker.state.ownedRequirements
  const hasDetectedRequirements = Boolean(detectedRequirements && detectedRequirements.length > 0)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gear-checklist-title"
        data-overlay-open="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[min(88dvh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#e8c04a]/40 bg-ink-900 text-parchment-200 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-700 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Wrench size={16} className="shrink-0 text-[#e8c04a]" aria-hidden />
              <h2 id="gear-checklist-title" className="font-serif text-lg text-parchment-50">
                {t('filter.gearTitle')}
              </h2>
              <span className="rounded-full border border-[#e8c04a]/40 bg-[#e8c04a]/10 px-2 py-0.5 text-xs font-medium text-[#f3d473] tabular-nums">
                {ownedCount}/{ALL_PREREQUISITE_KEYS.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-parchment-400">{t('filter.gearSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-ink-700 bg-ink-800/80 text-parchment-200 transition-colors hover:border-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 bg-ink-950/50 px-5 py-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={tracker.prereqAutoSync}
            onClick={tracker.togglePrereqAutoSync}
            className="flex cursor-pointer items-center gap-2 text-xs text-parchment-200"
          >
            <span>{t('filter.autoSync')}</span>
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${
                tracker.prereqAutoSync ? 'bg-moss' : 'bg-ink-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-parchment-50 transition-transform ${
                  tracker.prereqAutoSync ? 'translate-x-4' : ''
                }`}
              />
            </span>
          </button>

          <div className="flex items-center gap-2">
            {hasDetectedRequirements && (
              <button
                type="button"
                onClick={() => tracker.syncPrereqsFromGame()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#e8c04a]/50 bg-[#e8c04a]/15 px-2.5 py-1 text-xs font-medium text-[#f3d473] transition-colors hover:bg-[#e8c04a]/25"
              >
                <RefreshCw size={12} aria-hidden />
                {t('filter.syncFromGame')}
              </button>
            )}
            <button
              type="button"
              disabled={ownedCount === 0}
              onClick={() => write(ownedPrereqsSlot, [])}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs font-medium text-parchment-200 transition-colors hover:border-ember/70 hover:text-ember disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={12} aria-hidden />
              {t('filter.clearAll')}
            </button>
          </div>
        </div>

        <div className="hyrule-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {GROUP_ORDER.map((groupKey) => {
            const keys = REQUIREMENT_GROUPS[groupKey]
            const groupOwned = keys.filter((key) => ownedSet.has(key)).length
            return (
              <section key={groupKey}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-serif text-sm font-medium text-parchment-50">
                    {t(`filter.group.${groupKey}` as TranslationKey)}
                  </h3>
                  <span className="text-[11px] text-parchment-400 tabular-nums">
                    {groupOwned}/{keys.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {keys.map((reqKey) => {
                    const checked = ownedSet.has(reqKey)
                    return (
                      <button
                        key={reqKey}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggleInList(ownedPrereqsSlot, reqKey)}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                          checked
                            ? 'border-[#e8c04a]/70 bg-[#e8c04a]/15 font-medium text-parchment-50'
                            : 'border-ink-700 bg-ink-950/60 text-parchment-200 hover:border-parchment-400/60 hover:bg-ink-800/70'
                        }`}
                      >
                        <span
                          className={`grid size-4 shrink-0 place-items-center rounded border ${
                            checked
                              ? 'border-[#e8c04a] bg-[#e8c04a] text-ink-950'
                              : 'border-parchment-600 bg-ink-900'
                          }`}
                        >
                          {checked && <Check size={11} strokeWidth={3.5} aria-hidden />}
                        </span>
                        <span className="min-w-0 truncate">{tRequirement(reqKey)}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        <div className="flex justify-end border-t border-ink-700 bg-ink-950/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md bg-parchment-200 px-3.5 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-parchment-50"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function GearChecklistModal({ open, onClose }: GearChecklistModalProps) {
  if (!open) return null
  return <GearChecklistDialog onClose={onClose} />
}
