import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Field, WritableField } from './helpers'
import { type Modifier, makeModifiers } from './modifier'
import { type Stat, makeStat } from './stat'
import { type IWR, makeIWRs } from './iwr'
import { useApi } from '../api'
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
}

export function useCharacterStats(actor: Ref<Actor | undefined>) {
  const { rollCheck, updateActorItem } = useApi()
  return {
    attributes: {
      str: computed(() => actor.value?.system?.abilities?.str?.mod ?? calcAttribute(actor, 'str')),
      dex: computed(() => actor.value?.system?.abilities?.dex?.mod ?? calcAttribute(actor, 'dex')),
      con: computed(() => actor.value?.system?.abilities?.con?.mod ?? calcAttribute(actor, 'con')),
      int: computed(() => actor.value?.system?.abilities?.int?.mod ?? calcAttribute(actor, 'int')),
      wis: computed(() => actor.value?.system?.abilities?.wis?.mod ?? calcAttribute(actor, 'wis')),
      cha: computed(() => actor.value?.system?.abilities?.cha?.mod ?? calcAttribute(actor, 'cha'))
    },
    ac: {
      current: computed(() => actor.value?.system?.attributes?.ac?.value),
      modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.ac?.modifiers))
    },

    shield: {
      hp: {
        current: computed({
          get: () => actor.value?.system?.attributes?.shield?.hp?.value,
          set: (newValue) => {
            console.log(newValue)
            const shieldId = actor.value?.system?.attributes?.shield?.itemId
            // const shieldItem = actor.value?.items.find((i: PF2eItem) => i._id === shieldId)
            // console.log(shieldItem)
            // if (shieldItem?.system?.hp) shieldItem.system.hp.value = newValue
            actor.value!.system.attributes.shield.hp.value = newValue
            const update = { system: { hp: { value: newValue } } }
            updateActorItem(actor as Ref<Actor>, shieldId, update)
          }
        }),
        max: computed(() => actor.value?.system?.attributes?.shield?.hp?.max),
        brokenThreshold: computed(
          () => actor.value?.system?.attributes?.shield?.hp?.brokenThreshold
        )
      },
      ac: computed(() => actor.value?.system?.attributes?.shield?.ac),
      hardness: computed(() => actor.value?.system?.attributes?.shield?.hardness),
      raised: computed(() => actor.value?.system?.attributes?.shield?.raised),
      broken: computed(() => actor.value?.system?.attributes?.shield?.broken),
      destroyed: computed(() => actor.value?.system?.attributes?.shield?.destroyed),
      itemId: computed(() => actor.value?.system?.attributes?.shield?.itemId)
    },

    saves: {
      fortitude: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.fortitude) as Stat),
        roll: (result: number | undefined) =>
          rollCheck(actor as Ref<Actor>, 'save', 'fortitude', { d20: [result ?? 0] })
      })),
      reflex: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.reflex) as Stat),
        roll: (result: number | undefined) =>
          rollCheck(actor as Ref<Actor>, 'save', 'reflex', { d20: [result ?? 0] })
      })),
      will: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.will) as Stat),
        roll: (result: number | undefined) =>
          rollCheck(actor as Ref<Actor>, 'save', 'will', { d20: [result ?? 0] })
      }))
    },
    perception: computed(() => ({
      ...(makeStat(actor.value?.system?.perception) as Stat),
      roll: (result: number | undefined) =>
        rollCheck(actor as Ref<Actor>, 'perception', '', { d20: [result ?? 0] })
    })),
    immunities: computed(() => makeIWRs(actor.value?.system?.attributes?.immunities)),
    weaknesses: computed(() => makeIWRs(actor.value?.system?.attributes?.weaknesses)),
    resistances: computed(() => makeIWRs(actor.value?.system?.attributes?.resistances)),
    spellDC: computed(() => actor.value?.system?.attributes?.spellDC?.value)
  }
}

function calcAttribute(
  actor: Ref<Actor | undefined>,
  stat: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
) {
  if (!actor.value) return
  if (actor.value.name !== 'Leaf Leaf Stick') return
  let count = 0
  // ancestry
  const ancestry = actor.value.items.find((i) => i.type === 'ancestry')
  if (ancestry?.system?.alternateAncestryBoosts.length) {
    if (ancestry?.system?.alternateAncestryBoosts.includes(stat)) count++
  } else {
    Object.values(ancestry?.system?.boosts ?? {}).forEach((b) => {
      if (b.selected && b.selected === stat) count++
      else if (!b.selected && b.value.length === 1 && b.value[0] === stat) count++
    })
    Object.values(ancestry?.system?.flaws ?? {}).forEach((b) => {
      if (b.selected && b.selected === stat) count--
      else if (!b.selected && b.value.length === 1 && b.value[0] === stat) count--
    })
  }
  if (ancestry?.system?.voluntary?.boost === stat) count++
  if (ancestry?.system?.voluntary?.flaws?.includes(stat)) count--

  // background
  const background = actor.value.items.find((i) => i.type === 'background')
  Object.values(background?.system?.boosts ?? {}).forEach((b) => {
    if (b.selected && b.selected === stat) count++
    else if (!b.selected && b.value.length === 1 && b.value[0] === stat) count++
  })

  // class
  const classType = actor.value.items.find((i) => i.type === 'class')
  const keyAbility = classType?.system?.keyAbility
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
    (i) => i?.system?.apex?.attribute === stat && i?.system?.apex?.selected === true
  )
  if (apex) count = Math.max(count + 1, 4)

  return count <= 4 ? count : Math.floor((count - 4) / 2) + 4
}
