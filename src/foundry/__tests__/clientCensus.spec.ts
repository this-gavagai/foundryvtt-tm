import { describe, it, expect, beforeEach } from 'vitest'
import {
  FOUNDRY_CLIENT_TTL_MS,
  forgetClient,
  hasFoundryClient,
  isTabulaOnlyClient,
  noteAppClient,
  noteFoundryClient,
  resetClientCensusForTest
} from '@/foundry/clientCensus'

// One user can hold several Foundry sockets at once, so `user.active` says
// "somebody is connected as this id" and nothing about what they are connected
// FROM. The census recovers the missing half, and the handler election spends it:
// a GM whose only client is Tabula has nothing behind their id that can answer a
// request, and electing them means the table waits forever.

const ALICE = 'alice'
const NOW = 1_700_000_000_000

beforeEach(resetClientCensusForTest)

describe('isTabulaOnlyClient', () => {
  it('knows nothing about a user it has never heard from', () => {
    // The safe default, and the one every client starts a session with: no
    // evidence means no exclusion, which is exactly how the election behaved
    // before there was a census at all.
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(false)
    expect(isTabulaOnlyClient(undefined, NOW)).toBe(false)
  })

  it('excludes a user whose only client is the app', () => {
    noteAppClient(ALICE)
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(true)
  })

  it('leaves a Foundry client alone, however much it talks', () => {
    noteFoundryClient(ALICE, NOW)
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(false)
  })

  it('keeps a user signed in to both, because one of them can answer', () => {
    // A GM with Foundry open on a laptop and Tabula open on a phone. Excluding
    // them would be worse than the bug this file fixes: with a second GM at the
    // table both clients would think themselves elected and every request would
    // execute twice.
    noteAppClient(ALICE)
    noteFoundryClient(ALICE, NOW)
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(false)
  })

  it('drops that Foundry client once its beat stops', () => {
    // The case nothing else retracts: the laptop tab is closed while the phone
    // stays signed in, so the user never goes inactive and the app mark stands.
    noteAppClient(ALICE)
    noteFoundryClient(ALICE, NOW)
    expect(isTabulaOnlyClient(ALICE, NOW + FOUNDRY_CLIENT_TTL_MS)).toBe(false)
    expect(isTabulaOnlyClient(ALICE, NOW + FOUNDRY_CLIENT_TTL_MS + 1)).toBe(true)
  })

  it('re-admits a GM the moment their Foundry client says anything', () => {
    noteAppClient(ALICE)
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(true)
    noteFoundryClient(ALICE, NOW)
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(false)
  })

  it('never expires the app mark on its own', () => {
    // A locked phone runs no timers, so its heartbeat stops while its socket
    // stays up. A TTL here would quietly re-elect the phantom the census exists
    // to keep out; only a disconnect retracts this.
    noteAppClient(ALICE)
    expect(isTabulaOnlyClient(ALICE, NOW + 24 * 60 * 60 * 1000)).toBe(true)
  })
})

describe('forgetClient', () => {
  it('forgets both facts, so the next session is judged on its own evidence', () => {
    noteAppClient(ALICE)
    noteFoundryClient(ALICE, NOW)
    forgetClient(ALICE)
    expect(hasFoundryClient(ALICE, NOW)).toBe(false)
    // The GM who was in Tabula this afternoon and opens Foundry tonight.
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(false)
  })

  it('ignores a missing id rather than clearing anything', () => {
    noteAppClient(ALICE)
    forgetClient(undefined)
    expect(isTabulaOnlyClient(ALICE, NOW)).toBe(true)
  })
})

describe('hasFoundryClient', () => {
  it('counts a client for a full TTL and not a millisecond longer', () => {
    noteFoundryClient(ALICE, NOW)
    expect(hasFoundryClient(ALICE, NOW + FOUNDRY_CLIENT_TTL_MS)).toBe(true)
    expect(hasFoundryClient(ALICE, NOW + FOUNDRY_CLIENT_TTL_MS + 1)).toBe(false)
  })

  it('survives the throttling a backgrounded tab does to its own beat', () => {
    // Browsers cut a background tab's timers to roughly one a minute. The TTL is
    // four beats precisely so a throttled client is not mistaken for a departed
    // one — being late here costs a request nobody answers.
    expect(FOUNDRY_CLIENT_TTL_MS).toBeGreaterThanOrEqual(2 * 60_000)
  })
})
