import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { Field, Maybe } from './helpers'
import { type Spell, type SpellcastingEntry, makeSpell, makeSpellcastingEntry } from './defs/spell'
import { type Consumable, makeConsumable } from './defs/consumable'
import { castSpell, consumeItem } from '@/composables/api/actions'
import { updateActor, updateActorItem } from '@/composables/api/documents'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type {
  ConsumablePF2e,
  SpellPF2e,
  SpellcastingEntryPF2e,
  SlotKey
} from '@7h3laughingman/pf2e-types'

export type { Spell, SpellcastingEntry }

type StaffData = {
  spells?: SpellPF2e[]
  staffId?: string
  charges?: { value?: number; max?: number }
  expended?: boolean
}
type PF2eDailiesFlags = { extra?: { staffData?: StaffData } } | undefined

export interface Staff {
  staffId: Maybe<string>
  charges: {
    value: Maybe<number>
    max: Maybe<number>
  }
  spells: Spell[]
  expended: Maybe<boolean>
  setStaffCharges?: (newValue: number) => Promise<DocumentSocketResponse | null>
}

export interface CharacterSpells {
  spellcastingEntries: Field<SpellcastingEntry[]>
  spells: Field<Spell[]>
  staff: Field<Staff>
  spellConsumables: Field<Consumable[]>
}

export function useCharacterSpells(actor: Ref<CharacterPF2e | undefined>): CharacterSpells {

  const spellcastingEntries = computed(() =>
    actor.value?.items
      ?.filter((i): i is SpellcastingEntryPF2e<CharacterPF2e> => i?.type === 'spellcastingEntry')
      ?.map((item) => ({
        ...makeSpellcastingEntry(item),
        setPrepared: (
          rank: number | undefined,
          slot: number | undefined,
          newSpellId: string | null,
          expended: boolean = false
        ) => {
          const prepared = item.system.slots[('slot' + rank) as SlotKey]?.prepared
          if (!prepared || !rank || !slot) return Promise.resolve(null)
          if (!prepared[slot]) prepared[slot] = { id: null, expended: true }
          prepared[slot].id = newSpellId
          prepared[slot].expended = expended
          const update = { system: { slots: { ['slot' + rank]: { prepared: prepared } } } }
          return updateActorItem(actor as Ref<CharacterPF2e>, item._id!, update)
        },
        setSlotCount: (rank: number, newValue: number) => {
          const update = { system: { slots: { ['slot' + rank]: { value: newValue } } } }
          return updateActorItem(actor as Ref<CharacterPF2e>, item._id!, update)
        }
      }))
  )

  const spells = computed(() => {
    const actorSpells = actor.value?.items
      ?.filter((i): i is SpellPF2e<CharacterPF2e> => i?.type === 'spell')
      ?.map((item) => ({
        ...makeSpell(item),
        doSpell: (rank: number | undefined, slot: number | undefined) => {
          if (rank === undefined || slot === undefined) return Promise.resolve(null)
          return castSpell(actor as Ref<CharacterPF2e>, item._id!, rank, slot)
        }
      }))

    const dailies = actor.value?.flags?.['pf2e-dailies'] as PF2eDailiesFlags
    const staffSpells = (dailies?.extra?.staffData?.spells ?? []).map((i) => ({
      ...makeSpell(i),
      doSpell: undefined
    }))

    return [...(actorSpells ?? []), ...staffSpells]
  })

  const spellConsumables = computed(() =>
    actor.value?.items
      ?.filter(
        (i): i is ConsumablePF2e<CharacterPF2e> =>
          i.type === 'consumable' &&
          !!(i.system?.traits.value?.includes('scroll') || i.system?.traits.value?.includes('wand'))
      )
      ?.map((i) => ({
        ...makeConsumable(i),
        consumeItem: () => consumeItem(actor as Ref<CharacterPF2e>, i._id!),
        changeUses: (newValue: number) => {
          const updates = { system: { uses: { value: newValue } } }
          return updateActorItem(actor as Ref<CharacterPF2e>, i._id!, updates)
        }
      }))
  )

  const staff = computed(() => {
    const staffData = (actor.value?.flags?.['pf2e-dailies'] as PF2eDailiesFlags)?.extra?.staffData
    return {
      staffId: staffData?.staffId,
      charges: {
        value: staffData?.charges?.value,
        max: staffData?.charges?.max
      },
      spells: (staffData?.spells ?? []).map((i) => makeSpell(i)),
      expended: staffData?.expended,
      setStaffCharges: (newValue: number) => {
        const update = {
          flags: { 'pf2e-dailies': { extra: { staffData: { charges: { value: newValue } } } } }
        }
        return updateActor(actor as Ref<CharacterPF2e>, update)
      }
    }
  })

  return {
    spellcastingEntries,
    spells,
    spellConsumables,
    staff
  }
}
