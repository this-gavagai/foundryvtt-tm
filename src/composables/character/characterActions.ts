import { computed, type Ref } from 'vue'
import type { CharacterPF2e, AbilityItemPF2e } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import type { RequestResolutionArgs } from '@/types/api-types'
import { type Modifier, makeModifiers } from './defs/modifier'
import { type Action, makeAction } from './defs/action'
import { useApi } from '../api'
import { actionTypes } from '@/utils/constants'

export interface CharacterActions {
  doCharacterAction: (
    slug: string,
    options?: object | undefined,
    rollResult?: number | undefined
  ) => Promise<RequestResolutionArgs | null>
  actions: Field<Action[]>
  initiative: {
    stat: WritableField<string>
    modifiers: Field<Modifier[]>
    totalModifier: Field<number>
    roll: (result?: number | undefined) => Promise<RequestResolutionArgs | null>
  }
}

export function useCharacterActions(actor: Ref<CharacterPF2e | undefined>): CharacterActions {
  const { characterAction, rollCheck, updateActor, callMacro } = useApi()

  // TODO: is this separate method necessary?
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
      ?.filter((i): i is AbilityItemPF2e<CharacterPF2e> => i.type === 'action')
      .filter((i) => actionTypes.map((a) => a.type).includes(i.system?.actionType?.value))
      .map((i) => ({
        ...(makeAction(i) as Action),
        actionType:
          i?.system?.actionType?.value === 'action' &&
          i?.system?.traits.value.includes('skill') === false
            ? 'action'
            : i?.system?.actionType?.value === 'action' &&
                i?.system?.traits.value.includes('skill') === true
              ? 'skill'
              : i?.system?.actionType?.value === 'reaction'
                ? 'reaction'
                : i?.system?.actionType?.value === 'free'
                  ? 'free'
                  : null,
        macroId: (i?.flags as Record<string, { actionable?: { macro?: string } } | undefined>)?.[
          'pf2e-toolbelt'
        ]?.actionable?.macro,
        doMacro: (options = {}) => {
          const macroId = (
            i?.flags as Record<string, { actionable?: { macro?: string } } | undefined>
          )?.['pf2e-toolbelt']?.actionable?.macro
          if (macroId) {
            callMacro(actor.value?._id ?? undefined, null, null, macroId, options)
          }
        }
      }))
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
    roll: (result: number | undefined) => {
      return rollCheck(actor as Ref<CharacterPF2e>, 'initiative', '', { d20: [result ?? 0] })
    }
  }

  return {
    doCharacterAction,
    actions,
    initiative
  }
}
