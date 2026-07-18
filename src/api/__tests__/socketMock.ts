import { expect, type Mock } from 'vitest'
import type { Socket } from 'socket.io-client'
import type { StoreBridge } from '@/api/storeBridge'
import { TM } from '@/api/protocol'

// Shared emit-capture helpers for specs that drive the RPC layer. The `emit`
// spy and the `vi.mock('@/api/internal', …)` that installs it must stay inline
// in each spec: vi.mock is hoisted above imports, so its factory can only
// reference `vi.hoisted` values, never a helper imported from here (that
// binding is still in the temporal dead zone when the factory is defined).
// These runtime helpers, called well after imports resolve, are safe to share.

// sendAction / sendCharacterRequest await the (already-resolved) authenticated
// socket before emitting, so the emit lands a few microtasks after the call —
// flush without relying on timers, which some tests fake.
export async function flushMicrotasks(ticks = 5) {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

// uuid off the most recent emit on TM.CHANNEL.
export function lastEmittedUuid(emit: Mock): string {
  const call = emit.mock.calls.at(-1)
  expect(call, 'expected an RPC to have been emitted').toBeDefined()
  expect(call![0]).toBe(TM.CHANNEL)
  return (call![1] as { uuid: string }).uuid
}

// A fully-synthetic StoreBridge for api-layer tests — the whole point of the
// bridge is that the api layer needs no Pinia, so tests inject plain values
// here instead of standing up stores. Override just the fields a test cares
// about; the rest return inert defaults.
export function fakeStoreBridge(overrides: Partial<StoreBridge> = {}): StoreBridge {
  return {
    getSocket: async () => ({ emit: () => {} }) as unknown as Socket,
    getUserId: () => 'user-1',
    sessionReady: () => true,
    userId: () => 'user-1',
    getTargets: () => [],
    isListening: () => false,
    activeServerOrigin: () => 'https://vtt.example.com',
    ...overrides
  }
}
