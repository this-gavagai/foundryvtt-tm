import { inject, type InjectionKey } from 'vue'
import type { Character } from '@/composables/character'
import type { Familiar } from '@/composables/familiar'

export const characterKey = Symbol() as InjectionKey<Character>
export const familiarKey = Symbol() as InjectionKey<Familiar>

// TODO: merge these two key injection methods to a single model

export function useInjectedCharacter(): Character {
  const character = inject(characterKey)
  if (!character) {
    throw new Error('useInjectedCharacter() must be used inside a <CharacterSheet>')
  }
  return character
}

export function useInjectedFamiliar(): Familiar {
  const familiar = inject(familiarKey)
  if (!familiar) {
    throw new Error('useInjectedFamiliar() must be used inside a <FamiliarSheet>')
  }
  return familiar
}
