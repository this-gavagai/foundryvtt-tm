import { inject, type InjectionKey } from 'vue'
import type { Character } from '@/composables/character'

export const characterKey = Symbol() as InjectionKey<Character>

export function useInjectedCharacter(): Character {
  const character = inject(characterKey)
  if (!character) {
    throw new Error('useInjectedCharacter() must be used inside a <CharacterSheet>')
  }
  return character
}
