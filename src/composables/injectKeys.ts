// implement injection keys for world and actor
import type { InjectionKey, Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { CharacterRef } from '@/components/Character.vue'

const actorKey = Symbol() as InjectionKey<CharacterRef<Actor | undefined>>
const worldKey = Symbol() as InjectionKey<any>

export function useKeys() {
  return { actorKey, worldKey }
}
