// TODO: is there a better way to do a complex object with many computed properties?
// TODO: (refactor) pulling a lot of objects from the actor right now. Better to pull only primitives? (probably yes)
import type { Ref, ComputedRef, WritableComputedRef } from 'vue'
import { computed, watch } from 'vue'
import type {
  Actor,
  System,
  IWR as PF2eIWR,
  Item as PF2eItem,
  Modifier as PF2eModifier
} from '@/types/pf2e-types'
import { useApi } from '@/composables/api'

type Field<T> = ComputedRef<T | undefined>
type WritableField<T> = WritableComputedRef<T | undefined>
type Prop<T> = T | undefined
export interface Character {
  // core
  _id: Field<string>
  name: Field<string>
  portraitUrl: Field<string>
  ancestry: Field<Item>
  heritage: Field<Item>
  background: Field<Item>
  classType: Field<Item>
  level: Field<number>
  xp: {
    current: WritableField<number>
    max: Field<number>
  }
  // stats
  attributes: {
    str: Field<number>
    dex: Field<number>
    con: Field<number>
    int: Field<number>
    wis: Field<number>
    cha: Field<number>
  }
  saves: {
    fortitude: Field<Stat>
    reflex: Field<Stat>
    will: Field<Stat>
  }
  perception: Field<Stat>
  immunities: Field<IWR[]>
  weaknesses: Field<IWR[]>
  resistances: Field<IWR[]>

  // resources
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

  // details

  // actions
  // actions: Field<Item[]>
}

// object shorthands
interface Modifier {
  slug: Prop<string>
  label: Prop<string>
  modifier: Prop<number>
  enabled: Prop<boolean>
  hideIfDisabled: Prop<boolean>
}

interface Stat {
  label: Prop<string>
  slug: Prop<string>
  attribute: Prop<string>
  rank: Prop<number>
  modifiers: Prop<Modifier[]>
  totalModifier: Prop<number>
  dc: Prop<number>
  roll?: () => void
}

interface Item {
  _id: Prop<string>
  name: Prop<string>
  type: Prop<string>
  system: Prop<System>
  img: Prop<string>
  // flags: string[]
  // contents: string
}

interface IWR {
  type: string
  exceptions: string[]
  definition: string
  value?: number
}

// object-buidling macros
function makeModifiers(root: PF2eModifier[] | undefined): Prop<Modifier[]> {
  return root?.map((m: Modifier) => ({
    slug: m.slug,
    label: m.label,
    modifier: m.modifier,
    enabled: m.enabled,
    hideIfDisabled: m.hideIfDisabled
  }))
}
function makeStat(root: Stat | undefined): Stat {
  return {
    slug: root?.slug,
    label: root?.label,
    attribute: root?.attribute,
    rank: root?.rank,
    totalModifier: root?.totalModifier,
    dc: root?.dc,
    modifiers: makeModifiers(root?.modifiers as PF2eModifier[])
  }
}
function makeItem(root: PF2eItem | undefined): Item {
  return {
    _id: root?._id,
    name: root?.name,
    type: root?.type,
    system: root?.system,
    img: root?.img
    // flags: root?.flags,
    // contents: root?.contents
  }
}
function makeIWRs(set: PF2eIWR[] | undefined): Prop<IWR[]> {
  return set?.map((e: PF2eIWR) => ({
    type: e?.type,
    exceptions: Array.from(e?.exceptions),
    definition: e?.definition,
    value: e?.value
  }))
}

export function useCharacter(actor: Ref<Actor | undefined>) {
  watch(actor, () => console.log('actor changed', actor.value?._id))
  const { updateActor, rollCheck } = useApi()
  const character: Character = {
    _id: computed(() => actor.value?._id),
    name: computed(() => actor.value?.name),
    portraitUrl: computed(() => actor.value?.prototypeToken?.texture?.src),
    ancestry: computed(() => ({
      ...makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'ancestry'))
    })),
    background: computed(() => ({
      ...makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'background'))
    })),
    heritage: computed(() => ({
      ...makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'heritage'))
    })),
    classType: computed(() => ({
      ...makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'class'))
    })),
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
    immunities: computed(() => makeIWRs(actor.value?.system?.attributes?.immunities)),
    weaknesses: computed(() => makeIWRs(actor.value?.system?.attributes?.weaknesses)),
    resistances: computed(() => makeIWRs(actor.value?.system?.attributes?.resistances)),

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
    }

    // actions: computed(() => {
    //   return makeItem(
    //     actor.value?.items?.filter((i: Item) => i?.system?.actionType?.value === 'action')
    //   )
    //   // ?.filter(
    //   //   (i: Item) => !i.system?.traits?.value?.includes('skill') && !actionDefs?.get(i.system.slug)?.skill
    //   // )
    // })
  }
  window.character = character
  return { character }
}
