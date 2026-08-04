import type { Maybe } from '@/composables/character/helpers'
import type { SpellPF2e, SpellcastingEntryPF2e } from '@7h3laughingman/pf2e-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Modifier } from './modifier'

export interface Spell extends Item {
  system: SpellSystem
  doSpell?: (
    rank: number | undefined,
    slot: number | undefined
  ) => Promise<RequestResolutionArgs | null>
  doSpellAttack?: (
    attackNumber: 1 | 2 | 3,
    result?: number,
    modifierOverrides?: Record<string, boolean>
  ) => Promise<RequestResolutionArgs | null>
  doSpellDamage?: (
    mapIncreases?: 0 | 1 | 2,
    castingRank?: number,
    result?: import('@/types/api-types').DiceResults,
    modifierOverrides?: Record<string, boolean>
  ) => Promise<RequestResolutionArgs | null>
  getDamage?: (
    castingRank?: number,
    modifierOverrides?: Record<string, boolean>
  ) => Promise<RequestResolutionArgs | null>
}
export interface SpellSystem extends ItemSystem {
  location: {
    value: Maybe<string>
    heightenedLevel: Maybe<number>
    // A per-spell override of the entry's auto-heighten rank, for cantrips and
    // focus spells (which scale with caster level rather than being heightened
    // into a slot). See makeSpellRankResolver.
    autoHeightenLevel: Maybe<number>
    signature: Maybe<boolean>
  }
  range: Maybe<string>
  target: Maybe<string>
  area: { type: Maybe<string>; value: Maybe<number> }
  defense: { save: { basic: Maybe<boolean>; statistic: Maybe<string> } }
  time: { value: Maybe<string> }
  hasDamage: boolean
}

export interface SpellcastingEntry extends Item {
  system: SpellcastingEntrySystem
  spellAttackModifier?: Maybe<number>
  spellAttackModifiers?: Modifier[]
  // The entry statistic's prepared save DC. Only differs from the stored
  // `system.spelldc.dc` for an elite/weak-adjusted NPC, so consumers fall back
  // to the stored value when this is absent.
  preparedDc?: Maybe<number>
  doSpellAttack?: (
    result?: number,
    modifierOverrides?: Record<string, boolean>
  ) => Promise<RequestResolutionArgs>
  setPrepared?: (
    rank: number | undefined,
    slot: number | undefined,
    newSpellId: string | null,
    newTotal?: boolean | undefined
  ) => Promise<DocumentSocketResponse | null>
  setSlotCount?: (rank: number, newValue: number) => Promise<DocumentSocketResponse>
}
export interface SpellcastingEntrySystem extends ItemSystem {
  spelldc: { dc: Maybe<number> }
  tradition: { value: Maybe<string> }
  prepared: { value: Maybe<string>; flexible: Maybe<boolean> }
  // The rank this entry's auto-scaling spells (cantrips, focus spells) heighten
  // to. Null on most entries, which fall back to half the caster's level.
  autoHeightenLevel: { value: Maybe<number> }
  slots: {
    [key: string]: {
      value: Maybe<number>
      max: Maybe<number>
      prepared: { id: Maybe<string | null>; expended: Maybe<boolean> }[]
    }
  }
}

type PreparedSlot = SpellcastingEntrySystem['slots'][string]['prepared'][number]

function normalizePreparedSlot(prepared: unknown): PreparedSlot[] {
  if (Array.isArray(prepared)) return prepared as PreparedSlot[]
  if (prepared && typeof prepared === 'object') return Object.values(prepared) as PreparedSlot[]
  return []
}

export function makeSpell(root: SpellPF2e): Spell {
  const base = makeItem(root)!
  return {
    ...base,
    system: {
      ...base.system,
      actions: { value: root.system.time?.value },
      location: {
        value: root.system.location?.value ?? undefined,
        signature: root.system.location?.signature,
        heightenedLevel: root.system.location?.heightenedLevel,
        autoHeightenLevel: root.system.location?.autoHeightenLevel ?? undefined
      },
      range: root.system.range?.value,
      target: root.system.target?.value,
      area: {
        type: root.system.area?.type ?? undefined,
        value: root.system.area?.value ?? undefined
      },
      defense: {
        save: {
          basic: root.system.defense?.save?.basic ?? undefined,
          statistic: root.system.defense?.save?.statistic ?? undefined
        }
      },
      time: { value: root.system.time?.value },
      hasDamage: Object.keys(root.system.damage ?? {}).length > 0
    }
  } as Spell
}

export function makeSpellcastingEntry(root: SpellcastingEntryPF2e): SpellcastingEntry {
  const base = makeItem(root)!
  const slots = Object.entries(root.system.slots ?? {}).reduce(
    (acc, [key, slot]) => {
      acc[key] = {
        value: slot.value,
        max: slot.max,
        prepared: normalizePreparedSlot(slot.prepared)
      }
      return acc
    },
    {} as SpellcastingEntrySystem['slots']
  )
  return {
    ...base,
    system: {
      ...base.system,
      spelldc: { dc: root.system.spelldc?.dc },
      // Drives the per-tradition section accent on both spell lists. It was
      // declared but never copied, so every entry fell back to the 'arcane'
      // accent and the occult/primal/divine colors were unreachable.
      tradition: { value: root.system.tradition?.value ?? undefined },
      prepared: {
        value: root.system.prepared?.value,
        flexible: root.system.prepared?.flexible
      },
      autoHeightenLevel: { value: root.system.autoHeightenLevel?.value ?? undefined },
      slots
    }
  } as SpellcastingEntry
}
