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
import { actionTypes } from '@/utils/constants'
import { kebabCase } from 'lodash-es'

export interface Action extends Item {
  actionType: string | null
  item: Item
  doAction?: (options?: object | undefined, rollResult?: number | undefined) => Promise<Roll | null>
}

export interface CharacterActions {
  doCharacterAction: (
    slug: string,
    options?: object | undefined,
    rollResult?: number | undefined
  ) => Promise<Roll>
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

export function useCharacterActions(actor: Ref<Actor | undefined>): CharacterActions {
  const { characterAction, rollCheck, updateActor, updateActorItem, getStrikeDamage } = useApi()
  return {
    doCharacterAction: (slug, options = {}, rollResult = undefined) => {
      return characterAction(actor as Ref<Actor>, slug, options ?? {}, { d20: [rollResult ?? 0] })
    },
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
          doAction: (options = {}, rollResult = undefined) => {
            if (i?.system?.slug)
              return characterAction(actor as Ref<Actor>, i?.system?.slug, options ?? {}, {
                d20: [rollResult ?? 0]
              })
            else return Promise.resolve(null)
          }
        }))
    ),
    strikes: computed(() => {
      return actor.value?.system?.actions?.map(
        (action: PF2eAction) =>
          ({
            ...makeStrike(
              action,
              actor.value?.items.find((i: PF2eItem) => i.system?.slug === action?.slug)
            ),
            getDamage: (altUsage = undefined) =>
              getStrikeDamage(actor as Ref<Actor>, action.slug, altUsage),
            doStrike: (variant, altUsage, blastOptions, result) =>
              rollCheck(
                actor as Ref<Actor>,
                'strike',
                `${action.slug},${variant},${altUsage ?? ''}`,
                {
                  d20: [result ?? 0]
                }
              ),
            doDamage: (variant, altUsage) =>
              rollCheck(
                actor as Ref<Actor>,
                'damage',
                `${action.slug},${variant ? 'critical' : 'damage'},${altUsage ?? ''}`
              ),
            setDamageType: (newType) => {
              const item = actor.value?.items.find((i: PF2eItem) => i._id === action?.item?._id)
              if (!item || !actor.value) return Promise.resolve(null)
              const adjustment = item?.system?.damage?.damageType === newType ? null : newType
              const isModular = item?.system?.traits?.value?.includes('modular')
              const update = isModular
                ? { system: { traits: { toggles: { modular: { selected: adjustment } } } } }
                : { system: { traits: { toggles: { versatile: { selected: adjustment } } } } }
              if (isModular)
                actor.value.items.find(
                  (i: PF2eItem) => i._id === action?.item?._id
                )!.system.traits.toggles.modular.selected = adjustment
              else
                actor.value.items.find(
                  (i: PF2eItem) => i._id === action?.item?._id
                )!.system.traits.toggles.versatile.selected = adjustment
              return updateActorItem(actor as Ref<Actor>, action?.item?._id ?? '', update)
            },
            changeAmmo: (newId) => {
              const item = actor.value?.items.find((i: PF2eItem) => i._id === action?.item?._id)
              const actorAction = actor.value?.system.actions.find(
                (a: PF2eAction) => a.slug === action?.slug
              )
              if (item && item.system) item.system.selectedAmmoId = newId
              if (actorAction) actorAction.ammunition.selected = newId ? { id: newId } : null

              const update = { system: { selectedAmmoId: newId || null } }
              return (
                updateActorItem(actor as Ref<Actor>, action?.item?._id ?? '', update) ??
                Promise.resolve(null)
              )
            }
          }) as Strike
      )
    }),
    blasts: computed(() =>
      makeElementalBlasts(actor.value?.elementalBlasts)?.map(
        (blast: ElementalBlast) =>
          ({
            ...blast,
            getDamage: (altUsage, blastOptions) =>
              getStrikeDamage(
                actor as Ref<Actor>,
                `blast:${blastOptions?.element},${blastOptions?.damageType},${blastOptions?.isMelee}`
              ),
            doStrike: (variant, altUsage, blastOptions, result: number | undefined) =>
              rollCheck(
                actor as Ref<Actor>,
                'blast',
                `${blastOptions?.element},${blastOptions?.damageType},${variant},${blastOptions?.isMelee}`,
                { d20: [result ?? 0] }
              ),
            doDamage: (variant, altUsage, blastOptions) =>
              rollCheck(
                actor as Ref<Actor>,
                'blastDamage',
                `${blastOptions?.element},${blastOptions?.damageType},${variant ? 'criticalSuccess' : 'success'},${blastOptions?.isMelee}`
              ),
            setDamageType: (newType) => {
              const dmgs: Record<string, string> = {}
              dmgs[blast?.blastElement ?? ''] = newType
              const update = {
                flags: { pf2e: { damageSelections: dmgs } }
              }
              const flags = blast.item?.flags.pf2e.damageSelections as Record<string, string>
              flags[blast?.blastElement ?? ''] = newType
              return updateActorItem(actor as Ref<Actor>, blast.item?._id ?? '', update)
            }
          }) as ElementalBlast
      )
    ),
    blastActions: computed({
      get: () => {
        const blastItemId = actor.value?.elementalBlasts?.item?._id
        return actor.value?.items
          ?.find((i) => i._id === blastItemId)
          ?.system?.rules?.find((r) => r.option === 'action-cost')?.selection
      },
      set: (newValue) => {
        const blastItemId = actor.value?.elementalBlasts?.item?._id
        const rules = actor.value?.items?.find((i) => i._id === blastItemId)?.system?.rules
        const actionRule = rules?.find((r) => r.option === 'action-cost')
        if (actionRule) actionRule.selection = newValue ?? ''
        const update = { system: { rules: rules } }
        return updateActorItem(actor as Ref<Actor>, blastItemId ?? '', update)
      }
    }),
    skills: computed(() => {
      const skills = Object.entries(actor.value?.system?.skills ?? [])?.map(
        ([key, skill]) =>
          ({
            ...makeStat(skill, key),
            roll: (result) =>
              rollCheck(actor as Ref<Actor>, 'skill', skill.slug, { d20: [result ?? 0] })
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
    }),
    proficiencies: computed(() => [
      ...Object.entries((actor.value?.system?.proficiencies?.['attacks'] ?? []) as PF2eStat[]).map(
        ([key, stat]) => ({ ...makeStat(stat, key), type: 'attacks', slug: key }) as Stat
      ),
      ...Object.entries((actor.value?.system?.proficiencies?.['defenses'] ?? []) as PF2eStat[]).map(
        ([key, stat]) => ({ ...makeStat(stat, key), type: 'defenses', slug: key }) as Stat
      ),
      ...Object.entries((actor.value?.system?.proficiencies?.['classDCs'] ?? []) as PF2eStat[]).map(
        ([key, stat]) => ({ ...makeStat(stat, key), type: 'classDCs', slug: key }) as Stat
      ),
      ...[
        {
          ...(makeStat(actor.value?.system?.proficiencies?.['spellcasting']) as Stat),
          value: actor.value?.system?.attributes?.classOrSpellDC?.value,
          type: 'spellcasting',
          slug: 'Spell DC',
          label: 'Spell DC'
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
      roll: (result) => {
        return rollCheck(actor as Ref<Actor>, 'initiative', '', { d20: [result ?? 0] })
      }
    }
  }
}
