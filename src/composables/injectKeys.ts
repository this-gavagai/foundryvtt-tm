import type { InjectionKey, Ref } from 'vue'
import type { Actor, World } from '@/types/pf2e-types'
import type { CharacterRef } from '@/components/Character.vue'

const actorKey = Symbol() as InjectionKey<CharacterRef<Actor | undefined>>

export function useKeys() {
  return { actorKey }
}
