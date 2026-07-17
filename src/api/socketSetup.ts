import type { Socket } from 'socket.io-client'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { ModuleEventArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getSocket } from './internal'
import { resolveAck } from './actionRpc'
import { TM } from './protocol'

// Socket event infrastructure only: module-level subscription registries plus
// the per-socket dispatcher attachment. Handlers that drive app state (stores,
// world refreshes) live in composables/serverEventWiring.ts — this file faces
// strictly downward so api/ never reaches up into Pinia.

// ── TM.CHANNEL dispatcher ────────────────────────────────────────────────
// One socket listener owns TM.CHANNEL; everyone else registers handlers via
// onTmAction(action, handler). Multiple handlers can subscribe to the same
// action — they all fire in registration order. Returned cleanup removes
// the subscription without touching the socket.

type TmHandler<K extends ModuleEventArgs['action']> = (
  args: Extract<ModuleEventArgs, { action: K }>
) => void
type AnyTmHandler = (args: ModuleEventArgs) => void

// Handlers are stored under a widened type because a mapped object type can't
// accept assignment when the key is a generic. The dispatcher always invokes
// each handler with args matching its registered action, so the cast at the
// insertion boundary is sound at runtime.
const tmSubs = new Map<string, Set<AnyTmHandler>>()

export function onTmAction<K extends ModuleEventArgs['action']>(
  action: K,
  handler: TmHandler<K>
): () => void {
  let set = tmSubs.get(action)
  if (!set) {
    set = new Set()
    tmSubs.set(action, set)
  }
  const h = handler as AnyTmHandler
  set.add(h)
  return () => {
    set!.delete(h)
  }
}

// ── modifyDocument dispatcher ────────────────────────────────────────────
// Per-actor and world-level handlers live in a module-level registry that
// survives socket swaps, and one socket listener (re-attached on every swap
// by setupSocketListenersForApp) fans events out. Binding listeners directly
// to a captured socket left them attached to a dead socket after any
// reconnect, silently dropping incremental GM edits until the sheet remounted.

export type ModifyDocumentHandler = (args: DocumentSocketResponse) => void

const modifySubs = new Set<ModifyDocumentHandler>()

export function onModifyDocument(handler: ModifyDocumentHandler): () => void {
  modifySubs.add(handler)
  return () => {
    modifySubs.delete(handler)
  }
}

// ── userActivity dispatcher ──────────────────────────────────────────────

export type UserActivityHandler = (
  user: string,
  args: { targets?: string[]; active?: boolean }
) => void

const userActivitySubs = new Set<UserActivityHandler>()

export function onUserActivity(handler: UserActivityHandler): () => void {
  userActivitySubs.add(handler)
  return () => {
    userActivitySubs.delete(handler)
  }
}

// ── world-load progress dispatcher ───────────────────────────────────────
// Foundry streams 'progress' events while a world loads; the wiring layer
// subscribes to mark the world pending and refresh on the trailing edge.

const progressSubs = new Set<() => void>()

export function onWorldProgress(handler: () => void): () => void {
  progressSubs.add(handler)
  return () => {
    progressSubs.delete(handler)
  }
}

// ── socket-swap notification ─────────────────────────────────────────────
// Fired when the dispatchers are re-attached after a previous socket existed
// (server switch, requestReconnect). Lets subscribers drop work armed against
// the old socket — e.g. the wiring's pending world-progress refresh, which is
// stale once the world context changes under a hard swap.

const socketSwapSubs = new Set<() => void>()

export function onSocketSwap(handler: () => void): () => void {
  socketSwapSubs.add(handler)
  return () => {
    socketSwapSubs.delete(handler)
  }
}

// Isolate every fan-out call: one throwing subscriber must not starve the
// later-registered handlers for the same event (or blow up inside socket.io's
// emitter). A throw becomes a logged drop for that handler only.
function guarded(run: () => void) {
  try {
    run()
  } catch (error) {
    logger.error('TM-ERROR: socket event handler threw', error)
  }
}

let attachedSocket: Socket | null = null
let tmDispatch: ((args: ModuleEventArgs) => void) | null = null
let modifyDispatch: ModifyDocumentHandler | null = null
let userActivityDispatch: UserActivityHandler | null = null
let progressDispatch: (() => void) | null = null
let coreSubsRegistered = false

// Re-attach the dispatchers to the (potentially new) socket. The subscription
// registries are module-level and survive socket swaps, so this is the only
// per-socket work: everything else registers once and stays live.
export async function setupSocketListenersForApp() {
  const socket = await getSocket()

  if (attachedSocket) {
    if (tmDispatch) attachedSocket.off(TM.CHANNEL, tmDispatch)
    if (modifyDispatch) attachedSocket.off('modifyDocument', modifyDispatch)
    if (userActivityDispatch) attachedSocket.off('userActivity', userActivityDispatch)
    if (progressDispatch) attachedSocket.off('progress', progressDispatch)
    // Deliberately NOT flushing the RPC ack queue here: acks are uuid-keyed
    // broadcasts on the world module channel, so a request emitted before a
    // same-server reconnect is often still answered on the replacement
    // socket — rejecting it would show a false failure for a mutation that
    // succeeded (and invite a double-cast retry). Pending RPCs are flushed
    // only when the active server actually changes (stores/serverAddress),
    // where no ack can ever arrive; otherwise the 30s timeout is the backstop.
    socketSwapSubs.forEach((h) => guarded(h))
  }

  tmDispatch = (args: ModuleEventArgs) => {
    // Guard the discriminant before dispatch: TM.CHANNEL is a shared module
    // channel, so a malformed or foreign payload must become a logged drop
    // here, not undefined behavior in whichever subscriber touches it first.
    if (typeof (args as { action?: unknown } | undefined)?.action !== 'string') {
      logger.warn('TM-WARN: dropping malformed module message', args)
      return
    }
    tmSubs.get(args.action)?.forEach((h) => guarded(() => h(args)))
  }
  socket.on(TM.CHANNEL, tmDispatch)

  modifyDispatch = (args: DocumentSocketResponse) => {
    modifySubs.forEach((h) => guarded(() => h(args)))
  }
  socket.on('modifyDocument', modifyDispatch)

  userActivityDispatch = (user, args) => {
    userActivitySubs.forEach((h) => guarded(() => h(user, args)))
  }
  socket.on('userActivity', userActivityDispatch)

  progressDispatch = () => {
    progressSubs.forEach((h) => guarded(h))
  }
  socket.on('progress', progressDispatch)

  attachedSocket = socket

  // RPC acks are api-internal plumbing (actionRpc's pending-request queue),
  // so they register here rather than in the store-facing wiring. Exactly once.
  if (coreSubsRegistered) return
  coreSubsRegistered = true
  onTmAction(TM.ACK, (args) => resolveAck(args.uuid, args))
}
