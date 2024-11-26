import type { InjectionKey, Ref } from 'vue'
import type { Actor, World } from '@/types/pf2e-types'
import type { CharacterRef } from '@/components/CharacterSheet.vue'

const actorKey = Symbol() as InjectionKey<CharacterRef<Actor | undefined>>
const characterKey = Symbol() as any
export function useKeys() {
  return { actorKey, characterKey }
}
