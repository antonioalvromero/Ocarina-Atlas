import { Link } from '@tanstack/react-router'
import { useI18n } from '../lib/i18n'

export function NotFound() {
  const { t } = useI18n()
  return (
    <main className="grid h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="font-serif text-3xl text-parchment-50">{t('notFound.title')}</h1>
        <p className="mt-2 text-parchment-400">{t('notFound.description')}</p>
        <Link to="/" className="mt-5 inline-block rounded-md bg-parchment-200 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-parchment-50">
          {t('notFound.backToMap')}
        </Link>
      </div>
    </main>
  )
}
