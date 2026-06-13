import { computed, type Ref } from 'vue'
import type {
  AbilityItemPF2e,
  AbstractEffectPF2e,
  CharacterPF2e,
  ConditionPF2e,
  SaveType
} from '@7h3laughingman/pf2e-types'
import type { TablemateFamiliar } from '@/types/character-types'
import type { Field, WritableField } from '@/composables/character/helpers'
import type { Action } from '@/composables/character/defs/action'
import { makeAction } from '@/composables/character/defs/action'
import type { EffectItem } from '@/composables/character/characterItems'
import { makeCondition } from '@/composables/character/defs/condition'
import { makeEffect } from '@/composables/character/defs/effect'
import type { Stat } from '@/composables/character/defs/stat'
import { makeStat } from '@/composables/character/defs/stat'
import type { Modifier } from '@/composables/character/defs/modifier'
import { makeModifiers } from '@/composables/character/defs/modifier'
import { updateActor, deleteActorItem, updateActorItem } from '@/api/documents'
import { rollCheck, rollDamage } from '@/api/actionRpc'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'

type FamiliarHp = {
  value?: number
  max?: number
  temp?: number
  modifiers?: unknown[]
}

type FamiliarMovement = {
  speeds?: Record<string, unknown>
}
type FamiliarActionItem = AbilityItemPF2e<CharacterPF2e> & {
  system?: {
    actionType?: { value?: string | null }
    actions?: { value?: number | null }
    traits?: { value?: string[] }
  }
}
type StatInput = Parameters<typeof makeStat>[0]

export interface Familiar {
  _actor: Ref<TablemateFamiliar | undefined>
  _id: Field<string>
  type: Field<string>
  name: Field<string>
  portraitUrl: Field<string>
  portraitScaleX: Field<number>
  portraitScaleY: Field<number>
  masterId: Field<string>
  masterAbility: Field<string>
  creature: Field<string>
  hp: {
    current: WritableField<number>
    max: Field<number>
    temp: WritableField<number>
    modifiers: Field<Modifier[]>
  }
  heroPoints: {
    current: WritableField<number>
    max: Field<number>
  }
  ac: {
    current: Field<number>
    modifiers: Field<Modifier[]>
  }
  movement: {
    land: Field<Stat>
    swim: Field<Stat>
    climb: Field<Stat>
    fly: Field<Stat>
    burrow: Field<Stat>
  }
  actions: Field<Action[]>
  effects: Field<EffectItem[]>
  rollOptionLabels: Field<Record<string, string>>
  saves: {
    fortitude: Field<Stat>
    reflex: Field<Stat>
    will: Field<Stat>
  }
  perception: Field<Stat>
  attack: Field<Stat>
  skills: Field<Stat[]>
  proficiencies: Field<Stat[]>
  doCharacterAction: () => Promise<RequestResolutionArgs | null>
  doDamage: (
    formula: string,
    opts?: {
      secret?: boolean
      diceResults?: DiceResults
      itemId?: string
      damageInline?: Record<string, string | true>
    }
  ) => Promise<RequestResolutionArgs | null>
  doFlatCheck: () => Promise<RequestResolutionArgs | null>
}

