import type { Ref } from 'vue'
import { computed } from 'vue'
import type { Actor, Item as PF2eItem } from '@/types/pf2e-types'
import type { AncestryPF2e, BackgroundPF2e, ClassPF2e as ClassPF2eType, HeritagePF2e } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import type { RequestResolutionArgs } from '@/types/api-types'
import { type Ancestry, makeAncestry } from './ancestry'
import { type Background, makeBackground } from './background'
import { type Heritage, makeHeritage } from './heritage'
import { type ClassType, makeClassType } from './classType'
import { type Stat, makeStat } from './stat'
import { useApi } from '../api'

export interface CharacterCore {
  _id: Field<string>
  name: Field<string>
  portraitUrl: Field<string>
  ancestry: Field<Ancestry>
  heritage: Field<Heritage>
  background: Field<Background>
  classType: Field<ClassType>
  level: Field<number>
  xp: {
    current: WritableField<number>
    max: Field<number>
  }
  movement: {
    land: Field<Stat>
    swim: Field<Stat>
    climb: Field<Stat>
    fly: Field<Stat>
    burrow: Field<Stat>
  }
  languages: Field<string[]>
  rollInline: (result: number | undefined) => Promise<RequestResolutionArgs | null>
}

export function useCharacterCore(actor: Ref<Actor | undefined>): CharacterCore {
  const { updateActor, rollCheck } = useApi()

  const _id = computed(() => actor.value?._id)
  const name = computed(() => actor.value?.name)
  const portraitUrl = computed(() => actor.value?.prototypeToken?.texture?.src)

  const ancestry = computed(() =>
    makeAncestry(actor.value?.items?.find((x: PF2eItem) => x.type === 'ancestry') as AncestryPF2e | undefined)
  )
  const background = computed(() =>
    makeBackground(actor.value?.items?.find((x: PF2eItem) => x.type === 'background') as BackgroundPF2e | undefined)
  )
  const heritage = computed(() =>
    makeHeritage(actor.value?.items?.find((x: PF2eItem) => x.type === 'heritage') as HeritagePF2e | undefined)
  )
  const classType = computed(() =>
    makeClassType(actor.value?.items?.find((x: PF2eItem) => x.type === 'class') as ClassPF2eType | undefined)
  )

  const level = computed(() => actor.value?.system?.details?.level?.value)
  const xp = {
    current: computed({
      get: () => actor.value?.system?.details?.xp?.value,
      set: (newValue) => {
        actor.value!.system.details.xp.value = newValue
        const update = { system: { details: { xp: { value: newValue } } } }
        updateActor(actor, update)
      }
    }),
    max: computed(() => actor.value?.system?.details?.xp?.max)
  }
  const movement = {
    land: computed(() => makeStat(actor.value?.system?.movement?.speeds?.land)),
    swim: computed(() => makeStat(actor.value?.system?.movement?.speeds?.swim)),
    climb: computed(() => makeStat(actor.value?.system?.movement?.speeds?.climb)),
    fly: computed(() => makeStat(actor.value?.system?.movement?.speeds?.fly)),
    burrow: computed(() => makeStat(actor.value?.system?.movement?.speeds?.burrow))

    // land: computed(() => makeStat(actor.value?.system?.attributes?.speed)),
    // swim: computed(() =>
    //   makeStat(
    //     actor.value?.system.attributes.speed.otherSpeeds.find(
    //       (s: PF2eMovement) => s.type === 'swim'
    //     )
    //   )
    // ),
    // climb: computed(() =>
    //   makeStat(
    //     actor.value?.system.attributes.speed.otherSpeeds.find(
    //       (s: PF2eMovement) => s.type === 'climb'
    //     )
    //   )
    // ),
    // fly: computed(() =>
    //   makeStat(
    //     actor.value?.system.attributes.speed.otherSpeeds.find((s: PF2eMovement) => s.type === 'fly')
    //   )
    // ),
    // burrow: computed(() =>
    //   makeStat(
    //     actor.value?.system.attributes.speed.otherSpeeds.find(
    //       (s: PF2eMovement) => s.type === 'burrow'
    //     )
    //   )
    // )
  }
  const languages = computed(() => actor.value?.system?.details?.languages?.value)

  const rollInline = (result: number | undefined) => {
    console.log('as promised')
    return rollCheck(actor as Ref<Actor>, 'flat', '', { d20: [result ?? 0] })
  }

  return {
    _id,
    name,
    portraitUrl,
    ancestry,
    background,
    heritage,
    classType,
    level,
    xp,
    movement,
    languages,
    rollInline
  }
}
