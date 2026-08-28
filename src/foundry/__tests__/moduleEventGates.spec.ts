import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TM, TM_ERROR_MANUAL_ROLLS_DISABLED, TM_ERROR_UNAUTHORIZED } from '@/api/protocol'
import type { ManualRollPolicy, ModuleEventArgs } from '@/types/api-types'
import type { ActorLike, AuthRequirement, AuthWorld } from '@/foundry/rpcAuthorize'

// Every inbound module message runs a fixed sequence of gates before anything
// executes: character requests, then acks, then the targets request, then the
// responder election, then the handler table, then authorization, then the
// manual-roll policy. Each gate's PLACE in that order is load-bearing, and the
// reasoning for it lives in comments beside it — three gates deliberately sit
// ahead of the responder election, and authorization deliberately sits ahead of
// the policy check.
//
// None of it was reachable until the loop was lifted out of setupListener: the
// specs in this directory cover the pieces it calls (rpcTable, rpcAuthorize,
// requestDedup, gmHandlerSetting) and nothing covered how they compose.

// The table is faked so these tests are about the ORDER of the gates, not about
// which auth a given action carries — rpcTable.spec.ts already pins that, entry
// by entry, and a real descriptor here would drag a live Foundry handler in.
let table: Record<
  string,
  { handler: (a: ModuleEventArgs) => Promise<unknown>; auth: AuthRequirement; concurrent?: true }
> = {}
const PASSIVE = new Set<string>(['tm.passiveAction'])

vi.mock('@/foundry/rpcTable', () => ({
  PASSIVE_ACTIONS: PASSIVE,
  rpcDescriptor: (action: string) => table[action]
}))

const { handleModuleEvent, resetDispatchChainForTest } = await import('@/foundry/listener')
const { markRequestSeen, requestAlreadySeen, resetRequestDedupForTest } =
  await import('@/foundry/requestDedup')
const { resetChatOriginForTest } = await import('@/foundry/chatOrigin')

const OWNER = 3
const GM = 'gm-1'

// One player who owns one actor — enough for the 'owner' gate to say yes or no.
const world: AuthWorld = {
  users: {
    get: (id: string) => (id === 'player-1' || id === GM ? { isGM: id === GM } : undefined)
  },
  actors: {
    get: (id: string) =>
      id === 'actor-1' ? ({ ownership: { 'player-1': OWNER } } as unknown as ActorLike) : undefined
  }
}

type Deps = Parameters<typeof handleModuleEvent>[1]

function makeDeps(over: Partial<Deps> = {}): Deps & { emit: ReturnType<typeof vi.fn> } {
  return {
    world: () => world,
    selfUserId: () => GM,
    emit: vi.fn(),
    isResponder: () => true,
    manualRollPolicy: (): ManualRollPolicy => 'allow',
    onCharacterRequest: vi.fn(),
    onAnybodyHome: vi.fn(),
    onRequestTargets: vi.fn(),
    ...over
  } as Deps & { emit: ReturnType<typeof vi.fn> }
}

function event(over: Record<string, unknown>): ModuleEventArgs {
  return { userId: 'player-1', ...over } as ModuleEventArgs
}

