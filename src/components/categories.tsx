import { Bean, CircleHelp, Heart, HeartPlus, KeyRound, Lightbulb, Milk, Skull, Sparkles, type LucideIcon } from 'lucide-react'

type Style = { icon: LucideIcon; color: string }

const styles: Record<string, Style> = {
  gs: { icon: Skull, color: '#e8c04a' },
  heart: { icon: Heart, color: '#ec6a7a' },
  container: { icon: HeartPlus, color: '#f2404f' },
  bean: { icon: Bean, color: '#9ccb5c' },
  fairy: { icon: Sparkles, color: '#e58fe0' },
  bottle: { icon: Milk, color: '#7fd0e6' },
  key: { icon: KeyRound, color: '#f0a14a' },
  thought: { icon: Lightbulb, color: '#a9a4f5' },
}

const fallback: Style = { icon: CircleHelp, color: '#c4ad7f' }

export function categoryStyle(key: string): Style {
  return styles[key] ?? fallback
}
