import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'
import type { ChatRollDie, ChatRollSummary } from '@/utils/chatRollSummary'
import type { ChatRollRerollMode } from '@/types/api-types'

export const dieIcons: Record<number, string> = {
  4: d4Icon,
  6: d6Icon,
  8: d8Icon,
  10: d10Icon,
  12: d12Icon,
  20: d20Icon,
  100: d10Icon
}

export function rollKindLabel(roll: ChatRollSummary): string {
  if (roll.className === 'DamageRoll') return 'Damage'
  if (roll.className === 'CheckRoll') return 'Check'
  return roll.className?.replace(/Roll$/, '') || 'Roll'
}

export function rollDisplayText(value: string): string {
  return value.replace(/[{}]/g, '')
}

export function rollFormulaLabel(roll: ChatRollSummary): string {
  return roll.formula ? rollDisplayText(roll.formula) : ''
}

export function rollDieLabel(die: ChatRollDie): string {
  const results = die.results.length ? `: ${die.results.join(', ')}` : ''
  return `${rollDisplayText(die.formula)}${results}`
}

export function rollDieIcon(die: ChatRollDie): string {
  return dieIcons[die.faces ?? 0] ?? d20Icon
}

export function rollFlavorLabel(roll: ChatRollSummary): string {
  return roll.flavors.length ? ` [${roll.flavors.map(rollDisplayText).join(', ')}]` : ''
}

export function rerollLabelKey(mode: ChatRollRerollMode): string {
  switch (mode) {
    case 'hero-point':
      return 'chat.heroPointReroll'
    case 'keep-highest':
      return 'chat.rerollKeepHighest'
    case 'keep-lowest':
      return 'chat.rerollKeepLowest'
    case 'reroll':
    default:
      return 'chat.reroll'
  }
}
