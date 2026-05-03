import type { Maybe } from './helpers'
import type { SpellPF2e, SpellcastingEntryPF2e } from '@7h3laughingman/pf2e-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'
import type { RequestResolutionArgs } from '@/types/api-types'

export interface Spell extends Omit<Item, 'system'> {
  system: SpellSystem
  doSpell?: (
    rank: number | undefined,
    slot: number | undefined
  ) => Promise<RequestResolutionArgs | null>
}
export interface SpellSystem extends ItemSystem {
  location: { value: Maybe<string>; heightenedLevel: Maybe<number>; signature: Maybe<boolean> }
  range: Maybe<string>
  target: Maybe<string>
  area: { type: Maybe<string>; value: Maybe<number> }
  defense: { save: { basic: Maybe<boolean>; statistic: Maybe<string> } }
  time: { value: Maybe<string> }
}

export interface SpellcastingEntry extends Omit<Item, 'system'> {
  system: SpellcastingEntrySystem
  setPrepared: (
    rank: number | undefined,
    slot: number | undefined,
    newSpellId: string | null,
    newTotal?: boolean | undefined
  ) => Promise<DocumentSocketResponse | null>
  setSlotCount?: (rank: number, newValue: number) => Promise<DocumentSocketResponse>
}
export interface SpellcastingEntrySystem extends ItemSystem {
  spelldc: { dc: Maybe<number> }
  prepared: { value: Maybe<string>; flexible: Maybe<boolean> }
  slots: {
    [key: string]: {
      value: Maybe<number>
      max: Maybe<number>
      prepared: { id: Maybe<string | null>; expended: Maybe<boolean> }[]
    }
  }
}

export function makeSpell(root: SpellPF2e): Spell {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    system: {
      ...base.system,
      actions: { value: root.system.time?.value },
      location: {
        value: root.system.location.value ?? undefined,
        signature: root.system.location.signature,
        heightenedLevel: root.system.location.heightenedLevel
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
      time: { value: root.system.time?.value }
    }
  } as Spell
}

export function makeSpellcastingEntry(
  root: SpellcastingEntryPF2e
): Omit<SpellcastingEntry, 'setPrepared' | 'setSlotCount'> {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  const slots = Object.entries(root.system.slots ?? {}).reduce(
    (acc, [key, slot]) => {
      acc[key] = {
        value: slot.value,
        max: slot.max,
        prepared: slot.prepared.map((p) => ({ id: p.id, expended: p.expended }))
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
      prepared: {
        value: root.system.prepared?.value,
        flexible: root.system.prepared?.flexible
      },
      slots
    }
  } as Omit<SpellcastingEntry, 'setPrepared' | 'setSlotCount'>
}
