import type { Ref } from 'vue'
import { useDerivedStatistics } from './derivedStatistics'
import type { MovementType } from '@/utils/ruleEngine/movement'
import { computed } from 'vue'
import type {
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
import { tokenPortrait, type PortraitRing } from '@/utils/tokenPortrait'
import { useWorldLabels } from '@/composables/useWorldLabels'

export interface CharacterCore {
  // Live underlying PF2e actor — escape hatch for code that needs prototype
  // getters (abilities, attributes, …) the curated Fields above flatten away.
  // Used by ParsedDescription to resolve `@actor.foo` paths in inline rolls.
  _actor: Ref<TablemateCharacter | undefined>
  _id: Field<string>
  name: Field<string>
  portraitUrl: Field<string>
  portraitScaleX: Field<number>
  portraitScaleY: Field<number>
  portraitRing: Field<PortraitRing>
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
  rollOptionLabels: Field<Record<string, string>>
  traitLabels: Field<Record<string, string>>
}

export function useCharacterCore(actor: Ref<TablemateCharacter | undefined>): CharacterCore {
  const _id = computed(() => actor.value?._id ?? undefined)
  const name = computed(() => actor.value?.name)
  const portrait = computed(() => tokenPortrait(actor.value?.prototypeToken))
  const portraitUrl = computed(() => portrait.value.url)
  const portraitScaleX = computed(() => portrait.value.scaleX)
  const portraitScaleY = computed(() => portrait.value.scaleY)
  const portraitRing = computed(() => portrait.value.ring)

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
        // Fire-and-forget: recovery (refresh + rethrow) happens in updateActor.
        updateActor(actor, update).catch(() => {})
      }
    }),
    max: computed(() => actor.value?.system?.details?.xp?.max)
  }
  // Speeds are prepared data and absent from a world dump entirely — PF2e
  // writes `system.movement` during preparation, taking land from the ancestry
  // item. So without a GM the whole panel was blank, including the one figure
  // every character has.
  const derived = useDerivedStatistics(actor)
  const speed = (type: MovementType) =>
    computed(() => {
      const reported = actor.value?.system?.movement?.speeds?.[type]
      if (reported) return makeStat(reported)
      const engine = derived.speed(type)
      // `null` is the engine saying this character has no such speed, which is
      // an answer. `undefined` is it having none to give.
      if (!engine) return undefined
      const stat = makeStat({ slug: type, value: engine.value })
      // `provisional` and `caveat` are not inputs to makeStat — they describe
      // where a figure came from, which only the caller knows.
      return stat && { ...stat, provisional: engine.provisional, caveat: engine.caveat }
    })
  const movement = {
    land: speed('land'),
    swim: speed('swim'),
    climb: speed('climb'),
    fly: speed('fly'),
    burrow: speed('burrow')
  }
  // Labels come from the world catalog, not the actor — so a sheet painted from
  // the world dump alone still names its traits and languages. See
  // composables/useWorldLabels.
  const { languages, rollOptionLabels, traitLabels } = useWorldLabels(actor)

  return {
    _actor: actor,
    _id,
    name,
    portraitUrl,
    portraitScaleX,
    portraitScaleY,
    portraitRing,
    ancestry,
    background,
    heritage,
    classType,
    level,
    xp,
    movement,
    languages,
    rollOptionLabels,
    traitLabels
  }
}
