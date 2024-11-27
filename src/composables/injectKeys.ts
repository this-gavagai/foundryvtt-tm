import type { InjectionKey, Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Character } from '@/composables/character'

const actorKey = Symbol() as InjectionKey<Ref<Actor | undefined>>
const characterKey = Symbol() as InjectionKey<Character>
export function useKeys() {
  return { actorKey, characterKey }
}
