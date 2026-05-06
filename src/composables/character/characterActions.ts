import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { AbilityItemPF2e, MartialProficiency, ClassDCData } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import type { RequestResolutionArgs } from '@/types/api-types'
import { type Stat, makeStat } from './stat'
import { type Modifier, makeModifiers } from './modifier'
import type { Maybe } from './helpers'
import { type Item, type ItemSystem, makeItem } from './item'
// import { type Strike, type ElementalBlast, makeStrike, makeElementalBlasts } from './strike'
import { useApi } from '../api'
import { actionTypes } from '@/utils/constants'
import { kebabCase } from 'lodash-es'

export interface Action extends Item {
  system: ItemSystem & { actions?: { value: Maybe<string> } }
  actionType: string | null
  item: Item
  macroId: Maybe<string>
  doAction?: (
    options?: object | undefined,
    rollResult?: number | undefined
  ) => Promise<RequestResolutionArgs | null>
  doMacro?: (options?: object | undefined) => void
}

export interface CharacterActions {
  doCharacterAction: (
    slug: string,
    options?: object | undefined,
    rollResult?: number | undefined
  ) => Promise<RequestResolutionArgs | null>
  actions: Field<Action[]>
  skills: Field<Stat[]>
  proficiencies: Field<Stat[]>
  initiative: {
    stat: WritableField<string>
    modifiers: Field<Modifier[]>
    totalModifier: Field<number>
    roll: (result?: number | undefined) => Promise<RequestResolutionArgs | null>
  }
}

export function useCharacterActions(actor: Ref<Actor | undefined>): CharacterActions {
  const { characterAction, rollCheck, updateActor, callMacro } = useApi()

  // TODO: is this separate method necessary?
  const doCharacterAction = (
    slug: string,
    options: object | undefined = {},
    rollResult: number | undefined = undefined
  ) => {
    return characterAction(actor as Ref<Actor>, slug, options ?? {}, { d20: [rollResult ?? 0] })
  }
  const actions = computed(() =>
    (actor.value?.items as unknown as AbilityItemPF2e[])
      ?.filter((i) => actionTypes.map((a) => a.type).includes(i?.system?.actionType?.value))
      .map((i) => ({
        ...(makeItem(i) as Action),
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
        doAction: (options = {}, rollResult: number | undefined = undefined) => {
          if (i?.system?.slug)
            return characterAction(actor as Ref<Actor>, i?.system?.slug, options ?? {}, {
              d20: [rollResult ?? 0]
            })
          else return Promise.resolve(null)
        },
        doMacro: (options = {}) => {
          const macroId = (
            i?.flags as Record<string, { actionable?: { macro?: string } } | undefined>
          )?.['pf2e-toolbelt']?.actionable?.macro
          if (macroId) {
            callMacro(actor.value?._id, null, null, macroId, options)
          }
        }
      }))
  )
  const skills = computed(() => {
    const skills = Object.entries(actor.value?.system?.skills ?? [])?.map(
      ([key, skill]) =>
        ({
          ...makeStat(skill, key),
          roll: (result, options = {}) =>
            rollCheck(
              actor as Ref<Actor>,
              'skill',
              skill.slug,
              { d20: [result ?? 0] },
              [],
              options ?? {}
            )
        }) as Stat
    )
    const lores = actor.value?.items
      .filter((i) => i.type === 'lore')
      .map((lore) => ({
        ...({
          slug: kebabCase(lore.name),
          label: lore.name,
          lore: true,
          rank: lore.system.proficient.value
        } as Stat)
      }))
    return skills.length === 16 && lores?.length ? [...skills, ...(lores ?? [])] : skills
  })
  const proficiencies = computed(() => [
    ...Object.entries(
      (actor.value?.system?.proficiencies?.['attacks'] ?? []) as Record<string, MartialProficiency>
    ).map(([key, stat]) => ({ ...makeStat(stat, key), type: 'attacks', slug: key }) as Stat),
    ...Object.entries(
      (actor.value?.system?.proficiencies?.['defenses'] ?? []) as Record<string, MartialProficiency>
    ).map(([key, stat]) => ({ ...makeStat(stat, key), type: 'defenses', slug: key }) as Stat),
    ...Object.entries(
      (actor.value?.system?.proficiencies?.['classDCs'] ?? []) as Record<string, ClassDCData>
    ).map(([key, stat]) => ({ ...makeStat(stat, key), type: 'classDCs', slug: key }) as Stat),
    ...[
      {
        ...(makeStat(actor.value?.system?.proficiencies?.['spellcasting']) as Stat),
        value: actor.value?.system?.attributes?.classOrSpellDC?.value,
        type: 'spellcasting',
        slug: 'Spell DC',
        label: 'Spell DC'
      }
    ]
  ])
  const initiative = {
    stat: computed({
      get: () => actor.value?.system?.initiative?.statistic,
      set: (newValue) => {
        actor.value!.system.initiative.statistic = newValue
        const update = { system: { initiative: { statistic: newValue } } }
        updateActor(actor, update)
      }
    }),
    modifiers: computed(() => makeModifiers(actor.value?.system?.initiative?.modifiers)),
    totalModifier: computed(() => actor.value?.system?.initiative?.totalModifier),
    roll: (result: number | undefined) => {
      return rollCheck(actor as Ref<Actor>, 'initiative', '', { d20: [result ?? 0] })
    }
  }

  return {
    doCharacterAction,
    actions,
    skills,
    proficiencies,
    initiative
  }
}
