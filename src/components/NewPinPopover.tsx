import { useRef, useState, type FormEvent } from 'react'
import { useI18n, type TranslationKey } from '../lib/i18n'
import { useModalFocusTrap } from '../lib/useModalFocusTrap'
import type { Projection } from './MapViewport'
import { OTHER_PIN, PIN_TYPES } from '../lib/pinTypes'
import type { Fraction } from '../lib/types'
import { categoryStyle } from './categories'

const WIDTH = 288
const HEIGHT = 244
const GAP = 12

const PIN_TYPE_KEYS = new Set<string>(PIN_TYPES.map((p) => p.key))

function TypeTile({ type, label, autoFocus, onPick }: { type: string; label: string; autoFocus: boolean; onPick: () => void }) {
  const { icon: Icon, color } = categoryStyle(type)
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onPick}
      className="flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-ink-600 bg-ink-950 px-1 text-center text-[11px] leading-tight text-parchment-200 hover:border-parchment-400 hover:text-parchment-50"
    >
      <Icon size={15} style={{ color }} aria-hidden />
      {label}
    </button>
  )
}

export function NewPinPopover({
  at,
  projection,
  onCreate,
  onCancel,
}: {
  at: Fraction
  projection: Projection
  onCreate: (type: string, name?: string) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const formRef = useRef<HTMLFormElement>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  useModalFocusTrap(true, formRef, onCancel)
  const { size, project } = projection
  const anchor = project(at)
  const left = Math.max(8, Math.min(anchor.x - WIDTH / 2, size.width - WIDTH - 8))
  const below = anchor.y + GAP + HEIGHT <= size.height
  const top = Math.max(8, below ? anchor.y + GAP : anchor.y - 36 - HEIGHT)

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onCreate(OTHER_PIN, trimmed)
  }

  return (
    <form
      ref={formRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('pin.whatDidYouFind')}
      data-overlay-open="true"
      tabIndex={-1}
      onSubmit={submit}
      style={{
        left: `clamp(calc(8px + env(safe-area-inset-left, 0px)), ${Math.round(left)}px, calc(100% - ${WIDTH}px - 8px - env(safe-area-inset-right, 0px)))`,
        top: `clamp(calc(8px + env(safe-area-inset-top, 0px)), ${Math.round(top)}px, calc(100% - ${HEIGHT}px - 8px - env(safe-area-inset-bottom, 0px)))`,
        width: WIDTH,
        maxWidth: 'calc(100% - 16px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))',
      }}
      className="pointer-events-auto absolute z-40 rounded-lg border border-parchment-600 bg-ink-900 p-3 shadow-xl shadow-black/50"
    >
      {naming ? (
        <label className="block text-xs font-medium text-parchment-400">
          {t('pin.pinName')}
          <input
            autoFocus
            value={name}
            maxLength={80}
            placeholder={t('pin.pinName')}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-ink-600 bg-ink-950 px-2 py-1.5 text-sm text-parchment-50 outline-none focus:border-parchment-400"
          />
        </label>
      ) : (
        <>
          <p className="mb-1.5 text-xs font-medium text-parchment-400">{t('pin.whatDidYouFind')}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {PIN_TYPES.map(({ key, label }, index) => (
              <TypeTile
                key={key}
                type={key}
                label={PIN_TYPE_KEYS.has(key) ? t(`pin.type.${key}` as TranslationKey) : label}
                autoFocus={index === 0}
                onPick={() => (key === OTHER_PIN ? setNaming(true) : onCreate(key))}
              />
            ))}
          </div>
        </>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-2.5 py-1 text-xs text-parchment-400 hover:text-parchment-50">
          {t('common.cancel')}
        </button>
        {naming && (
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded bg-parchment-200 px-2.5 py-1 text-xs font-medium text-ink-950 hover:bg-parchment-50 disabled:opacity-40"
          >
            {t('pin.addPin')}
          </button>
        )}
      </div>
    </form>
  )
}
