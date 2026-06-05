import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

// Shared types used by document mutations and socket listeners.
export type ModifyDocumentUpdate = { _id: string; [key: string]: unknown }
export type DocumentData = { _id: string | null }

export const getSocket = () => useServerStore().getSocket()
export const getUserId = () => useUserStore().getUserId()

// lodash mergeWith customizer: always replace arrays wholesale rather than
// merging element-by-element. Server-sent arrays are authoritative snapshots;
// positional merging leaves stale elements when items are deleted or reordered.
// The top-level `items` array is handled separately via ID-based merge in
// parseActorData, so this customizer only fires for nested arrays (system data,
// rules, traits, etc.) where full replacement is always the right behavior.
export function mergeWithArrayReset(_objValue: unknown, srcValue: unknown) {
  if (Array.isArray(srcValue)) return srcValue
}