// Let the dispatch chain's promise hops run.
async function settle(ticks = 12) {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

// The error string off an emitted ack, if the emit was one.
function emittedError(emit: ReturnType<typeof vi.fn>): string | undefined {
  return (emit.mock.calls[0]?.[0] as { error?: string } | undefined)?.error
}

beforeEach(() => {
  vi.clearAllMocks()
  table = {}
  resetDispatchChainForTest()
  resetRequestDedupForTest()
  resetChatOriginForTest()
  // The one Foundry global still reached from this path: error acks are built
  // through makeAck so they share the success acks' shape, and makeAck reads the
  // answering client's id off `game`. Stood up the same way reactions.spec.ts
  // and voiceMemo.spec.ts do, rather than reshaping a helper thirty handlers use.
  ;(globalThis as Record<string, unknown>).game = { user: { _id: GM, id: GM } }
})

describe('gates that run before the responder election', () => {
  // A character refresh is answered by the elected GM too, but through its own
  // debounced per-actor path rather than the handler table.
  it('routes a character request to its own path', () => {
    const deps = makeDeps()
    handleModuleEvent(event({ action: TM.REQUEST_CHARACTER, actorId: 'actor-1' }), deps)
    expect(deps.onCharacterRequest).toHaveBeenCalledTimes(1)
    expect(deps.emit).not.toHaveBeenCalled()
  })

  // The reason acks are observed first: a client that is NOT the elected
  // responder still has to hear another client's ack, because that is what stops
  // two GMs mid-election from both executing the same request.
  it('records an ack even on a client that answers nothing', () => {
    handleModuleEvent(
      event({ action: TM.ACK, uuid: 'req-1' }),
      makeDeps({ isResponder: () => false })
    )
    expect(requestAlreadySeen('req-1')).toBe(true)
  })

  // Targets are answered by the client the request NAMES, not by the elected GM:
  // only the targeting client's own canvas holds its placed tokens.
  it('answers a targets request aimed at this client, elected or not', () => {
    const deps = makeDeps({ isResponder: () => false })
    handleModuleEvent(event({ action: TM.REQUEST_TARGETS, proxyId: GM }), deps)
    expect(deps.onRequestTargets).toHaveBeenCalledTimes(1)
  })

  it('ignores a targets request aimed at a different client', () => {
    const deps = makeDeps()
    handleModuleEvent(event({ action: TM.REQUEST_TARGETS, proxyId: 'someone-else' }), deps)
    expect(deps.onRequestTargets).not.toHaveBeenCalled()
  })

  it('answers nothing else when this client is not the elected responder', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    table['tm.doThing'] = { handler, auth: 'world-user' }
    const deps = makeDeps({ isResponder: () => false })

    handleModuleEvent(event({ action: 'tm.doThing', uuid: 'req-1' }), deps)
    await settle()

    expect(handler).not.toHaveBeenCalled()
    expect(deps.emit).not.toHaveBeenCalled()
  })
})

describe('the handler table gate', () => {
  // An app newer than the module asks for something this side has never heard
  // of. Answering names the cause; dropping leaves the app to time out.
  it('answers an unknown action with a cause rather than silence', () => {
    const deps = makeDeps()
    handleModuleEvent(event({ action: 'tm.fromTheFuture', uuid: 'req-1' }), deps)
    expect(emittedError(deps.emit)).toBe('unsupported action: tm.fromTheFuture')
  })

  // An action this side only ever SENDS, seen on the wire. Not a request.
  it('observes a passive action silently', () => {
    const deps = makeDeps()
    handleModuleEvent(event({ action: 'tm.passiveAction', uuid: 'req-1' }), deps)
    expect(deps.emit).not.toHaveBeenCalled()
  })

  // With no uuid there is nothing to correlate an ack to, so the refusal is
  // log-only rather than an emit into the void.
  it('does not answer a refusal it cannot correlate', () => {
    const deps = makeDeps()
    handleModuleEvent(event({ action: 'tm.fromTheFuture' }), deps)
    expect(deps.emit).not.toHaveBeenCalled()
  })
})

