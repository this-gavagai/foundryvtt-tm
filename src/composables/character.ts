// TODO: is there a better way to do a complex object with many computed properties?
// TODO: why all this makeItem(...) as Item stuff? any way to avoid?
// TODO: should roll/delete/changeValue have return values?
// /TODO: add a Roll type here? or not?
import type { Ref, ComputedRef, WritableComputedRef } from 'vue'
import { computed, watch } from 'vue'
import type {
  Actor,
  IWR as PF2eIWR,
  Item as PF2eItem,
  Modifier as PF2eModifier,
  Movement as PF2eMovement,
  Save as PF2eSave
} from '@/types/pf2e-types'
import { actionDefs } from '@/utils/constants'
import type { Roll } from '@/types/foundry-types'
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
  languages: Field<string[]>

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

  // movement
  movement: {
    land: Field<Movement>
    swim: Field<Movement>
    climb: Field<Movement>
    fly: Field<Movement>
    burrow: Field<Movement>
  }

  // effects and conditions
  effects: Field<Item[]>

  // actions
  actions: Field<Action[]>
}

// object shorthands
export interface Modifier {
  slug: Prop<string>
  label: Prop<string>
  modifier: Prop<number>
  enabled: Prop<boolean>
  hideIfDisabled: Prop<boolean>
}
export interface System {
  slug: Prop<string>
  description: { value: string }
  value: { value: Prop<number>; isValued: Prop<boolean> }
  traits: { rarity: Prop<string>; value: Prop<string[]> }
  level: { value: Prop<number> }
  actions: { value: Prop<string> }
}
export interface Stat {
  label: Prop<string>
  slug: Prop<string>
  attribute: Prop<string>
  rank: Prop<number>
  modifiers: Prop<Modifier[]>
  totalModifier: Prop<number>
  dc: Prop<number>
  roll?: () => Promise<Roll> | null
}
export interface Item {
  _id: Prop<string>
  name: Prop<string>
  type: Prop<string>
  system: Prop<System>
  img: Prop<string>
  delete?: () => void
  changeValue?: (newTotal: number) => void
}
export interface Action extends Item {
  actionType: string | null
  doAction?: (options: object) => Promise<Roll> | null
}
export interface IWR {
  type: Prop<string>
  exceptions: Prop<string[]>
  definition: Prop<string>
  value?: Prop<number>
}
export interface Movement {
  label: Prop<string>
  slug: Prop<string>
  type: Prop<string>
  total: Prop<number>
  value: Prop<number>
  totalModifier: Prop<number>
  modifiers: Prop<Modifier[]>
}

// object-buidling macros
function makeModifiers(root: PF2eModifier[] | undefined): Modifier[] | undefined {
  if (!root) return undefined
  return root?.map((m: PF2eModifier) => ({
    slug: m.slug,
    label: m.label,
    modifier: m.modifier,
    enabled: m.enabled,
    hideIfDisabled: m.hideIfDisabled
  }))
}
function makeStat(root: PF2eSave | undefined): Stat | undefined {
  if (!root) return undefined
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

function makeItem(root: PF2eItem | undefined): Item | undefined {
  if (!root) return undefined
  return {
    _id: root?._id,
    name: root?.name,
    type: root?.type,
    system: {
      slug: root?.system?.slug,
      description: { value: root?.system?.description?.value },
      value: { isValued: root?.system?.value?.isValued, value: root?.system?.value?.value },
      traits: { rarity: root?.system?.traits?.rarity, value: [...root?.system?.traits?.value] },
      level: { value: root?.system?.traits?.level },
      actions: { value: root?.system?.actions?.value }
    },
    img: root?.img
    // flags: root?.flags,
    // contents: root?.contents
  }
}
function makeIWRs(set: PF2eIWR[] | undefined): IWR[] | undefined {
  if (!set) return undefined
  return set?.map((e: PF2eIWR) => ({
    type: e?.type,
    exceptions: Array.from(e?.exceptions),
    definition: e?.definition,
    value: e?.value
  }))
}
function makeMovement(root: PF2eMovement | undefined): Movement | undefined {
  if (!root) return undefined
  return {
    label: root?.label,
    slug: root?.slug,
    type: root?.type,
    total: root?.total,
    value: root?.value,
    totalModifier: root?.totalModifier,
    modifiers: makeModifiers(root?._modifiers as PF2eModifier[])
  }
}

export function useCharacter(actor: Ref<Actor | undefined>) {
  watch(actor, () => console.log('actor changed', actor.value?._id))
  const { updateActor, deleteActorItem, updateActorItem, rollCheck, characterAction } = useApi()
  const character: Character = {
    // core
    _id: computed(() => actor.value?._id),
    name: computed(() => actor.value?.name),
    portraitUrl: computed(() => actor.value?.prototypeToken?.texture?.src),
    ancestry: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'ancestry')) as Item)
    })),
    background: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'background')) as Item)
    })),
    heritage: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'heritage')) as Item)
    })),
    classType: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'class')) as Item)
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
    languages: computed(() => actor.value?.system?.details?.languages?.value),

    // stats
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
        ...(makeStat(actor.value?.system?.saves?.fortitude) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'fortitude')
      })),
      reflex: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.reflex) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'reflex')
      })),
      will: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.will) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'will')
      }))
    },
    perception: computed(() => ({
      ...(makeStat(actor.value?.system?.perception) as Stat),
      roll: () => rollCheck(actor as Ref<Actor>, 'perception', '')
    })),
    immunities: computed(() => makeIWRs(actor.value?.system?.attributes?.immunities)),
    weaknesses: computed(() => makeIWRs(actor.value?.system?.attributes?.weaknesses)),
    resistances: computed(() => makeIWRs(actor.value?.system?.attributes?.resistances)),

    // resources
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

    // movement
    movement: {
      land: computed(() => makeMovement(actor.value?.system?.attributes?.speed)),
      swim: computed(() =>
        makeMovement(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'swim'
          )
        )
      ),
      climb: computed(() =>
        makeMovement(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'climb'
          )
        )
      ),
      fly: computed(() =>
        makeMovement(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'fly'
          )
        )
      ),
      burrow: computed(() =>
        makeMovement(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'burrow'
          )
        )
      )
    },

    // effects and conditions
    effects: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => ['effect', 'condition'].includes(i?.type ?? ''))
        .map((i: PF2eItem) => ({
          ...(makeItem(i) as Item),
          delete: () => deleteActorItem(actor as Ref<Actor>, i?._id),
          changeValue: (newValue: number) => {
            const update = { system: { value: { value: newValue } } }
            updateActorItem(actor as Ref<Actor>, i._id, update)
          }
        }))
    ),

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
    )
  }

  return { character }
}
