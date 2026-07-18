import { watch } from 'vue'
import type { Socket } from 'socket.io-client'
import { requireStoreBridge } from './storeBridge'

// Shared types used by document mutations and socket listeners.
export type ModifyDocumentUpdate = { _id: string; [key: string]: unknown }
export type DocumentData = { _id: string | null }

// Store access flows through the injected bridge (see storeBridge.ts) so this
// module — and the api layer above it — never imports Pinia directly.
export const getSocket = (timeoutMs?: number) => requireStoreBridge().getSocket(timeoutMs)
export const getUserId = () => requireStoreBridge().getUserId()

const SESSION_TIMEOUT_MS = 15_000

export function waitForAuthenticatedSession(timeoutMs = SESSION_TIMEOUT_MS): Promise<string> {
  const bridge = requireStoreBridge()
  if (bridge.sessionReady() && bridge.userId()) return Promise.resolve(bridge.userId())

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Foundry session not available'))
    }, timeoutMs)
    // The getters read the underlying store refs, so this watch tracks
    // sessionReady/userId exactly as the direct store access did.
    const stop = watch(
      () => [bridge.sessionReady(), bridge.userId()] as const,
      ([sessionReady, userId]) => {
        if (sessionReady && userId) {
          cleanup()
          resolve(userId)
        }
      }
    )

    function cleanup() {
      clearTimeout(timer)
      stop()
    }
  })
}

export async function getAuthenticatedSocket(): Promise<{ socket: Socket; userId: string }> {
  const userId = await waitForAuthenticatedSession()
  const socket = await getSocket()
  return { socket, userId }
}

// lodash mergeWith customizer: always replace arrays wholesale rather than
// merging element-by-element. Server-sent arrays are authoritative snapshots;
// positional merging leaves stale elements when items are deleted or reordered.
// The top-level `items` array is handled separately via ID-based merge in
// parseActorData, so this customizer only fires for nested arrays (system data,
// rules, traits, etc.) where full replacement is always the right behavior.
export function mergeWithArrayReset(_objValue: unknown, srcValue: unknown) {
  if (Array.isArray(srcValue)) return srcValue
}

// Foundry may hand us plain arrays or collection-like objects with a
// `contents` array. Socket update handlers need the mutable backing array,
// not the collection wrapper itself.
export function asDocumentArray(col: unknown): DocumentData[] | undefined {
  if (!col) return undefined
  if (Array.isArray(col)) return col as DocumentData[]
  if (
    typeof col === 'object' &&
    'contents' in col &&
    Array.isArray((col as { contents?: unknown }).contents)
  ) {
    return (col as { contents: DocumentData[] }).contents
  }
  return col as DocumentData[]
}
