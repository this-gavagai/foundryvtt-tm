// TODO: is there a better way to do a complex object with many computed properties?
// TODO: (refactor) pulling a lot of objects from the actor right now. Better to pull only primitives? (probably yes)
import type { Ref, ComputedRef, WritableComputedRef } from 'vue'
import { computed, watch } from 'vue'
import type { Actor, Item, IWR } from '@/types/pf2e-types'
import { useApi } from '@/composables/api'

export interface Character {
  // core
  ancestry: ComputedRef<Item | undefined>
  heritage: ComputedRef<Item | undefined>
  background: ComputedRef<Item | undefined>
  classType: ComputedRef<Item | undefined>
  level: ComputedRef<number | undefined>
  xp: {
    current: WritableComputedRef<number | undefined>
    max: ComputedRef<number | undefined>
  }
  // stats
  attributes: {
    str: ComputedRef<number | undefined>
    dex: ComputedRef<number | undefined>
    con: ComputedRef<number | undefined>
    int: ComputedRef<number | undefined>
    wis: ComputedRef<number | undefined>
    cha: ComputedRef<number | undefined>
  }
  saves: {
    fortitude: ComputedRef<Stat | undefined>
    reflex: ComputedRef<Stat | undefined>
    will: ComputedRef<Stat | undefined>
  }
  perception: ComputedRef<Stat | undefined>
  immunities: ComputedRef<IWR[] | undefined>
  weaknesses: ComputedRef<IWR[] | undefined>
  resistances: ComputedRef<IWR[] | undefined>

  // resources
  hp: {
    current: WritableComputedRef<number | undefined>
    max: ComputedRef<number | undefined>
    temp: WritableComputedRef<number | undefined>
    modifiers: ComputedRef<Modifier[]>
  }
  heroPoints: {
    current: WritableComputedRef<number | undefined>
    max: ComputedRef<number | undefined>
  }
  ac: {
    current: ComputedRef<number | undefined>
    modifiers: ComputedRef<Modifier[]>
  }

  // details

  // actions
  actions: ComputedRef<Item[] | undefined>
}

// object shorthands
interface Stat {
  label: string
  slug: string
  attribute: string
  rank: number
  modifiers: Modifier[]
  totalModifier: number
  dc: number
  roll?: () => void
}
interface Modifier {
  slug: string
  label: string
  modifier: number
  enabled: boolean
  hideIfDisabled: boolean
}

// object-buidling macros
function makeStat(root: Stat) {
  return {
    slug: root?.slug,
    label: root?.label,
    attribute: root?.attribute,
    rank: root?.rank,
    totalModifier: root?.totalModifier,
    dc: root?.dc,
    modifiers: root?.modifiers?.map((m: Modifier) => ({
      slug: m.slug,
      label: m.label,
      modifier: m.modifier,
      enabled: m.enabled,
      hideIfDisabled: m.hideIfDisabled
    }))
  }
}

export function useCharacter(actor: Ref<Actor | undefined>) {
  watch(actor, () => console.log('actor changed', actor.value?._id))
  const { updateActor, rollCheck } = useApi()
  const character: Character = {
    ancestry: computed(() => actor.value?.items?.find((x: Item) => x.type === 'ancestry')),
    background: computed(() => actor.value?.items?.find((x: Item) => x.type === 'background')),
    heritage: computed(() => actor.value?.items?.find((x: Item) => x.type === 'heritage')),
    classType: computed(() => actor.value?.items?.find((x: Item) => x.type === 'class')),
    level: computed(() => actor.value?.system?.details?.level?.value),
    xp: {
      current: computed({
        get: () => actor.value?.system?.details?.xp?.value,
        set: (newValue) => {
          actor.value!.system.details.xp.value = newValue
          const update = { system: { details: { xp: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor.value?.system?.details?.xp?.max)
    },

    attributes: {
      str: computed(() => actor.value?.system?.abilities?.str?.mod),
      dex: computed(() => actor.value?.system?.abilities?.dex?.mod),
      con: computed(() => actor.value?.system?.abilities?.con?.mod),
      int: computed(() => actor.value?.system?.abilities?.int?.mod),
      wis: computed(() => actor.value?.system?.abilities?.wis?.mod),
      cha: computed(() => actor.value?.system?.abilities?.cha?.mod)
    },
    saves: {
      fortitude: computed(() => ({
        ...makeStat(actor.value?.system?.saves?.fortitude),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'fortitude')
      })),
      reflex: computed(() => ({
        ...makeStat(actor.value?.system?.saves?.reflex),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'reflex')
      })),
      will: computed(() => ({
        ...makeStat(actor.value?.system?.saves?.will),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'will')
      }))
    },
    perception: computed(() => ({
      ...makeStat(actor.value?.system?.perception),
      roll: () => rollCheck(actor as Ref<Actor>, 'perception', '')
    })),
    immunities: computed(() => actor.value?.system?.attributes?.immunities),
    weaknesses: computed(() => actor.value?.system?.attributes?.weaknesses),
    resistances: computed(() => actor.value?.system?.attributes?.resistances),

    hp: {
      current: computed({
        get: () => {
          console.log('calculating hitpoints') //log to test calc frequency
          return actor.value?.system?.attributes?.hp?.value
        },
        set: (newValue) => {
          actor.value!.system.attributes.hp.value = newValue
          const update = { system: { attributes: { hp: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor.value?.system?.attributes?.hp?.max),
      temp: computed({
        get: () => actor.value?.system?.attributes?.hp?.temp,
        set: (newValue) => {
          actor.value!.system.attributes.hp.temp = newValue
          const update = { system: { attributes: { hp: { temp: newValue } } } }
          updateActor(actor, update)
        }
      }),
      modifiers: computed(() => actor.value?.system?.attributes?.hp?._modifiers)
    },
    heroPoints: {
      current: computed({
        get: () => actor.value?.system?.resources?.heroPoints?.value,
        set: (newValue) => {
          actor.value!.system.resources.heroPoints.value = newValue
          const update = { system: { resources: { heroPoints: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor.value?.system?.resources?.heroPoints?.max)
    },
    ac: {
      current: computed(() => actor.value?.system?.attributes?.ac?.value),
      modifiers: computed(() => actor.value?.system?.attributes?.ac?.modifiers)
    },

    actions: computed(() => {
      return actor.value?.items?.filter((i: Item) => i?.system?.actionType?.value === 'action')
      // ?.filter(
      //   (i: Item) => !i.system?.traits?.value?.includes('skill') && !actionDefs?.get(i.system.slug)?.skill
      // )
    })
  }
  window.character = character
  return { character }
}
