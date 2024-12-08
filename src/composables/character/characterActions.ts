import { computed, type Ref } from 'vue'
import type {
  Actor,
  Item as PF2eItem,
  Action as PF2eAction,
  Stat as PF2eStat
} from '@/types/pf2e-types'
import type { Field, WritableField } from './helpers'
import type { Roll } from '@/types/foundry-types'
import { type Stat, makeStat } from './stat'
import { type Modifier, makeModifiers } from './modifier'
import { type Item, makeItem } from './item'
import { type Strike, makeStrike } from './strike'
import { type ElementalBlast, makeElementalBlasts } from './elementalBlast'
import { useApi } from '../api'
import { actionDefs } from '@/utils/constants'

export interface Action extends Item {
  actionType: string | null
  item: Item
  doAction?: (options: object) => Promise<Roll> | null
}

export interface CharacterActions {
  actions: Field<Action[]>
  strikes: Field<Strike[]>
  blasts: Field<ElementalBlast[]>
  skills: Field<Stat[]>
  proficiencies: Field<Stat[]>
  initiative: {
    stat: WritableField<string>
    modifiers: Field<Modifier[]>
    roll: () => Promise<Roll> | null
  }
}

export function useCharacterActions(actor: Ref<Actor | undefined>) {
  const { characterAction, rollCheck, updateActor, getStrikeDamage } = useApi()
  return {
    actions: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) =>
          ['action', 'reaction', 'free'].includes(i?.system?.actionType?.value)
        )
        .map((i: PF2eItem) => ({
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
          doAction: (options: object) => {
            if (i?.system?.slug)
              return characterAction(
                actor as Ref<Actor>,
                actionDefs.get(i?.system?.slug)?.alias ?? i?.system?.slug,
                options ?? {}
              )
            else return null
          }
        }))
    ),
    strikes: computed(() =>
      actor.value?.system?.actions?.map((action: PF2eAction) => ({
        ...(makeStrike(
          action,
          actor.value?.items.find((i: PF2eItem) => i.system?.slug === action?.slug)
        ) as Strike),
        getDamage: () => {
          return getStrikeDamage(actor as Ref<Actor>, action.slug)
        },
        doStrike: (variant: number) =>
          rollCheck(actor as Ref<Actor>, 'strike', `${action.slug},${variant}`),
        doDamage: (crit: boolean) =>
          rollCheck(actor as Ref<Actor>, 'damage', `${action.slug},${crit ? 'critical' : 'damage'}`)
      }))
    ),
    blasts: computed(() =>
      (makeElementalBlasts(actor.value?.elementalBlasts) as ElementalBlast[])?.map(
        (blast: ElementalBlast) => ({
          ...blast,
          doBlast: (element: string, damageType: string, mapIncreases: number, isMelee: boolean) =>
            rollCheck(
              actor as Ref<Actor>,
              'blast',
              `${element},${damageType},${mapIncreases},${isMelee}`
            ),
          doBlastDamage: (element: string, damageType: string, outcome: string, isMelee: boolean) =>
            rollCheck(
              actor as Ref<Actor>,
              'blastDamage',
              `${element},${damageType},${outcome},${isMelee}`
            )
        })
      )
    ),
    skills: computed(() =>
      Object.values(actor.value?.system?.skills ?? {})?.map((skill: PF2eStat) => ({
        ...(makeStat(skill) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'skill', skill.slug)
      }))
    ),
    proficiencies: computed(() => [
      ...Object.entries((actor.value?.system?.proficiencies?.['attacks'] ?? []) as PF2eStat[]).map(
        ([key, stat]) => ({ ...makeStat(stat), type: 'attacks', slug: key }) as Stat
      ),
      ...Object.entries((actor.value?.system?.proficiencies?.['defenses'] ?? []) as PF2eStat[]).map(
        ([key, stat]) => ({ ...makeStat(stat), type: 'defenses', slug: key }) as Stat
      ),
      ...Object.entries((actor.value?.system?.proficiencies?.['classDCs'] ?? []) as PF2eStat[]).map(
        ([key, stat]) => ({ ...makeStat(stat), type: 'classDCs', slug: key }) as Stat
      ),
      ...[
        {
          ...(makeStat(actor.value?.system?.proficiencies?.['spellcasting']) as Stat),
          value: actor.value?.system?.attributes?.classOrSpellDC?.value,
          type: 'spellcasting',
          slug: 'Spell DC'
        }
      ]
    ]),
    initiative: {
      stat: computed({
        get: () => actor.value?.system?.initiative?.statistic,
        set: (newValue) => {
          actor.value!.system.initiative.statistic = newValue
          const update = { system: { initiative: { statistic: newValue } } }
          updateActor(actor, update)
        }
      }),
      modifiers: computed(() => makeModifiers(actor.value?.system.initiative.modifiers)),
      roll: () => {
        return rollCheck(actor as Ref<Actor>, 'initiative')
      }
    }
  }
}
