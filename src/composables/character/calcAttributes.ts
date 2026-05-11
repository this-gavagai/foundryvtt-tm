import type { Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'

// Calculate attributes if not provided by GM player
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

export function calcAttribute(
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
    (i) =>
      (i?.system as ApexSystem)?.apex?.attribute === stat &&
      (i?.system as ApexSystem)?.apex?.selected === true
  )
  if (apex) count = Math.max(count + 1, 4)

  return count <= 4 ? count : Math.floor((count - 4) / 2) + 4
}
