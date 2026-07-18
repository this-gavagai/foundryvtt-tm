import type { Socket } from 'socket.io-client'

// The narrow set of store-backed lookups the api layer needs, injected at app
// bootstrap (composables/serverEventWiring.ts registers the real, Pinia-backed
// implementation). This inverts the four api → store imports that previously
// closed the api ⇄ store cycles: with them gone, api/ imports no store and the
// module graph is a DAG in that direction (stores → api is the one legal way).
//
// The payoff is testability: api modules can now be imported and exercised by
// registering a fake bridge, without spinning up Pinia or the network/timer
// side effects some stores run on first use(). See __tests__/storeBridge.spec.
//
// Reactive getters (sessionReady, userId) must read the underlying store refs
// so a `watch`/`computed` in the api layer still tracks them — the real
// implementation does exactly that, and Vue's dependency tracking flows
// through the plain function call.
export interface StoreBridge {
  getSocket: (timeoutMs?: number) => Promise<Socket>
  getUserId: () => string
  sessionReady: () => boolean
  userId: () => string
  getTargets: () => string[]
  isListening: () => boolean
  activeServerOrigin: () => string | undefined
}

let bridge: StoreBridge | undefined

export function registerStoreBridge(next: StoreBridge): void {
  bridge = next
}

// Test-only: drop the registered bridge so a following test starts clean.
export function resetStoreBridgeForTest(): void {
  bridge = undefined
}

export function requireStoreBridge(): StoreBridge {
  if (!bridge) {
    throw new Error(
      'API store bridge not registered — registerStoreBridge() must run at app ' +
        'bootstrap (registerServerEventWiring) before any RPC or socket access.'
    )
  }
  return bridge
}
