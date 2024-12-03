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
  Stat as PF2eStat,
  Action as PF2eAction
} from '@/types/pf2e-types'
import { actionDefs, inventoryTypes } from '@/utils/constants'
import type { Roll } from '@/types/foundry-types'
import { useApi } from '@/composables/api'

type Field<T> = ComputedRef<T | undefined>
type WritableField<T> = WritableComputedRef<T | undefined>
type Prop<T> = T | undefined

////////////////////////////////////////
// character def                      //
////////////////////////////////////////
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
    land: Field<Stat>
    swim: Field<Stat>
    climb: Field<Stat>
    fly: Field<Stat>
    burrow: Field<Stat>
  }

  // stuff (feats, effects, conditions, inventory)
  feats: Field<Item[]>
  effects: Field<Item[]>
  inventory: Field<Equipment[]>

  // actions
  actions: Field<Action[]>
  strikes: Field<Strike[]>
  skills: Field<Stat[]>
  proficiencies: Field<Stat[]>
  initiative: {
    stat: WritableField<string>
    modifiers: Field<Modifier[]>
    roll: () => Promise<Roll> | null
  }
}

////////////////////////////////////////
// object shorthands                  //
////////////////////////////////////////
export interface Item {
  _id: Prop<string>
  name: Prop<string>
  type: Prop<string>
  system: Prop<System>
  img: Prop<string>
  itemGrants: Prop<string[]>
  grantedBy: Prop<string>
  delete?: () => void
  changeValue?: (newTotal: number) => void
}
export interface Action extends Item {
  actionType: string | null
  item: Item
  doAction?: (options: object) => Promise<Roll> | null
}
export interface Equipment extends Item {
  toggleInvested?: (newValue?: Prop<boolean>) => void
  changeCarry?: (
    method: Prop<string>,
    hands: Prop<number>,
    container: Prop<string | null>,
    inSlot?: Prop<boolean>
  ) => void
}
export interface Strike {
  label: Prop<string>
  slug: Prop<string>
  item?: Prop<Item>
  variants: Prop<{ label: string }[]>
  traits: Prop<Trait[]>
  weaponTraits: Prop<{ name: string; label: string; description: string }[]>
  tmDamageFormula: Prop<{ base: string; critical: string; _modifiers: Prop<Modifier[]> }>
  _modifiers: Prop<Modifier[]>
  doStrike?: (variant: number) => Promise<Roll> | null
  doDamage?: (variant: number) => Promise<Roll> | null
}
export interface Stat {
  label: Prop<string>
  slug: Prop<string>
  type: Prop<string>
  attribute: Prop<string>
  rank: Prop<number>
  total: Prop<number>
  value: Prop<number>
  totalModifier: Prop<number>
  modifiers: Prop<Modifier[]>
  dc: Prop<number>
  armor: Prop<boolean>
  lore: Prop<boolean>
  roll?: () => Promise<Roll> | null
}
export interface IWR {
  type: Prop<string>
  exceptions: Prop<string[]>
  definition: Prop<string>
  value?: Prop<number>
}

export interface System {
  slug: Prop<string>
  location: Prop<string>
  category: Prop<string>
  description: { value: string }
  value: { value: Prop<number>; isValued: Prop<boolean> }
  traits: { rarity: Prop<string>; value: Prop<string[]> }
  level: { value: Prop<number>; taken: Prop<number> }
  actions: { value: Prop<string> }
  equipped: {
    carryType: Prop<string>
    invested: Prop<boolean>
    handsHeld: Prop<number>
    inSlot: Prop<boolean>
  }
  usage: { value: Prop<string> }
  containerId: Prop<string>
  quantity: Prop<number>
  price: { value: { gp: Prop<number>; sp: Prop<number>; cp: Prop<number> } }
}
export interface Modifier {
  slug: Prop<string>
  label: Prop<string>
  modifier: Prop<number>
  enabled: Prop<boolean>
  hideIfDisabled: Prop<boolean>
}
export interface Trait {
  name: string
  label: string
  description: string
}

////////////////////////////////////////
// object-building macros             //
////////////////////////////////////////
function makeModifiers(set: PF2eModifier[] | undefined): Modifier[] | undefined {
  if (!set) return undefined
  return set?.map((m: PF2eModifier) => ({
    slug: m.slug,
    label: m.label,
    modifier: m.modifier,
    enabled: m.enabled,
    hideIfDisabled: m.hideIfDisabled
  }))
}
function makeStat(root: PF2eStat | undefined): Stat | undefined {
  if (!root) return undefined
  return {
    slug: root?.slug,
    label: root?.label,
    type: root?.type,
    attribute: root?.attribute,
    rank: root?.rank,
    total: root?.total,
    value: root?.value,
    totalModifier: root?.totalModifier,
    dc: root?.dc,
    armor: root?.armor,
    lore: root?.lore,
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
      location: root?.system?.location,
      category: root?.system?.category,
      description: { value: root?.system?.description?.value },
      value: { isValued: root?.system?.value?.isValued, value: root?.system?.value?.value },
      traits: { rarity: root?.system?.traits?.rarity, value: [...root?.system?.traits?.value] },
      level: { value: root?.system?.level?.value, taken: root?.system?.level?.taken },
      actions: { value: root?.system?.actions?.value },
      equipped: {
        carryType: root?.system?.equipped?.carryType,
        invested: root?.system?.equipped?.invested,
        handsHeld: root?.system?.equipped?.handsHeld,
        inSlot: root?.system?.equipped?.inSlot
      },
      usage: { value: root?.system?.usage },
      containerId: root?.system?.containerId,
      quantity: root?.system?.quantity,
      price: {
        value: {
          gp: root?.system?.price?.value?.gp,
          sp: root?.system?.price?.value?.sp,
          cp: root?.system?.price?.value?.cp
        }
      }
    },
    img: root?.img,
    itemGrants: root?.flags?.pf2e?.itemGrants
      ? Object.values(root?.flags?.pf2e?.itemGrants as object).map((i) => i?.id)
      : undefined,
    grantedBy: root?.flags?.pf2e?.grantedBy?.id
    // flags: root?.flags,
    // contents: root?.contents
  }
}

