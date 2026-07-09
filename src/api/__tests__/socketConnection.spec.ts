import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Socket } from 'socket.io-client'
import { emitWithTimeout, emitWithRetries } from '@/api/socketConnection'

// Emit helpers underpin every ack-bearing request (getJoinData, the resume
// heartbeat). The retry helper's contract — re-acquire the CURRENT socket on
// every attempt — is what lets a retry land on a freshly established socket
// instead of hammering a dead one; pin it.

function ackingSocket(payload: unknown): Socket {
  return {
    id: 'live',
    connected: true,
    emit: (_event: string, cb: (data: unknown) => void) => cb(payload)
  } as unknown as Socket
}

function silentSocket(): Socket {
  return {
    id: 'dead',
    connected: true,
    emit: () => {}
  } as unknown as Socket
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('emitWithTimeout', () => {
  it('resolves with the ack payload', async () => {
    await expect(
      emitWithTimeout(ackingSocket({ ok: true }), 'getJoinData', 1_000)
    ).resolves.toEqual({ ok: true })
  })

  it('rejects once the timeout elapses with no ack', async () => {
    const pending = emitWithTimeout(silentSocket(), 'getJoinData', 1_000)
    const outcome = expect(pending).rejects.toThrow('getJoinData timed out')
    await vi.advanceTimersByTimeAsync(1_000)
    await outcome
  })
})

describe('emitWithRetries', () => {
  it('re-acquires the socket on every attempt and succeeds when a later socket acks', async () => {
    const sockets = [silentSocket(), silentSocket(), ackingSocket('world')]
    const getSocket = vi.fn(async () => sockets.shift()!)

    const pending = emitWithRetries(getSocket, 'getJoinData', 1_000, 3)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBe('world')
    expect(getSocket).toHaveBeenCalledTimes(3)
  })

  it('throws the last error after exhausting the attempt budget', async () => {
    const getSocket = vi.fn(async () => silentSocket())
    const pending = emitWithRetries(getSocket, 'getJoinData', 1_000, 2)
    const outcome = expect(pending).rejects.toThrow('getJoinData timed out')
    await vi.advanceTimersByTimeAsync(2_000)
    await outcome
    expect(getSocket).toHaveBeenCalledTimes(2)
  })

  it('surfaces socket-acquisition failures as the final error', async () => {
    const getSocket = vi.fn(async () => {
      throw new Error('Socket not available')
    })
    await expect(emitWithRetries(getSocket, 'getJoinData', 1_000, 2)).rejects.toThrow(
      'Socket not available'
    )
    expect(getSocket).toHaveBeenCalledTimes(2)
  })
})
