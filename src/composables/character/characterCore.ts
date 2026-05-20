import type { Ref } from 'vue'
import { computed } from 'vue'
import type {
  CharacterPF2e,
  AncestryPF2e,
  BackgroundPF2e,
  ClassPF2e as ClassPF2eType,
  HeritagePF2e
} from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, WritableField } from './helpers'
import { type Ancestry, makeAncestry } from './defs/ancestry'
import { type Background, makeBackground } from './defs/background'
import { type Heritage, makeHeritage } from './defs/heritage'
import { type ClassType, makeClassType } from './defs/classType'
import { type Stat, makeStat } from './defs/stat'
import { updateActor } from '@/api/documents'

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
}

export function useCharacterCore(actor: Ref<TablemateCharacter | undefined>): CharacterCore {

  const _id = computed(() => actor.value?._id ?? undefined)
  const name = computed(() => actor.value?.name)
  const portraitUrl = computed(() => actor.value?.prototypeToken?.texture?.src ?? undefined)

  const ancestry = computed(() =>
    makeAncestry(actor.value?.items?.find((x) => x.type === 'ancestry') as AncestryPF2e | undefined)
  )
  const background = computed(() =>
    makeBackground(
      actor.value?.items?.find((x) => x.type === 'background') as BackgroundPF2e | undefined
    )
  )
  const heritage = computed(() =>
    makeHeritage(actor.value?.items?.find((x) => x.type === 'heritage') as HeritagePF2e | undefined)
  )
  const classType = computed(() =>
    makeClassType(actor.value?.items?.find((x) => x.type === 'class') as ClassPF2eType | undefined)
  )

  const level = computed(() => actor.value?.system?.details?.level?.value)
  const xp = {
    current: computed({
      get: () => actor.value?.system?.details?.xp?.value,
      set: (newValue) => {
        actor.value!.system.details.xp.value = newValue!
        const update = { system: { details: { xp: { value: newValue } } } }
        updateActor(actor as Ref<CharacterPF2e>, update)
      }
    }),
    max: computed(() => actor.value?.system?.details?.xp?.max)
  }
  const movement = {
    land: computed(() => makeStat(actor.value?.system?.movement?.speeds?.land ?? undefined)),
    swim: computed(() => makeStat(actor.value?.system?.movement?.speeds?.swim ?? undefined)),
    climb: computed(() => makeStat(actor.value?.system?.movement?.speeds?.climb ?? undefined)),
    fly: computed(() => makeStat(actor.value?.system?.movement?.speeds?.fly ?? undefined)),
    burrow: computed(() => makeStat(actor.value?.system?.movement?.speeds?.burrow ?? undefined))
  }
  const languages = computed(() => actor.value?.languages)

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
    languages
  }
}
