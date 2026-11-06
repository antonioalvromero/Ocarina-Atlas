import { Moon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { categoryName, requirementLabel } from '../lib/data'
import type { Item } from '../lib/types'
import { RichText } from './RichText'

const ageLabels: Record<string, string> = {
  child: 'Child',
  adult: 'Adult',
  both: 'Child or adult',
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] text-parchment-200">
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

export function ItemDetail({ item }: { item: Item }) {
  return (
    <div className="space-y-3 px-2 pt-1 pb-3 text-sm leading-relaxed text-parchment-200">
      <div className="flex flex-wrap gap-1">
        <Chip>{categoryName(item.cat)}</Chip>
        {item.age && <Chip>{ageLabels[item.age] ?? item.age}</Chip>}
        {item.night && (
          <Chip>
            <Moon size={11} /> Night only
          </Chip>
        )}
      </div>
      <RichText text={item.desc} />
      {item.hint && (
        <div className="rounded-md border-l-2 border-parchment-400 bg-ink-800 px-3 py-2">
          <p className="text-[11px] font-medium tracking-wide text-parchment-400 uppercase">Hint</p>
          <RichText text={item.hint} />
        </div>
      )}
      {item.requires.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-parchment-400 uppercase">Requires</p>
          <ul className="flex flex-wrap gap-1">
            {item.requires.map((requirement, index) => (
              <li key={index}>
                <Chip>{requirementLabel(requirement)}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.images.map((src, index) => (
        <Photo key={src} src={src} alt={`${item.name}, image ${index + 1}`} />
      ))}
    </div>
  )
}
