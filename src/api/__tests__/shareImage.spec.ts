import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Socket } from 'socket.io-client'

// Core's shareImage ("show players") is the one socket event whose subscribers
// are purely presentational, so the guard in the dispatcher is the only thing
// standing between a foreign/malformed broadcast and an empty popup over the
// sheet. Pin the guard, the fan-out, and the re-attach on a socket swap.

// One fake socket recording its handler registrations, so a test can fire an
// event the way socket.io would and assert what the swap path detached.
function fakeSocket(id: string) {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  const socket = {
    id,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(handler)
    }
  }
  return {
    socket: socket as Socket,
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach((h) => h(...args))
    },
    count(event: string) {
      return handlers.get(event)?.size ?? 0
    }
  }
}

let live: ReturnType<typeof fakeSocket>

vi.mock('@/api/internal', () => ({
  getSocket: () => Promise.resolve(live.socket)
}))

// socketSetup keeps the attached socket and the subscription registries at
// module level, so each test gets a fresh copy of the module.
async function freshSocketSetup() {
  vi.resetModules()
  return await import('@/api/socketSetup')
}

beforeEach(() => {
  live = fakeSocket('socket-1')
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('shareImage dispatcher', () => {
  it('hands the payload to every subscriber', async () => {
    const { onShareImage, setupSocketListenersForApp } = await freshSocketSetup()
    const first = vi.fn()
    const second = vi.fn()
    onShareImage(first)
    onShareImage(second)
    await setupSocketListenersForApp()

    const payload = {
      image: 'systems/pf2e/icons/iconics/portraits/seoni.webp',
      title: 'Seoni',
      caption: '',
      uuid: 'Actor.9F9cSYtkX9nY2q6h'
    }
    live.emit('shareImage', payload)

    expect(first).toHaveBeenCalledWith(payload)
    expect(second).toHaveBeenCalledWith(payload)
  })

  it('drops a payload with no image path', async () => {
    const { onShareImage, setupSocketListenersForApp } = await freshSocketSetup()
    const handler = vi.fn()
    onShareImage(handler)
    await setupSocketListenersForApp()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    live.emit('shareImage', { title: 'Seoni' })
    live.emit('shareImage', { image: '' })
    live.emit('shareImage', undefined)

    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps one throwing subscriber from starving the others', async () => {
    const { onShareImage, setupSocketListenersForApp } = await freshSocketSetup()
    const later = vi.fn()
    onShareImage(() => {
      throw new Error('boom')
    })
    onShareImage(later)
    await setupSocketListenersForApp()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    live.emit('shareImage', { image: 'a.webp' })

    expect(later).toHaveBeenCalledOnce()
  })

  it('follows a socket swap: detaches the old socket, fires on the new one', async () => {
    const { onShareImage, setupSocketListenersForApp } = await freshSocketSetup()
    const handler = vi.fn()
    onShareImage(handler)
    await setupSocketListenersForApp()

    const stale = live
    live = fakeSocket('socket-2')
    await setupSocketListenersForApp()

    expect(stale.count('shareImage')).toBe(0)
    live.emit('shareImage', { image: 'a.webp' })
    expect(handler).toHaveBeenCalledOnce()
  })
})
