import { computed, type Ref } from 'vue'
import type { CharacterPF2e, AbilityItemPF2e, FeatPF2e } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'
import { type Modifier, makeModifiers } from './defs/modifier'
import { type Action, makeAction } from './defs/action'
import { characterAction, rollCheck, callMacro, rollFreeDamage } from '@/api/actions'
import { updateActor } from '@/api/documents'
import { actionTypes } from '@/utils/constants'

export interface CharacterActions {
  doCharacterAction: (
    slug: string,
    options?: object | undefined,
    rollResult?: number | undefined
  ) => Promise<RequestResolutionArgs | null>
  doFreeDamage: (
    formula: string,
    result?: DiceResults
  ) => Promise<RequestResolutionArgs | null>
  actions: Field<Action[]>
  initiative: {
    stat: WritableField<string>
    modifiers: Field<Modifier[]>
    totalModifier: Field<number>
    roll: (
      result?: number | undefined,
      options?: object | undefined
    ) => Promise<RequestResolutionArgs | null>
  }
}

export function useCharacterActions(actor: Ref<CharacterPF2e | undefined>): CharacterActions {
  const doCharacterAction = (
    slug: string,
    options: object | undefined = {},
    rollResult: number | undefined = undefined
  ) => {
    return characterAction(actor as Ref<CharacterPF2e>, slug, options ?? {}, {
      d20: [rollResult ?? 0]
    })
  }
  const actions = computed(() =>
    actor.value?.items
      // Include both ability items (type 'action') and actionable feats/features.
      // Many reactions/free actions (e.g. Counterspell) are stored as feats with a
      // non-passive actionType rather than as separate granted action items.
      ?.filter(
        (i): i is AbilityItemPF2e<CharacterPF2e> | FeatPF2e<CharacterPF2e> =>
          i.type === 'action' || i.type === 'feat'
      )
      .filter((i) => actionTypes.map((a) => a.type).includes(i.system?.actionType?.value))
      .map((i) => {
        const macroId = (
          i?.flags as Record<string, { actionable?: { macro?: string } } | undefined>
        )?.['pf2e-toolbelt']?.actionable?.macro
        const typeValue = i.system?.actionType?.value
        return {
          ...(makeAction(i as AbilityItemPF2e<CharacterPF2e>) as Action),
          actionType:
            typeValue !== 'action'
              ? (typeValue ?? null)
              : i.system?.traits.value.includes('skill')
                ? 'skill'
                : 'action',
          macroId,
          doMacro: (options = {}) => {
            if (macroId) callMacro(actor.value?._id ?? undefined, null, null, macroId, options)
          }
        }
      })
  )
  const initiative = {
    stat: computed({
      get: () => actor.value?.system?.initiative?.statistic,
      set: (newValue) => {
        actor.value!.system.initiative.statistic = newValue!
        const update = { system: { initiative: { statistic: newValue } } }
        updateActor(actor as Ref<CharacterPF2e>, update)
      }
    }),
    modifiers: computed(() => makeModifiers(actor.value?.system?.initiative?.modifiers)),
    totalModifier: computed(() => actor.value?.system?.initiative?.totalModifier),
    roll: (result: number | undefined, options: object | undefined = {}) => {
      return rollCheck(
        actor as Ref<CharacterPF2e>,
        'initiative',
        '',
        { d20: [result ?? 0] },
        [],
        options ?? {}
      )
    }
  }

  const doFreeDamage = (formula: string, result?: DiceResults) =>
    rollFreeDamage(actor as Ref<CharacterPF2e>, formula, result ?? {})

  return {
    doCharacterAction,
    doFreeDamage,
    actions,
    initiative
  }
}
