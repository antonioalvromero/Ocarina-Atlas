import { ChevronDown, Languages } from 'lucide-react'
import { isLocale, LOCALE_OPTIONS, useI18n } from '../lib/i18n'

export type LanguageSelectorProps = {
  className?: string
}

export function LanguageSelector({ className = '' }: LanguageSelectorProps) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      className={`pointer-events-auto relative inline-flex items-center rounded-md border border-ink-600 bg-ink-800/90 text-xs font-medium text-parchment-50 transition-colors focus-within:border-[#e8c04a] focus-within:ring-1 focus-within:ring-[#e8c04a]/40 hover:border-[#e8c04a]/60 hover:bg-ink-700 ${className}`}
    >
      <span className="pointer-events-none inline-flex items-center gap-1 px-2 py-1">
        <Languages size={13} className="text-[#e8c04a]" aria-hidden />
        <span className="tracking-wide uppercase">{locale}</span>
        <ChevronDown size={11} className="text-parchment-400" aria-hidden />
      </span>
      <select
        aria-label={t('common.language')}
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) {
            setLocale(event.target.value)
          }
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code} className="bg-ink-900 text-parchment-50">
            {option.code.toUpperCase()} — {option.nativeLabel}
          </option>
        ))}
      </select>
    </div>
  )
}
