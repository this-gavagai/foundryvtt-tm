import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { Immunity, Weakness, Resistance } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField, Maybe } from './helpers'
import { type Modifier, makeModifiers } from './modifier'
import { type Stat, makeStat } from './stat'
import { useApi } from '../api'
import type { RequestResolutionArgs } from '@/types/api-types'

export interface IWR {
  type: Maybe<string>
  exceptions: Maybe<string[]>
  definition: Maybe<string>
  value?: Maybe<number>
}
export function makeIWRs(set: (Immunity | Weakness | Resistance)[] | undefined): IWR[] | undefined {
  if (!set) return undefined
  return set.map((e) => ({
    type: e.type,
    exceptions: e.exceptions.map((ex) => (typeof ex === 'string' ? ex : ex.label)),
    definition: undefined,
    value: e.value as number | undefined
  }))
}

export interface CharacterStats {
  // stats
  attributes: {
    str: Field<number>
    dex: Field<number>
    con: Field<number>
    int: Field<number>
    wis: Field<number>
    cha: Field<number>
  }
  ac: {
    current: Field<number>
    modifiers: Field<Modifier[]>
  }
  shield: {
    hp: {
      current: WritableField<number>
      max: Field<number>
      brokenThreshold: Field<number>
    }
    ac: Field<number>
    hardness: Field<number>
    raised: Field<boolean>
    broken: Field<boolean>
    destroyed: Field<boolean>
    itemId: Field<string>
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
  spellDC: Field<number>

  doFlatCheck: (
    rollResult?: number | undefined,
    options?: object | undefined
  ) => Promise<RequestResolutionArgs>
}

export function useCharacterStats(actor: Ref<CharacterPF2e | undefined>): CharacterStats {
  const { rollCheck, updateActorItem } = useApi()
  const attributes = {
    str: computed(() => actor.value?.system?.abilities?.str?.mod ?? calcAttribute(actor, 'str')),
    dex: computed(() => actor.value?.system?.abilities?.dex?.mod ?? calcAttribute(actor, 'dex')),
    con: computed(() => actor.value?.system?.abilities?.con?.mod ?? calcAttribute(actor, 'con')),
    int: computed(() => actor.value?.system?.abilities?.int?.mod ?? calcAttribute(actor, 'int')),
    wis: computed(() => actor.value?.system?.abilities?.wis?.mod ?? calcAttribute(actor, 'wis')),
    cha: computed(() => actor.value?.system?.abilities?.cha?.mod ?? calcAttribute(actor, 'cha'))
  }
  const ac = {
    current: computed(() => actor.value?.system?.attributes?.ac?.value),
    modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.ac?.modifiers))
  }
  const shield = {
    hp: {
      current: computed({
        get: () => actor.value?.system?.attributes?.shield?.hp?.value,
        set: (newValue) => {
          console.log(newValue)
          const shieldId = actor.value?.system?.attributes?.shield?.itemId
          actor.value!.system.attributes.shield.hp.value = newValue!
          const update = { system: { hp: { value: newValue } } }
          updateActorItem(actor as Ref<CharacterPF2e>, shieldId ?? '', update)
        }
      }),
      max: computed(() => actor.value?.system?.attributes?.shield?.hp?.max),
      brokenThreshold: computed(() => (actor.value?.system?.attributes?.shield?.hp as { brokenThreshold?: number })?.brokenThreshold)
    },
    ac: computed(() => actor.value?.system?.attributes?.shield?.ac),
    hardness: computed(() => actor.value?.system?.attributes?.shield?.hardness),
    raised: computed(() => actor.value?.system?.attributes?.shield?.raised),
    broken: computed(() => actor.value?.system?.attributes?.shield?.broken),
    destroyed: computed(() => actor.value?.system?.attributes?.shield?.destroyed),
    itemId: computed(() => actor.value?.system?.attributes?.shield?.itemId ?? undefined)
  }
  const saves = {
    fortitude: computed(() => ({
      ...(makeStat(actor.value?.system?.saves?.fortitude) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(
          actor as Ref<CharacterPF2e>,
          'save',
          'fortitude',
          { d20: [result ?? 0] },
          [],
          options ?? {}
        )
    })),
    reflex: computed(() => ({
      ...(makeStat(actor.value?.system?.saves?.reflex) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(actor as Ref<CharacterPF2e>, 'save', 'reflex', { d20: [result ?? 0] }, [], options ?? {})
    })),
    will: computed(() => ({
      ...(makeStat(actor.value?.system?.saves?.will) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(actor as Ref<CharacterPF2e>, 'save', 'will', { d20: [result ?? 0] }, [], options ?? {})
    }))
  }
  const perception = computed(() => ({
    ...(makeStat(actor.value?.system?.perception) as Stat),
    roll: (result: number | undefined) =>
      rollCheck(actor as Ref<CharacterPF2e>, 'perception', '', { d20: [result ?? 0] })
  }))

  const immunities = computed(() => makeIWRs(actor.value?.system?.attributes?.immunities))
  const weaknesses = computed(() => makeIWRs(actor.value?.system?.attributes?.weaknesses))
  const resistances = computed(() => makeIWRs(actor.value?.system?.attributes?.resistances))
  const spellDC = computed(() => actor.value?.system?.attributes?.spellDC?.value)

  const doFlatCheck = (
    rollResult: number | undefined = undefined,
    options: object | undefined = {}
  ) => {
    return rollCheck(actor as Ref<CharacterPF2e>, 'flat', '', { d20: [rollResult ?? 0] }, [], options ?? {})
  }

  return {
    attributes,
    ac,
    shield,
    saves,
    perception,
    immunities,
    weaknesses,
    resistances,
    spellDC,
    doFlatCheck
  }
}

type AncestrySystem = {
  alternateAncestryBoosts?: string[]
  boosts?: Record<string, { selected?: string; value: string[] }>
  flaws?: Record<string, { selected?: string; value: string[] }>
  voluntary?: { boost?: string; flaws?: string[] }
}
type BackgroundSystem = {
  boosts?: Record<string, { selected?: string; value: string[] }>
}
type ClassSystem = {
  keyAbility?: { selected?: string; value: string[] }
}
type ApexSystem = {
  apex?: { attribute?: string; selected?: boolean }
}

function calcAttribute(
  actor: Ref<CharacterPF2e | undefined>,
  stat: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
) {
  if (!actor.value) return
  let count = 0
  // ancestry
  const ancestry = actor.value.items.find((i) => i.type === 'ancestry')
  const ancestrySystem = ancestry?.system as AncestrySystem | undefined
  if (ancestrySystem?.alternateAncestryBoosts?.length) {
    if (ancestrySystem?.alternateAncestryBoosts.includes(stat)) count++
  } else {
    Object.values(ancestrySystem?.boosts ?? {}).forEach((b) => {
      if (b.selected && b.selected === stat) count++
      else if (!b.selected && b.value.length === 1 && b.value[0] === stat) count++
    })
    Object.values(ancestrySystem?.flaws ?? {}).forEach((b) => {
      if (b.selected && b.selected === stat) count--
      else if (!b.selected && b.value.length === 1 && b.value[0] === stat) count--
    })
  }
  if (ancestrySystem?.voluntary?.boost === stat) count++
  if (ancestrySystem?.voluntary?.flaws?.includes(stat)) count--

  // background
  const background = actor.value.items.find((i) => i.type === 'background')
  const backgroundSystem = background?.system as BackgroundSystem | undefined
  Object.values(backgroundSystem?.boosts ?? {}).forEach((b) => {
    if (b.selected && b.selected === stat) count++
    else if (!b.selected && b.value.length === 1 && b.value[0] === stat) count++
  })

  // class
  const classType = actor.value.items.find((i) => i.type === 'class')
  const keyAbility = (classType?.system as ClassSystem | undefined)?.keyAbility
  if (keyAbility?.selected && keyAbility?.selected === stat) count++
  else if (!keyAbility?.selected && keyAbility?.value.length === 1 && keyAbility?.value[0] === stat)
    count++

  // levels
  if (actor.value.system?.build?.attributes?.boosts[1]?.includes(stat)) count++
  if (actor.value.system?.build?.attributes?.boosts[5]?.includes(stat)) count++
  if (actor.value.system?.build?.attributes?.boosts[10]?.includes(stat)) count++
  if (actor.value.system?.build?.attributes?.boosts[15]?.includes(stat)) count++
  if (actor.value.system?.build?.attributes?.boosts[20]?.includes(stat)) count++

  // apex items
  const apex = actor.value.items.find(
    (i) => (i?.system as ApexSystem)?.apex?.attribute === stat && (i?.system as ApexSystem)?.apex?.selected === true
  )
  if (apex) count = Math.max(count + 1, 4)

  return count <= 4 ? count : Math.floor((count - 4) / 2) + 4
}
