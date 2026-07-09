import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createReconnectPolicy } from '@/api/reconnectPolicy'

// The reconnect policy is the automatic-repair half of the connection
// machinery. These tests pin its two core guarantees — in-flight dedup (the
// several repair triggers must share one attempt, never stack teardowns) and
// the exponential backoff ladder — which no integration path exercises.

const SERVER = new URL('https://vtt.example.com/')

function makePolicy(overrides?: {
  activeUrl?: () => URL | undefined
  connect?: (url: URL) => Promise<unknown>
}) {
  const connect = overrides?.connect ?? vi.fn(() => Promise.resolve())
  const connectSpy = vi.isMockFunction(connect) ? connect : vi.fn(connect)
  const policy = createReconnectPolicy({
    activeUrl: overrides?.activeUrl ?? (() => SERVER),
    connect: connectSpy
  })
  return { policy, connect: connectSpy }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('requestReconnect', () => {
  it('shares an in-flight attempt instead of stacking teardowns', async () => {
    let resolveConnect!: () => void
    const { policy, connect } = makePolicy({
      connect: vi.fn(() => new Promise<void>((resolve) => (resolveConnect = resolve)))
    })

    const first = policy.requestReconnect()
    const second = policy.requestReconnect()
    expect(second).toBe(first)
    expect(connect).toHaveBeenCalledTimes(1)

    resolveConnect()
    await first

    // Once settled, a new request starts a fresh attempt.
    void policy.requestReconnect()
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('resolves immediately without connecting when no server is active', async () => {
    const { policy, connect } = makePolicy({ activeUrl: () => undefined })
    await expect(policy.requestReconnect()).resolves.toBeUndefined()
    expect(connect).not.toHaveBeenCalled()
  })

  it('never rejects — a failed automatic attempt is swallowed', async () => {
    const { policy } = makePolicy({
      connect: vi.fn(() => Promise.reject(new Error('unreachable')))
    })
    await expect(policy.requestReconnect()).resolves.toBeUndefined()
  })

  it('promotes a pending backoff retry to now and cancels its timer', async () => {
    const { policy, connect } = makePolicy()
    policy.scheduleRetry()
    await policy.requestReconnect()
    expect(connect).toHaveBeenCalledTimes(1)

    // The promoted retry's timer must be gone — no second attempt fires later.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connect).toHaveBeenCalledTimes(1)
  })
})

describe('scheduleRetry backoff', () => {
  it('doubles the delay per consecutive failure and caps at 15s', async () => {
    const { policy, connect } = makePolicy()
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]

    for (const [i, delay] of expectedDelays.entries()) {
      policy.scheduleRetry()
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(connect, `attempt ${i + 1} fired early`).toHaveBeenCalledTimes(i)
      await vi.advanceTimersByTimeAsync(1)
      expect(connect, `attempt ${i + 1} did not fire`).toHaveBeenCalledTimes(i + 1)
    }
  })

  it('is a no-op while a retry is already pending (single timer, single count)', async () => {
    const { policy, connect } = makePolicy()
    policy.scheduleRetry()
    policy.scheduleRetry()
    policy.scheduleRetry()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(1)

    // The redundant calls must not have advanced the ladder: the next
    // failure's delay is step two (2s), not step four.
    policy.scheduleRetry()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('skips the retry when the server was abandoned before it fired', async () => {
    let url: URL | undefined = SERVER
    const { policy, connect } = makePolicy({ activeUrl: () => url })
    policy.scheduleRetry()
    url = undefined
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).not.toHaveBeenCalled()
  })

  it('resetBackoff returns the next delay to the base', async () => {
    const { policy, connect } = makePolicy()
    policy.scheduleRetry()
    await vi.advanceTimersByTimeAsync(1_000)
    policy.scheduleRetry()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(connect).toHaveBeenCalledTimes(2)

    policy.resetBackoff()
    policy.scheduleRetry()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(3)
  })

  it('cancel clears the pending retry and resets the ladder', async () => {
    const { policy, connect } = makePolicy()
    policy.scheduleRetry()
    policy.cancel()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connect).not.toHaveBeenCalled()

    policy.scheduleRetry()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
