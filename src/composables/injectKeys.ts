// implement injection keys for world and actor
import type { InjectionKey, Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'

const actorKey = Symbol() as InjectionKey<Ref<Actor | undefined>>
const worldKey = Symbol() as InjectionKey<any>

export function useInjectKeys() {
  return { actorKey, worldKey }
}
