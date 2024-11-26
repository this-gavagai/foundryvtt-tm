import type { InjectionKey, Ref } from 'vue'
import type { Actor, World } from '@/types/pf2e-types'

const actorKey = Symbol() as InjectionKey<Actor | undefined>
const characterKey = Symbol() as any
export function useKeys() {
  return { actorKey, characterKey }
}
