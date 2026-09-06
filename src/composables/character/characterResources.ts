import { computed, type Ref } from 'vue'
import { useDerivedModifiers } from './derivedModifiers'
import type { RawModifier } from '@7h3laughingman/pf2e-types'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import { type Modifier, makeModifiers } from './defs/modifier'
import { updateActor } from '@/api/documents'
import { setHitPoints, type HitPointTarget } from '@/composables/setHitPoints'
import { useDerivedStatistics } from './derivedStatistics'
import type { TablemateCharacter } from '@/types/character-types'

export interface CharacterResources {
  hp: {
    current: Field<number>
    max: Field<number>
    maxProvisional: Field<boolean>
    temp: Field<number>
    modifiers: Field<Modifier[]>
    // Hit points are written through one combined call rather than per-field
    // setters: the change is handed to the GM's client so the preUpdateActor
    // hooks that drive condition automation run, and they have to see the whole
    // edit at once. See composables/setHitPoints.ts.
    set: (target: HitPointTarget) => Promise<unknown>
  }
  heroPoints: {
    current: WritableField<number>
    max: Field<number>
  }
  focusPoints: {
    current: WritableField<number>
    max: Field<number>
    maxProvisional: Field<boolean>
    maxCaveat: Field<string | undefined>
  }
}

export function useCharacterResources(actor: Ref<CharacterPF2e | undefined>): CharacterResources {
  // Maximum hit points, for the sheet no GM has answered for. `value` and `temp`
  // are stored and need nothing; `max` is derived, and PF2e's answer wins
  // whenever the payload carries one.
  const derived = useDerivedStatistics(actor as Ref<TablemateCharacter | undefined>)
  const derivedModifiers = useDerivedModifiers()
  const hp = {
    current: computed(() => actor.value?.system?.attributes?.hp?.value),
    max: computed(
      () => actor.value?.system?.attributes?.hp?.max ?? derived.hitPointsMax.value?.value
    ),
    // Whether the maximum on screen is the engine's, with gaps.
    maxProvisional: computed(
      () =>
        actor.value?.system?.attributes?.hp?.max === undefined &&
        !!derived.hitPointsMax.value?.provisional
    ),
    temp: computed(() => actor.value?.system?.attributes?.hp?.temp),
    // `_modifiers`, with the underscore, is what actually survives.
    //
    // PF2e's HitPointsStatistic keeps the list in a PROTECTED field, so JSON
    // serialization captures `_modifiers` and there is no `modifiers` on the
    // wire at all. Reading the public name meant this was `undefined` on every
    // character, with a GM online — not a GM dependency, a silent miss. The
    // strike serializer already accepts both for the same reason
    // (foundry/handlers/checks/strikeCheckHandlers.ts).
    modifiers: computed(() => {
      const hp = actor.value?.system?.attributes?.hp as
        { modifiers?: RawModifier[]; _modifiers?: RawModifier[] } | undefined
      const reported = hp?.modifiers ?? hp?._modifiers
      if (reported) return makeModifiers(reported)
      return derivedModifiers.present(derived.hitPointsMax.value?.modifiers)
    }),
    set: (target: HitPointTarget) => setHitPoints(actor, target)
  }
  const heroPoints = {
    current: computed({
      get: () => actor.value?.system?.resources?.heroPoints?.value,
      set: (newValue) => {
        actor.value!.system.resources.heroPoints.value = newValue!
        const update = { system: { resources: { heroPoints: { value: newValue } } } }
        updateActor(actor, update).catch(() => {})
      }
    }),
    max: computed(() => actor.value?.system?.resources?.heroPoints?.max)
  }
  const focusPoints = {
    current: computed({
      get: () => actor.value?.system?.resources?.focus?.value,
      set: (newValue) => {
        actor.value!.system.resources.focus.value = newValue!
        const update = { system: { resources: { focus: { value: newValue } } } }
        updateActor(actor, update).catch(() => {})
      }
    }),
    // Never stored: PF2e resets the maximum to zero in `prepareBaseData` and
    // rebuilds it by counting the character's focus spells, so a world dump has
    // nothing to read and the engine has to count them the same way.
    max: computed(
      () => actor.value?.system?.resources?.focus?.max ?? derived.focusPoolMax.value?.value
    ),
    maxProvisional: computed(
      () =>
        actor.value?.system?.resources?.focus?.max === undefined &&
        !!derived.focusPoolMax.value?.provisional
    ),
    maxCaveat: computed(() =>
      actor.value?.system?.resources?.focus?.max === undefined
        ? derived.focusPoolMax.value?.caveat
        : undefined
    )
  }

  return {
    hp,
    heroPoints,
    focusPoints
  }
}
