import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

// Shared types used by document mutations and socket listeners.
export type ModifyDocumentUpdate = { _id: string; [key: string]: unknown }
export type DocumentData = { _id: string | null }

export const getSocket = () => useServerStore().getSocket()
export const getUserId = () => useUserStore().getUserId()

// lodash mergeWith customizer: when an incoming array is shorter than the
// existing one, replace wholesale instead of element-wise merging (which
// would leave stale tail elements).
export function mergeWithArrayReset(objValue: unknown, srcValue: unknown) {
  if (Array.isArray(srcValue) && Array.isArray(objValue) && srcValue.length < objValue.length) {
    logger.warn('TM-WARN: nuking array due to length mismatch', objValue, srcValue)
    return srcValue
  }
}
