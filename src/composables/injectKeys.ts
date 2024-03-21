import type { InjectionKey, Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'

const actorKey = Symbol() as InjectionKey<Ref<Actor | undefined>>
const worldKey = Symbol() as InjectionKey<any>

export function useInjectKeys() {
  return { actorKey, worldKey }
}
