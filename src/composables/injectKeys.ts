import { inject, type InjectionKey } from 'vue'
import type { Actor } from '@/composables/actor'
import type { Character } from '@/composables/character'
import type { Familiar } from '@/composables/familiar'

// Every sheet provides actorKey; components shared across sheet types consume
// it. characterKey/familiarKey expose the full sheet-specific models and are
// only provided by their own sheet.
export const actorKey = Symbol() as InjectionKey<Actor>
export const characterKey = Symbol() as InjectionKey<Character>
export const familiarKey = Symbol() as InjectionKey<Familiar>

export function useInjectedActor(): Actor {
  const actor = inject(actorKey)
  if (!actor) {
    throw new Error('useInjectedActor() must be used inside a sheet that provides an actor')
  }
  return actor
}

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
