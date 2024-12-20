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
import { type Strike, type ElementalBlast, makeStrike, makeElementalBlasts } from './strike'
import { useApi } from '../api'
import { actionDefs, actionTypes } from '@/utils/constants'
import { type Maybe } from './helpers'

export interface Action extends Item {
  actionType: string | null
  item: Item
  doAction?: (options: object) => Promise<Roll> | null
}

export interface CharacterActions {
  actions: Field<Action[]>
  strikes: Field<Strike[]>
  blasts: Field<ElementalBlast[]>
  blastActions: WritableField<string>
  skills: Field<Stat[]>
  proficiencies: Field<Stat[]>
  initiative: {
    stat: WritableField<string>
    modifiers: Field<Modifier[]>
    totalModifier: Field<number>
    roll: (result?: number | undefined) => Promise<Roll> | null
  }
}

export function useCharacterActions(actor: Ref<Actor | undefined>) {
  const { characterAction, rollCheck, updateActor, updateActorItem, getStrikeDamage } = useApi()
  return {
    actions: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) =>
          actionTypes.map((a) => a.type).includes(i?.system?.actionType?.value)
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
    strikes: computed(() => {
      return actor.value?.system?.actions?.map((action: PF2eAction) => ({
        ...(makeStrike(
          action,
          actor.value?.items.find((i: PF2eItem) => i.system?.slug === action?.slug)
        ) as Strike),
        getDamage: (altUsage: number | undefined = undefined) =>
          getStrikeDamage(actor as Ref<Actor>, action.slug, altUsage),
        doStrike: (
          variant: number,
          altUsage: number | undefined,
          blastOptions: undefined,
          result: number | undefined
        ) =>
          rollCheck(actor as Ref<Actor>, 'strike', `${action.slug},${variant},${altUsage ?? ''}`, {
            d20: [result ?? 0]
          }),
        doDamage: (variant: number, altUsage: number) =>
          rollCheck(
            actor as Ref<Actor>,
            'damage',
            `${action.slug},${variant ? 'critical' : 'damage'},${altUsage ?? ''}`
          ),
        setDamageType: (newType: string) => {
          const item = actor.value?.items.find((i: PF2eItem) => i._id === action?.item?._id)
          const adjustment = item?.system?.damage?.damageType === newType ? null : newType
          const update = item?.system?.traits?.value?.includes('modular')
            ? { system: { traits: { toggles: { modular: { selected: adjustment } } } } }
            : { system: { traits: { toggles: { versatile: { selected: adjustment } } } } }
          return updateActorItem(actor as Ref<Actor>, action?.item?._id ?? '', update)
        }
      }))
    }),
    blasts: computed(() =>
      makeElementalBlasts(actor.value?.elementalBlasts)?.map((blast: ElementalBlast) => ({
        ...blast,
        getDamage: (
          altUsage?: number | undefined,
          blastOptions?: { element: string; damageType: string; isMelee: boolean }
        ) =>
          getStrikeDamage(
            actor as Ref<Actor>,
            `blast:${blastOptions?.element},${blastOptions?.damageType},${blastOptions?.isMelee}`
          ),
        doStrike: (
          variant: number,
          altUsage: number | undefined,
          blastOptions: {
            element: Maybe<string>
            damageType: Maybe<string>
            isMelee: Maybe<boolean>
          } = {
            element: undefined,
            damageType: undefined,
            isMelee: undefined
          },
          result: number | undefined
        ) =>
          rollCheck(
            actor as Ref<Actor>,
            'blast',
            `${blastOptions.element},${blastOptions.damageType},${variant},${blastOptions.isMelee}`,
            { d20: [result ?? 0] }
          ),
        doDamage: (
          variant: number,
          altUsage: number | undefined,
          blastOptions?: { element: string; damageType: string; isMelee: boolean }
        ) =>
          rollCheck(
            actor as Ref<Actor>,
            'blastDamage',
            `${blastOptions?.element},${blastOptions?.damageType},${variant ? 'criticalSuccess' : 'success'},${blastOptions?.isMelee}`
          ),
        setDamageType: (newType: string) => {
          const dmgs: Record<string, string> = {}
          dmgs[blast?.blastElement ?? ''] = newType
          const update = {
            flags: { pf2e: { damageSelections: dmgs } }
          }
          const flags = blast.item?.flags.pf2e.damageSelections as Record<string, string>
          flags[blast?.blastElement ?? ''] = newType
          return updateActorItem(actor as Ref<Actor>, blast.item?._id ?? '', update)
        }
      }))
    ),
    blastActions: computed({
      get: () => {
        const blastItemId = actor.value?.elementalBlasts?.item?._id
        return actor.value?.items
          ?.find((i) => i._id === blastItemId)
          ?.system?.rules?.find((r) => r.option === 'action-cost')?.selection
      },
      set: (newValue: string) => {
        const blastItemId = actor.value?.elementalBlasts?.item?._id
        const rules = actor.value?.items?.find((i) => i._id === blastItemId)?.system?.rules
        const actionRule = rules?.find((r) => r.option === 'action-cost')
        if (actionRule) actionRule.selection = newValue
        const update = { system: { rules: rules } }
        // const ruleIndex = actor.value?.items
        //   .find((i) => i._id === blastItemId)
        //   ?.system?.rules?.findIndex((r) => r.option === 'action-cost')
        // const update = { system: { rules: [] as { option: string; selection: string }[] } }
        // if (ruleIndex) update.system.rules[ruleIndex].selection = newValue.toString()
        return updateActorItem(actor as Ref<Actor>, blastItemId ?? '', update)
      }
    }),
    skills: computed(() =>
      Object.values(actor.value?.system?.skills ?? {})?.map((skill: PF2eStat) => ({
        ...(makeStat(skill) as Stat),
        roll: (result: number | undefined) =>
          rollCheck(actor as Ref<Actor>, 'skill', skill.slug, { d20: [result ?? 0] })
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
      totalModifier: computed(() => actor.value?.system?.initiative?.totalModifier),
      roll: (result: number | undefined) => {
        return rollCheck(actor as Ref<Actor>, 'initiative', '', { d20: [result ?? 0] })
      }
    }
  }
}