export function useFamiliar(actor: Ref<TablemateFamiliar | undefined>) {
  const makeSave = (subtype: SaveType) =>
    computed(() => ({
      ...(makeStat(actor.value?.system?.saves?.[subtype]) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(
          actor as unknown as Ref<CharacterPF2e>,
          'save',
          subtype,
          { d20: [result ?? 0] },
          [],
          options ?? {}
        )
    }))

  const familiar: Familiar = {
    _actor: actor,
    _id: computed(() => actor.value?._id ?? undefined),
    type: computed(() => actor.value?.type ?? undefined),
    name: computed(() => actor.value?.name),
    portraitUrl: computed(
      () => actor.value?.prototypeToken?.texture?.src ?? actor.value?.img ?? undefined
    ),
    portraitScaleX: computed(() => actor.value?.prototypeToken?.texture?.scaleX ?? 1),
    portraitScaleY: computed(() => actor.value?.prototypeToken?.texture?.scaleY ?? 1),
    masterId: computed(() => actor.value?.system?.master?.id ?? undefined),
    masterAbility: computed(() => actor.value?.system?.master?.ability ?? undefined),
    creature: computed(() => actor.value?.system?.details?.creature?.value),
    hp: {
      current: computed({
        get: () => (actor.value?.system?.attributes?.hp as FamiliarHp | undefined)?.value,
        set: (newValue) => {
          if (!actor.value || newValue === undefined) return
          actor.value.system.attributes.hp.value = newValue
          void updateActor(actor as unknown as Ref<CharacterPF2e>, {
            system: { attributes: { hp: { value: newValue } } }
          })
        }
      }),
      max: computed(() => (actor.value?.system?.attributes?.hp as FamiliarHp | undefined)?.max),
      temp: computed({
        get: () => (actor.value?.system?.attributes?.hp as FamiliarHp | undefined)?.temp,
        set: (newValue) => {
          if (!actor.value || newValue === undefined) return
          actor.value.system.attributes.hp.temp = newValue
          void updateActor(actor as unknown as Ref<CharacterPF2e>, {
            system: { attributes: { hp: { temp: newValue } } }
          })
        }
      }),
      modifiers: computed(() => [])
    },
    heroPoints: {
      current: computed({
        get: () => undefined,
        set: () => {}
      }),
      max: computed(() => undefined)
    },
    ac: {
      current: computed(() => actor.value?.system?.attributes?.ac?.value),
      modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.ac?.modifiers))
    },
    movement: {
      land: computed(() =>
        makeStat(
          (actor.value?.system?.movement as FamiliarMovement | undefined)?.speeds?.land as StatInput
        )
      ),
      swim: computed(() =>
        makeStat(
          (actor.value?.system?.movement as FamiliarMovement | undefined)?.speeds?.swim as StatInput
        )
      ),
      climb: computed(() =>
        makeStat(
          (actor.value?.system?.movement as FamiliarMovement | undefined)?.speeds
            ?.climb as StatInput
        )
      ),
      fly: computed(() =>
        makeStat(
          (actor.value?.system?.movement as FamiliarMovement | undefined)?.speeds?.fly as StatInput
        )
      ),
      burrow: computed(() =>
        makeStat(
          (actor.value?.system?.movement as FamiliarMovement | undefined)?.speeds
            ?.burrow as StatInput
        )
      )
    },
    actions: computed(() =>
      actor.value?.items
        ?.filter((i) => i.type === 'action')
        .map((i) => {
          const item = i as unknown as FamiliarActionItem
          const base = makeAction(item)
          const typeValue = item.system?.actionType?.value
          return {
            ...base,
            actionType:
              typeValue !== 'action'
                ? (typeValue ?? null)
                : item.system?.traits?.value?.includes('skill')
                  ? 'skill'
                  : 'action'
          }
        })
    ),
    effects: computed(() =>
      actor.value?.items
        ?.filter((i) => ['effect', 'condition'].includes(i?.type ?? ''))
        .map((i) => {
          const item = i as unknown as AbstractEffectPF2e<CharacterPF2e>
          const base =
            i.type === 'condition'
              ? makeCondition(i as unknown as ConditionPF2e<CharacterPF2e>)
              : makeEffect(item)
          return {
            ...base,
            delete: () => deleteActorItem(actor as unknown as Ref<CharacterPF2e>, i._id!),
            changeQty: (newValue: number) => {
              const update = { system: { value: { value: newValue } } }
              return updateActorItem(actor as unknown as Ref<CharacterPF2e>, i._id!, update)
            }
          }
        })
    ),
    rollOptionLabels: computed(() => actor.value?.rollOptionLabels),
    saves: {
      fortitude: makeSave('fortitude'),
      reflex: makeSave('reflex'),
      will: makeSave('will')
    },
    perception: computed(() => ({
      ...(makeStat(actor.value?.system?.perception) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(
          actor as unknown as Ref<CharacterPF2e>,
          'perception',
          '',
          { d20: [result ?? 0] },
          [],
          options ?? {}
        )
    })),
    attack: computed(() => {
      const stat = makeStat(
        (actor.value?.system as { attack?: StatInput } | undefined)?.attack,
        'attack'
      )
      if (!stat) return undefined
      return {
        ...stat,
        roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
          rollCheck(
            actor as unknown as Ref<CharacterPF2e>,
            'familiarAttack',
            '',
            { d20: [result ?? 0] },
            [],
            options ?? {}
          )
      } as Stat
    }),
    skills: computed(() =>
      Object.entries(actor.value?.system?.skills ?? {}).map(([key, skill]) => {
        const stat = makeStat(skill as StatInput, key)
        return {
          ...stat,
          rank: stat?.rank ?? 0,
          roll: (result, options = {}) =>
            rollCheck(
              actor as unknown as Ref<CharacterPF2e>,
              'skill',
              key,
              { d20: [result ?? 0] },
              [],
              options ?? {}
            )
        } as Stat
      })
    ),
    proficiencies: computed(() => []),
    doCharacterAction: () => Promise.resolve(null),
    doDamage: (
      formula: string,
      opts: {
        secret?: boolean
        diceResults?: DiceResults
        itemId?: string
        damageInline?: Record<string, string | true>
      } = {}
    ) => rollDamage(actor as unknown as Ref<CharacterPF2e>, formula, opts),
    doFlatCheck: () => Promise.resolve(null)
  }

  return { familiar }
}