function makeStrike(root: PF2eAction | undefined, item: PF2eItem | undefined): Strike | undefined {
  if (!root) return undefined
  console.log(root)
  return {
    label: root?.label,
    slug: root?.slug,
    item: makeItem(item),
    variants: root?.variants.map((v) => ({ label: v?.label })),
    traits: root?.traits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description
    })),
    weaponTraits: root?.weaponTraits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description
    })),
    tmDamageFormula: {
      base: root?.tmDamageFormula?.base,
      critical: root?.tmDamageFormula?.critical,
      _modifiers: makeModifiers(root?.tmDamageFormula?._modifiers)
    },
    _modifiers: makeModifiers(root?._modifiers)
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
      land: computed(() => makeStat(actor.value?.system?.attributes?.speed)),
      swim: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'swim'
          )
        )
      ),
      climb: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'climb'
          )
        )
      ),
      fly: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'fly'
          )
        )
      ),
      burrow: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'burrow'
          )
        )
      )
    },

    // effects and conditions
    feats: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => i.type === 'feat')
        .sort(
          (a, b) =>
            (a?.system?.level?.taken ?? a?.system?.level?.value ?? 0) -
            (b?.system?.level?.taken ?? b?.system?.level?.value ?? 0)
        )
        .map((i: PF2eItem) => ({
          ...(makeItem(i) as Item)
        }))
    ),
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
    inventory: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => inventoryTypes.map((t) => t.type).includes(i?.type ?? ''))
        .map((i: PF2eItem) => ({
          ...(makeItem(i) as Equipment),
          toggleInvested: (newValue: boolean = !i?.system?.equipped?.invested) => {
            const update = { system: { equipped: { invested: newValue } } }
            updateActorItem(actor as Ref<Actor>, i?._id, update)
          },
          delete: () => {
            deleteActorItem(actor as Ref<Actor>, i?._id)
          },
          changeValue: (newValue) => {
            if (!i?.system?.quantity) return
            i.system.quantity = Math.max(newValue, 0)
            const update = { system: { quantity: Math.max(newValue, 0) } }
            updateActorItem(actor as Ref<Actor>, i?._id, update)
          },
          changeCarry: (
            carryType: Prop<string>,
            handsHeld: Prop<number>,
            containerId: Prop<string | null>,
            inSlot: Prop<boolean> = i?.system?.equipped?.inSlot
          ) => {
            if (!i?.system?.equipped) return
            i.system.equipped.carryType = carryType
            i.system.equipped.handsHeld = handsHeld
            i.system.equipped.inSlot = inSlot
            i.system.containerId = containerId
            const update = {
              system: {
                containerId: containerId,
                equipped: { carryType, handsHeld, inSlot }
              }
            }
            updateActorItem(actor as Ref<Actor>, i?._id, update)
          }
        }))
    ),

    // actions
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
        doStrike: (variant: number) =>
          rollCheck(actor as Ref<Actor>, 'strike', `${action.slug},${variant}`),
        doDamage: (crit: boolean) =>
          rollCheck(actor as Ref<Actor>, 'damage', `${action.slug},${crit ? 'critical' : 'damage'}`)
      }))
    ),
    skills: computed(() =>
      Object.values(actor.value?.system?.skills ?? {}).map((skill: PF2eStat) => ({
        ...(makeStat(skill) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'skill', skill.slug)
      }))
    ),
    proficiencies: computed(() => [
      ...Object.entries(actor.value?.system.proficiencies['attacks'] as Stat).map(
        ([key, stat]) => ({ ...makeStat(stat), type: 'attacks', slug: key }) as Stat
      ),
      ...Object.entries(actor.value?.system.proficiencies['defenses'] as Stat).map(
        ([key, stat]) => ({ ...makeStat(stat), type: 'defenses', slug: key }) as Stat
      ),
      ...Object.entries(actor.value?.system.proficiencies['classDCs'] as Stat).map(
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
      modifiers: computed(() => actor.value?.system.initiative.modifiers),
      roll: () => {
        return rollCheck(actor as Ref<Actor>, 'initiative')
      }
    }
  }

  return { character }
}
