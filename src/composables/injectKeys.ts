import type { InjectionKey } from 'vue'
import type { Character } from '@/composables/character'

const characterKey = Symbol() as InjectionKey<Character>
export function useKeys() {
  return { characterKey }
}