describe('authorization and the manual-roll policy, in that order', () => {
  it('answers an unauthorized request instead of dropping it', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    table['tm.rollCheck'] = { handler, auth: 'owner' }
    const deps = makeDeps()

    // player-2 owns nothing.
    handleModuleEvent(
      event({ action: 'tm.rollCheck', userId: 'player-2', actorId: 'actor-1', uuid: 'req-1' }),
      deps
    )
    await settle()

    expect(handler).not.toHaveBeenCalled()
    expect(emittedError(deps.emit)).toBe(TM_ERROR_UNAUTHORIZED)
  })

  // The ordering itself. A request that is BOTH unauthorized and carrying preset
  // dice must be refused as unauthorized: the policy gate exists to govern
  // rolls this user is entitled to make, and reporting it the other way round
  // would tell an intruder the world's dice policy instead of refusing them.
  it('refuses an unauthorized request before it consults the dice policy', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    table['tm.rollCheck'] = { handler, auth: 'owner' }
    const policy = vi.fn((): ManualRollPolicy => 'reject')
    const deps = makeDeps({ manualRollPolicy: policy })

    handleModuleEvent(
      event({
        action: 'tm.rollCheck',
        userId: 'player-2',
        actorId: 'actor-1',
        uuid: 'req-1',
        diceResults: { d20: [17] }
      }),
      deps
    )
    await settle()

    expect(emittedError(deps.emit)).toBe(TM_ERROR_UNAUTHORIZED)
    expect(policy).not.toHaveBeenCalled()
  })

  it('refuses player-chosen dice when the world rejects them', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    table['tm.rollCheck'] = { handler, auth: 'owner' }
    const deps = makeDeps({ manualRollPolicy: () => 'reject' })

    handleModuleEvent(
      event({
        action: 'tm.rollCheck',
        actorId: 'actor-1',
        uuid: 'req-1',
        diceResults: { d20: [20] }
      }),
      deps
    )
    await settle()

    expect(handler).not.toHaveBeenCalled()
    expect(emittedError(deps.emit)).toBe(TM_ERROR_MANUAL_ROLLS_DISABLED)
  })

  // A 'reject' world still rolls normally — the policy governs payloads that
  // carry faces, not every roll.
  it('leaves a roll with no chosen faces alone in a rejecting world', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    table['tm.rollCheck'] = { handler, auth: 'owner' }
    const policy = vi.fn((): ManualRollPolicy => 'reject')
    const deps = makeDeps({ manualRollPolicy: policy })

    handleModuleEvent(event({ action: 'tm.rollCheck', actorId: 'actor-1', uuid: 'req-1' }), deps)
    await settle()

    expect(policy).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('dispatch', () => {
  it('answers a serialized request with its handler’s result', async () => {
    const handler = vi.fn(async () => ({ ok: true, uuid: 'req-1' }))
    table['tm.rollCheck'] = { handler, auth: 'owner' }
    const deps = makeDeps()

    handleModuleEvent(event({ action: 'tm.rollCheck', actorId: 'actor-1', uuid: 'req-1' }), deps)
    await settle()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(deps.emit).toHaveBeenCalledWith({ ok: true, uuid: 'req-1' })
  })

  // A thrown handler becomes an error ack, and — the reason for the terminal
  // catches — must not poison the chain for everything queued behind it.
  it('turns a thrown handler into an ack without stalling the queue', async () => {
    table['tm.boom'] = {
      handler: vi.fn(async () => {
        throw new Error('handler exploded')
      }),
      auth: 'world-user'
    }
    const after = vi.fn(async () => ({ ok: true }))
    table['tm.after'] = { handler: after, auth: 'world-user' }
    const deps = makeDeps()

    handleModuleEvent(event({ action: 'tm.boom', uuid: 'req-1' }), deps)
    handleModuleEvent(event({ action: 'tm.after', uuid: 'req-2' }), deps)
    await settle(30)

    expect(emittedError(deps.emit)).toBe('handler exploded')
    expect(after).toHaveBeenCalledTimes(1)
  })

  // Dedup happens at EXECUTION time, not receive time: the queue wait is exactly
  // the window in which a competing client's ack can land.
  it('skips a queued request another client answered while it waited', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    table['tm.rollCheck'] = { handler, auth: 'owner' }
    const deps = makeDeps()

    markRequestSeen('req-1')
    handleModuleEvent(event({ action: 'tm.rollCheck', actorId: 'actor-1', uuid: 'req-1' }), deps)
    await settle()

    expect(handler).not.toHaveBeenCalled()
    expect(deps.emit).not.toHaveBeenCalled()
  })

  // Concurrent actions skip the chain entirely, so a multi-second compendium
  // fetch cannot delay a queued attack roll.
  it('runs a concurrent action without joining the chain', async () => {
    let releaseSerialized!: () => void
    table['tm.slow'] = {
      handler: () => new Promise((resolve) => (releaseSerialized = () => resolve({ ok: true }))),
      auth: 'world-user'
    }
    const fast = vi.fn(async () => ({ ok: true, fast: true }))
    table['tm.compendium'] = { handler: fast, auth: 'world-user', concurrent: true }
    const deps = makeDeps()

    handleModuleEvent(event({ action: 'tm.slow', uuid: 'req-1' }), deps)
    handleModuleEvent(event({ action: 'tm.compendium', uuid: 'req-2' }), deps)
    await settle()

    // The chain is still blocked on tm.slow, and the compendium fetch has
    // already answered.
    expect(fast).toHaveBeenCalledTimes(1)
    releaseSerialized()
    await settle()
  })
})
