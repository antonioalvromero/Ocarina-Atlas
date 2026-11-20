import { ExternalLink, Info, ShieldCheck, X } from 'lucide-react'
import { useRef } from 'react'
import { useI18n } from '../lib/i18n'
import { useModalFocusTrap } from '../lib/useModalFocusTrap'

export const OFFICIAL_GITHUB_URL = 'https://github.com/antonioalvromero/Ocarina-Atlas'
export const ORIGINAL_MAP_GITHUB_URL = 'https://github.com/lucasriondel/oot-remake-map'

export type CreditsModalProps = {
  open: boolean
  onClose: () => void
}

function CreditsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)

  useModalFocusTrap(true, dialogRef, onClose)

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
        aria-labelledby="credits-modal-title"
        data-overlay-open="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[min(88dvh,640px)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-[#e8c04a]/40 bg-ink-900 text-parchment-200 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink-700 px-5 py-4">
          <div className="flex items-center gap-2">
            <Info size={16} className="shrink-0 text-[#e8c04a]" aria-hidden />
            <h2 id="credits-modal-title" className="font-serif text-lg text-parchment-50">
              {t('credits.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('credits.close')}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-ink-700 bg-ink-800/80 text-parchment-200 transition-colors hover:border-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="hyrule-scrollbar flex-1 space-y-3 overflow-y-auto px-5 py-4 text-xs leading-relaxed">
          <section className="rounded-lg border border-ink-700 bg-ink-950/70 p-3.5">
            <h3 className="font-serif text-sm font-medium text-parchment-50">
              {t('credits.atlasAuthor')}
            </h3>
            <p className="mt-1 text-parchment-200">{t('credits.atlasAuthorDesc')}</p>
            <a
              href={OFFICIAL_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 font-medium text-[#f3d473] hover:underline"
            >
              <span>antonioalvromero/Ocarina-Atlas</span>
              <ExternalLink size={12} aria-hidden />
            </a>
          </section>

          <section className="rounded-lg border border-ink-700 bg-ink-950/70 p-3.5">
            <h3 className="font-serif text-sm font-medium text-parchment-50">
              {t('credits.originalMap')}
            </h3>
            <p className="mt-1 text-parchment-200">{t('credits.originalMapDesc')}</p>
            <a
              href={ORIGINAL_MAP_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 font-medium text-parchment-200 hover:text-parchment-50 hover:underline"
            >
              <span>lucasriondel/oot-remake-map</span>
              <ExternalLink size={12} aria-hidden />
            </a>
          </section>

          <section className="rounded-lg border border-ink-700 bg-ink-950/60 p-3.5 text-parchment-400">
            <p>{t('credits.mapArtwork')}</p>
          </section>

          <section className="rounded-lg border border-[#e8c04a]/40 bg-[#e8c04a]/10 p-3.5">
            <div className="flex items-start gap-2">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#e8c04a]" aria-hidden />
              <div className="min-w-0 space-y-1.5">
                <a
                  href={OFFICIAL_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-[#f3d473] hover:underline"
                >
                  <span>{t('credits.officialGithub')}</span>
                  <ExternalLink size={12} aria-hidden />
                </a>
                <p className="text-parchment-200">{t('credits.officialNotice')}</p>
              </div>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-ink-700 bg-ink-950/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md bg-parchment-200 px-3.5 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-parchment-50"
          >
            {t('credits.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CreditsModal({ open, onClose }: CreditsModalProps) {
  if (!open) return null
  return <CreditsDialog onClose={onClose} />
}
