import type {
  ManualRollPolicy,
  ModuleEventArgs,
  RequestCharacterDetailsArgs
} from '@/types/api-types'
import { getCharacterDetails } from './handlers'
import { PASSIVE_ACTIONS, rpcDescriptor } from './rpcTable'
import { authorizeRequest, targetActorId, userOwnsActorById, type AuthWorld } from './rpcAuthorize'
import { debounce } from 'lodash-es'
import { logger } from '@/utils/utilities'
import {
  TM,
  TM_ERROR_MANUAL_ROLLS_DISABLED,
  TM_ERROR_UNAUTHORIZED,
  TM_ERROR_REQUEST_EXPIRED,
  REQUEST_ACK_TIMEOUT_MS,
  PROTOCOL_VERSION,
  CAPABILITY_VOICE_MEMO,
  CAPABILITY_VOICE_MEMO_TRANSCRIPT,
  CAPABILITY_IMAGE_UPLOAD,
  CAPABILITY_REACTIONS,
  CAPABILITY_COMMENTS,
  MODULE_ID
} from '@/api/protocol'
import { makeAck, stampTablemateChatOrigin, tablemateChatOriginUuid } from './utils/foundry'
import { markRequestSeen, requestAlreadySeen } from './requestDedup'
import { abandonMirroredTargets, ownTargetIds } from './utils/target'
import { resolveCapture, type CapturedMessage } from './chatCapture'
import {
  abandonChatOrigin,
  chatOriginStampFor,
  currentChatOriginUserId,
  withChatOrigin,
  type ChatOrigin,
  type ChatOriginStamp
} from './chatOrigin'
import { abandonBackgroundRolls } from './backgroundRoll'
import { abandonDamageModifierOverrides } from './handlers/checks/modifierOverrides'
import { drawnSceneId, hooks, notifications } from './globals'
import {
  registerManualRollPolicySetting,
  manualRollPolicy,
  hasPresetDiceResults
} from './manualRollPolicy'
import { registerGmHandlerSetting, gmHandlerPolicy, isElectedHandler } from './gmHandlerSetting'
import { registerVoiceMemoSetting, voiceMemoEnabled } from './voiceMemoSetting'
import { registerImageUploadSetting, imageUploadEnabled } from './imageUploadSetting'
import { registerPushSettings, ensureWorldPushIdentity } from './pushRegistration'
import { notifyChatMessage } from './pushNotify'

type GetEvent = { action: 'get' }

// Running module release, read from the manifest Foundry parsed at load.
function moduleVersion(): string | undefined {
  return game.modules?.get?.(MODULE_ID)?.version ?? undefined
}

// Warn the GM at most once per incompatible client per window, so the 30s
// presence heartbeat doesn't spam a persistent error notification.
const VERSION_WARN_THROTTLE_MS = 10 * 60 * 1000
const versionWarnings = new Map<string, number>()

// Compare a connecting client's protocol version against ours. A mismatch
// (including a client too old to report one) means the wire protocol differs,
// so surface it to the GM with both human-readable versions for triage.
function checkClientVersion(args: ModuleEventArgs) {
  const protocol = 'protocol' in args ? args.protocol : undefined
  if (protocol === PROTOCOL_VERSION) return

  const userId = args.userId ?? 'unknown'
  const now = Date.now()
  const lastWarned = versionWarnings.get(userId)
  if (lastWarned && now - lastWarned < VERSION_WARN_THROTTLE_MS) return
  versionWarnings.set(userId, now)

  const appVersion = ('appVersion' in args && args.appVersion) || 'an older version'
  const message =
    `Tabula version mismatch: a connected app (${appVersion}) is not compatible ` +
    `with this module (${moduleVersion() ?? 'unknown'}). Update both to the same ` +
    `release so they can talk to each other.`
  logger.warn('TABLEMATE: ' + message, {
    clientProtocol: protocol,
    moduleProtocol: PROTOCOL_VERSION
  })
  // Advisory only — a transient (non-permanent) notification so it warns the GM
  // without wedging an undismissable error on screen.
  notifications()?.error?.(message)
}

const getChar: Record<string, (args: RequestCharacterDetailsArgs) => void> = {}
let chatOriginStampingRegistered = false

// Handlers that roll dice or create chat messages execute strictly one at a
// time. Three mechanisms read ambient top-of-stack state while a handler
// runs — preset dice faces (backgroundRoll), damage modifier overrides
// (modifierOverrides), and chat attribution (chatOriginStack above) — so two
// interleaved requests would read each other's context: player B's "random"
// roll landing on player A's chosen faces, damage toggles applied to the
// wrong roll, chat messages attributed to the wrong tablet. FIFO latency is
// fine at tabletop cadence.
//
// The chain advances when a task settles OR after HANDLER_QUEUE_TIMEOUT_MS,
// whichever comes first — a handler that never settles (e.g. a macro
// awaiting a GM dialog that's never dismissed) degrades to concurrent
// dispatch with a warning instead of wedging every request in the world.
// Derived from the app's ack budget rather than restated as its own 30_000, so
// the two can't drift: by the time the queue advances past a hung handler, its
// requester has already given up. The same budget bounds how long a request may
// WAIT here before being refused unexecuted — see the dispatch chain below.
const HANDLER_QUEUE_TIMEOUT_MS = REQUEST_ACK_TIMEOUT_MS
let dispatchChain: Promise<unknown> = Promise.resolve()

function isCharacterRequest(args: ModuleEventArgs): args is RequestCharacterDetailsArgs {
  return args.action === TM.REQUEST_CHARACTER
}

// ── Authorization ──────────────────────────────────────────────────────────
// Every client-initiated action declares its authorization requirement alongside
// its handler, in rpcTable.ts. The dispatch loop checks it once, before invoking
// the handler, so a handler never runs against an actor the requesting user
// doesn't own. The rule itself lives in rpcAuthorize.ts, which takes the world as
// a parameter so it can be unit-tested away from a Foundry client — this is the
// only place that supplies the live one.
const authWorld = (): AuthWorld => game

function userOwnsRequestedActor(args: RequestCharacterDetailsArgs): boolean {
  return userOwnsActorById(authWorld(), args.actorId, args.userId)
}

function requestUuid(args: ModuleEventArgs): string | undefined {
  return 'uuid' in args && typeof args.uuid === 'string' ? args.uuid : undefined
}

function handleCharacterRequest(args: RequestCharacterDetailsArgs) {
  if (!iAmFirstGM()) {
    logger.debug('TM.SKIP requestCharacterDetails: first active GM handles actor refresh', args)
    return
  }
  if (!userOwnsRequestedActor(args)) {
    logger.warn('unowned character')
    return
  }

  logger.debug('TM-Requested')
  if (!getChar[args.actorId]) {
    getChar[args.actorId] = debounce(
      (a: RequestCharacterDetailsArgs) => {
        getCharacterDetails(a)
          .then((result) => game.socket.emit(TM.CHANNEL, result))
          .catch((error) => logger.error('TABLEMATE: character refresh failed', a.actorId, error))
      },
      2000,
      { leading: true, trailing: true }
    )
  }
  getChar[args.actorId](args)
}

// Write the stamp into flags.tablemate on the message being created. A live
// document takes it through updateSource; a plain source object (some creation
// paths hand the hook raw data) gets it merged in directly.
function writeChatOriginStamp(message: unknown, data: unknown, stamp: ChatOriginStamp) {
  const sourceUpdate = { flags: { tablemate: stamp } }
  const document = message as { updateSource?: (changes: typeof sourceUpdate) => unknown }
  if (typeof document.updateSource === 'function') {
    document.updateSource(sourceUpdate)
    return
  }

  if (!data || typeof data !== 'object') return
  const source = data as {
    flags?: { tablemate?: Record<string, unknown>; [key: string]: unknown }
  }
  source.flags ??= {}
  source.flags.tablemate = {
    ...source.flags.tablemate,
    ...stamp
  }
}

function setupChatOriginStamping() {
  if (chatOriginStampingRegistered) return
  chatOriginStampingRegistered = true

  // What to stamp, and how each field is scoped, is chatOrigin.ts's decision —
  // this only writes it.
  hooks().on('preCreateChatMessage', (message, data) => {
    const stamp = chatOriginStampFor(message, data)
    if (stamp) writeChatOriginStamp(message, data, stamp)
  })
  hooks().on('createChatMessage', (message) => {
    const originUserId = currentChatOriginUserId()
    if (originUserId) stampTablemateChatOrigin(message, originUserId)
    const uuid = tablemateChatOriginUuid(message)
    if (uuid) resolveCapture(uuid, message as CapturedMessage)
    // Push the message to everyone who can see it (leader-elected + gated on
    // push config inside; safe to call on every client).
    void notifyChatMessage(message)
  })
}

// Everything the dispatch loop below needs from the Foundry client, named so it
// can be supplied by a test instead.
//
// The loop itself is a sequence of gates — character requests and acks first,
// then the targets request, then the responder election, then the handler table,
// then authorization, then the manual-roll policy — and the ORDER is the part
// that carries the reasoning. Each gate has a comment saying why it sits where
// it does, and until now none of it was reachable from a test: the whole body
// was a closure inside setupListener, so the twelve specs in this directory
// cover the pieces it calls (rpcTable, rpcAuthorize, requestDedup,
// gmHandlerSetting, chatOrigin) and nothing covered how they compose.
//
// Only the Foundry-facing edges are injected. The pure collaborators — the RPC
// table, the dedup guard, the chat-origin stack — are already importable and
// already tested, so they stay direct calls.
export interface ModuleEventDeps {
  // The world, for the authorization gate. rpcAuthorize takes it as a parameter
  // for exactly this reason; this is the second caller to benefit.
  world: () => AuthWorld
  // This client's user id: a targets request names the client that must answer.
  selfUserId: () => string | undefined
  // Send on the module channel.
  emit: (payload: unknown) => void
  // Is this client the world's elected handler?
  isResponder: () => boolean
  // World policy for player-determined dice faces.
  manualRollPolicy: () => ManualRollPolicy
  // Character refresh has its own debounced, per-actor path.
  onCharacterRequest: (args: RequestCharacterDetailsArgs) => void
  // Presence handshake: version check, then re-announce.
  onAnybodyHome: (args: ModuleEventArgs) => void
  // Report this client's own targeting.
  onRequestTargets: () => void
}

// Answer a refused/failed request with an error ack so the waiting app rejects
// its pending request immediately with a distinguishable cause, instead of
// hanging until the client-side timeout. With no uuid there's nothing to
// correlate, so the refusal is log-only.
function ackError(deps: ModuleEventDeps, args: ModuleEventArgs, error: string) {
  const uuid = requestUuid(args)
  if (!uuid) return
  // Built through makeAck so error acks and success acks share one shape (and
  // userId normalization); this only adds the error field.
  deps.emit({ ...makeAck({ uuid }), error })
}

// Turn a thrown handler into an error ack.
function ackHandlerError(deps: ModuleEventDeps, args: ModuleEventArgs, error: unknown) {
  logger.error('TABLEMATE: handler failed', args.action, error)
  ackError(deps, args, error instanceof Error ? error.message : String(error))
}

// One inbound module message, from the gates through to dispatch.
export function handleModuleEvent(args: ModuleEventArgs, deps: ModuleEventDeps) {
  if (!args.userId) logger.warn('TM-missing: no userid', args)

  // Character refresh has its own path: it is debounced per actor and answered
  // by the elected GM (see handleCharacterRequest), rather than going through
  // the handler table and the serialized dispatch chain below.
  if (isCharacterRequest(args)) {
    deps.onCharacterRequest(args)
    return
  }

  // Observe acks from ANY answering client BEFORE the relay gate: they feed
  // the request-dedup guard, so two GMs who momentarily both believe they are
  // the elected one can't double-execute a request the other already
  // answered. (The gate would drop this on every client but the elected one,
  // which is exactly the client that does not need to hear it.)
  if (args.action === TM.ACK) {
    const uuid = requestUuid(args)
    if (uuid) markRequestSeen(uuid)
    return
  }

  // Answered BEFORE the responder gate, and by whichever client the request
  // names rather than by the elected GM. A user's targets are placed Tokens on
  // that user's own canvas, so only their client can report them without loss
  // — the GM's copy is a reconstruction limited to whatever scene the GM has
  // drawn. Read-only: it describes this client, never changes it. No
  // authorization gate for the same reason core Foundry has none — target
  // selection is already broadcast to every client via userActivity.
  if (args.action === TM.REQUEST_TARGETS) {
    if (args.proxyId === deps.selfUserId()) deps.onRequestTargets()
    return
  }

  if (!deps.isResponder()) return
  logger.info('TM.RECV (listener)', args)

  if (args.action === TM.ANYBODY_HOME) {
    deps.onAnybodyHome(args)
    return
  }

  // One table lookup answers every question the dispatch loop has about this
  // action: who may ask for it, which handler answers it, and whether it may
  // run off the serialized chain. See rpcTable.ts.
  const rpc = rpcDescriptor(args.action)
  if (!rpc) {
    // An action this side only ever sends — observed on the wire, nothing to do.
    if (PASSIVE_ACTIONS.has(args.action)) return
    // A request with no entry in the table, then: most likely an app newer
    // than this module. Answer it so the app fails fast with a truthful cause
    // rather than waiting out its 30s timeout (or being told, as it was
    // before, that it was unauthorized).
    logger.warn('TABLEMATE: no handler for action', args.action, args)
    ackError(deps, args, `unsupported action: ${args.action}`)
    return
  }

  if (!authorizeRequest(deps.world(), rpc.auth, args)) {
    logger.warn('TABLEMATE: unauthorized request rejected', args.action, args.userId)
    // Answer instead of dropping: a silent drop leaves the app waiting out
    // its full 30s timeout, indistinguishable from "no GM online".
    ackError(deps, args, TM_ERROR_UNAUTHORIZED)
    return
  }

  // Manual-roll policy gate: a payload carrying player-determined dice faces
  // is checked here, at the single dispatch point, before withBackgroundRoll
  // can stamp the faces onto a Roll. 'reject' answers with a sentinel error
  // ack the app recognizes; 'flag' lets the roll through but marks the chat
  // origin so the resulting message gets tagged.
  const presetDice = hasPresetDiceResults('diceResults' in args ? args.diceResults : undefined)
  const policy = presetDice ? deps.manualRollPolicy() : 'allow'
  if (policy === 'reject') {
    logger.warn('TABLEMATE: manual roll rejected by world policy', args.action, args.userId)
    ackError(deps, args, TM_ERROR_MANUAL_ROLLS_DISABLED)
    return
  }

  // Answer the request; never rejects. The terminal catch matters: the
  // error-ack emit can itself throw (socket torn down mid-reload), and a
  // rejection escaping here would poison the dispatch chain for good.
  const respond = (run: Promise<unknown>) =>
    run
      .then((result) => deps.emit(result))
      .catch((error) => ackHandlerError(deps, args, error))
      .catch((error) => logger.error('TABLEMATE: failed to answer request', args.action, error))

  if (rpc.concurrent) {
    void respond(rpc.handler(args))
    return
  }

  const origin: ChatOrigin = {
    userId: args.userId,
    uuid: requestUuid(args),
    manualRoll: policy === 'flag',
    // The actor this request is about, so the uuid stamp can be scoped to the
    // message this request itself produces (belongsToRequest). Authorization
    // already resolved and owner-checked this id for every 'owner' action.
    actorId: targetActorId(args)
  }
  // When this request joined the queue, so its wait can be measured against the
  // requester's patience below.
  const enqueuedAt = Date.now()
  dispatchChain = dispatchChain.then(
    () =>
      new Promise<void>((advance) => {
        // Refuse a request whose requester has already given up.
        //
        // Handlers run one at a time, so a request can sit here for an unbounded
        // time behind slow ones — the app's ack timeout is measured from SEND and
        // the queue timeout from handler START, so nothing bounded the wait. Past
        // that budget the app has rejected the promise and told the player the
        // action failed; running the handler now would spend the slot, apply the
        // damage or post the card for someone who was told none of it happened,
        // with no way to notice. Refusing unexecuted is the honest outcome — a
        // failure the player was already shown, rather than a silent mutation
        // behind it.
        const waited = Date.now() - enqueuedAt
        if (waited > REQUEST_ACK_TIMEOUT_MS) {
          logger.warn(
            'TABLEMATE: refusing a request its requester already gave up on',
            args.action,
            { waitedMs: waited, budgetMs: REQUEST_ACK_TIMEOUT_MS }
          )
          ackError(deps, args, TM_ERROR_REQUEST_EXPIRED)
          advance()
          return
        }

        // Dedup at execution time, not receive time: the queue wait is
        // exactly the window in which a competing client's ack (two GMs
        // racing an election through a handoff) can arrive and mark this uuid.
        const uuid = requestUuid(args)
        if (uuid) {
          if (requestAlreadySeen(uuid)) {
            logger.warn('TABLEMATE: skipping request already answered elsewhere', args.action, uuid)
            advance()
            return
          }
          markRequestSeen(uuid)
        }
        const timer = globalThis.setTimeout(() => {
          // Advancing the queue past a handler that is STILL RUNNING gives up
          // the serialization that keeps ambient roll state from leaking
          // between requests, so the abandoned request's context has to be
          // torn down here rather than waiting for a `finally` that may never
          // run. Left in place, its dice-result overrides sit on top of the
          // stack for the rest of the session and land on everyone else's
          // rolls — the GM's own included.
          abandonChatOrigin(origin)
          const droppedDice = abandonBackgroundRolls()
          // The other two pieces of ambient state a running handler owns. Both
          // outlive the abandoned request exactly as the dice contexts do: the
          // target swap leaves this client's own reticle replaced by the
          // roller's (and freezes what mirroring tablets are told it is), and
          // the damage overrides apply one player's modifier toggles to every
          // later roll on this client. See each function's own note.
          const droppedTargets = abandonMirroredTargets()
          const droppedOverrides = abandonDamageModifierOverrides()
          logger.warn(
            `TABLEMATE: handler still running after ${HANDLER_QUEUE_TIMEOUT_MS}ms; advancing queue`,
            args.action,
            {
              abandonedDiceContexts: droppedDice,
              abandonedTargetSwaps: droppedTargets,
              abandonedDamageOverrides: droppedOverrides
            }
          )
          advance()
        }, HANDLER_QUEUE_TIMEOUT_MS)
        void respond(withChatOrigin(origin, () => rpc.handler(args))).finally(() => {
          globalThis.clearTimeout(timer)
          advance()
        })
      })
  )
}

// The serialized chain outlives a single request by design, so a test that left
// work queued on it would leak into the next one.
export function resetDispatchChainForTest(): void {
  dispatchChain = Promise.resolve()
}

// Guarded because everything below registers a listener with Foundry — a socket
// handler, canvas hooks, world settings — and a second call would double every
// one of them: each request answered twice, each target change broadcast twice.
// Safe today only because Hooks.on('ready') fires once per page load, which is a
// property of the caller rather than of this function. setupChatOriginStamping
// already carried its own guard; this is the same protection for its neighbours.
let listenerRegistered = false

export function setupListener() {
  if (listenerRegistered) return
  listenerRegistered = true
  logger.info('TABLEMATE: Setting up listener')
  // Which GMs handle requests, and in what order (edited via the GM Handlers
  // menu, registered in tablemate.ts). Re-announce on change so the newly
  // elected handler tells connected apps it is live instead of leaving them to
  // wait out the next presence heartbeat.
  registerGmHandlerSetting(() => announceSelf())
  // World policy for player-determined dice results. Re-announce on change so
  // connected apps update their manual/Pixel affordances without waiting for
  // the next presence heartbeat.
  registerManualRollPolicySetting(() => announceSelf())
  // Re-announce when the GM sets/clears the voice-memo folder so connected apps
  // show or hide the mic immediately (the capability rides announceSelf below).
  registerVoiceMemoSetting(() => announceSelf())
  // Re-announce when the GM sets/clears the image folder so connected apps show
  // or hide the attach button immediately (the capability rides announceSelf).
  registerImageUploadSetting(() => announceSelf())
  registerPushSettings()
  // GM-only: generate + provision this world's push identity if enabled.
  void ensureWorldPushIdentity()
  setupChatOriginStamping()
  // Runs on every client, not just the elected GM: each reports its own
  // targeting so mirroring tablets get it from the one place that knows it.
  setupTargetReporting()
  announceSelf()

  game.socket.onAnyOutgoing((event: string, ...args: ModuleEventArgs[] | GetEvent[]) => {
    if (
      event === 'userActivity' ||
      event === 'template' ||
      event === 'manageFiles' ||
      event === 'time' ||
      args?.[0]?.action === 'get' ||
      (event.match('module.') && !event.match(TM.CHANNEL))
    )
      return
    logger.info(`TM.SEND ${event}`, args?.[0]?.action, args)
  })

  // The live edges of the dispatch loop. Everything Foundry-shaped is resolved
  // here, at the one place that has a client, so handleModuleEvent itself can be
  // driven by a test.
  const deps: ModuleEventDeps = {
    world: authWorld,
    selfUserId: () => game.user.id,
    emit: (payload) => game.socket.emit(TM.CHANNEL, payload),
    isResponder: iAmFirstGM,
    manualRollPolicy,
    onCharacterRequest: handleCharacterRequest,
    onAnybodyHome: (args) => {
      checkClientVersion(args)
      announceSelf()
    },
    onRequestTargets: broadcastOwnTargets
  }

  game.socket.on(TM.CHANNEL, (args: ModuleEventArgs) => handleModuleEvent(args, deps))
}

// utility functions

// Which client should answer this request: the GM the world elected, always.
//
// Requests used to route to the requester's *targeting proxy* when they had one,
// falling back to the elected GM otherwise. That was carried over from an older
// "shared display" client and does nothing for targeting, because no handler
// reads the executing client's targets. A player's chosen targets travel in the
// request as token ids and are resolved against the active scene — world data,
// identical on every client — and PF2e's own target resolution is driven through
// an actor Proxy specifically so that no client's `game.user.targets` is ever
// consulted or mutated. See resolveTarget in utils/target.ts, whose comment names
// "the GM's (or proxy's) own UI state" as the thing being avoided.
//
// So proxy routing bought nothing and cost plenty:
//
//   • A proxy may be an ordinary PLAYER — the app lets you pick any non-root
//     user. Requests then execute on a client with no GM authority: Foundry
//     refuses a non-author message update (reactions), and file uploads want a
//     GM's permissions (voice memos, images) — so those requests fail on a
//     player proxy with no error anywhere useful.
//   • It is chosen PER REQUESTER, so one table's requests could execute on
//     several clients at once. The dispatch chain below serializes handlers per
//     client, which made it insufficient for anything read-modify-write on
//     shared state: two players reacting to one message through two proxies read
//     the same list and one write clobbered the other.
//   • It made "which client ran this" depend on a per-user flag, so the same
//     action behaved differently for two players at the same table.
//
// One elected GM answers everything. The election is the world's GM Handlers
// policy (gmHandlerSetting.ts), so a table that wants a particular GM to do the
// work says so once, in one place, for every action.
//
// Trade-off: with no GM online, nothing is answered — where a player proxy might
// once have picked a request up. In practice it would have failed on permissions
// for most actions anyway, and REQUEST_CHARACTER already required a GM.
//
// The targeting proxy itself is untouched: it remains an app-side choice about
// whose targets a tablet mirrors (see stores/targetHelper.ts), which is the job
// it actually does.
//
// The elected handler among active GMs: highest priority per the world's GM
// handler policy (set in the GM Handlers menu), ties broken by lowest _id — the
// pre-setting rule, and still what an unconfigured world uses for every GM.
// Opted-out GMs are out of the running entirely, including when they are the
// ONLY GM online, in which case nobody answers, exactly as if no GM were
// connected.
//
// Every client runs this election locally off the same world setting + the same
// user.active view, so they agree on the answer; requestDedup.ts covers the
// handoff window where those views momentarily differ.
function iAmFirstGM() {
  // The election itself lives with the policy it reads, where it is unit-tested
  // (gmHandlerSetting.spec.ts); this supplies the live world state.
  return isElectedHandler(game.user, game.users.contents ?? [], gmHandlerPolicy())
}
// The active ring's spritesheet path, or undefined when the ring framework
// hasn't initialized (no canvas yet) or the config is unavailable.
function tokenRingSpritesheet(): string | undefined {
  try {
    return CONFIG?.Token?.ring?.spritesheet || undefined
  } catch {
    return undefined
  }
}

function announceSelf() {
  game.socket.emit(TM.CHANNEL, {
    action: TM.LISTENER_ONLINE,
    userId: game.user.id,
    // Let the app run the reciprocal version check on its side.
    protocol: PROTOCOL_VERSION,
    moduleVersion: moduleVersion(),
    // Piggyback the manual-roll policy so apps can gray out their manual/Pixel
    // affordances proactively; the dispatch gate above stays authoritative.
    manualRollPolicy: manualRollPolicy(),
    // The resolved dynamic ring spritesheet, so the app can draw token rings on
    // its avatars. Resolution has to happen here: the world setting holds a ring
    // ID, and the registry that maps IDs to spritesheets (including the custom
    // rings modules and adventure paths register) exists only in the client.
    tokenRing: { spritesheet: tokenRingSpritesheet() },
    // Additive feature flags — the app hides features this module can't serve.
    // Each media capability is advertised only once the GM has configured its
    // destination folder, so an unconfigured world offers no such affordance.
    capabilities: [
      ...(voiceMemoEnabled() ? [CAPABILITY_VOICE_MEMO] : []),
      ...(imageUploadEnabled() ? [CAPABILITY_IMAGE_UPLOAD] : []),
      // Unconditional: reactions need no world configuration, so this is purely
      // a "this module is new enough" signal for the app's affordance gate.
      CAPABILITY_REACTIONS,
      // Unconditional for the same reason as reactions: purely a "this module
      // can answer SET_COMMENT" signal for the app's affordance gate.
      CAPABILITY_COMMENTS,
      // Likewise unconditional — it says this module reports the posted message
      // on a voice memo's final chunk, which is what lets the sending app patch
      // its own transcript onto the memo.
      CAPABILITY_VOICE_MEMO_TRANSCRIPT
    ]
  })
}

// Report THIS client's own targeting to the table.
//
// Only the targeting client can do this without loss. `user.targets` is a
// UserTargets extends Set<Token> — placed Token objects, which exist only for
// the scene that client currently has drawn. The previous implementation had the
// elected GM enumerate every user's targets and broadcast the lot, so any target
// outside the GM's viewed canvas silently read as absent; because it fired on
// every tablet's 30s presence heartbeat, that reconstruction periodically
// overwrote correct, live target data with an empty set.
//
// The scene id travels with the ids because token ids are unique per scene, not
// per world. `canvas.scene` is the authoritative answer to "which scene are
// these ids on" — it is the same canvas the Token objects came from.
//
// Read through ownTargetIds, never `game.user.targets` directly: while this
// client is answering a targeted request that property is a stand-in presenting
// the ROLLER's targets (utils/target.ts), and this client may well be the
// proxy those tablets are mirroring. Reporting the stand-in tells them the
// screen shows something it doesn't, and nothing corrects it until the next
// re-target.
function broadcastOwnTargets() {
  game.socket.emit(TM.CHANNEL, {
    action: TM.SHARE_TARGETS,
    userId: game.user.id,
    sceneId: drawnSceneId(),
    targets: ownTargetIds(game)
  })
}

// Foundry fires `targetToken` once per token, so a drag-select of five tokens
// fires five times; core itself coalesces the socket broadcast the same way.
// Trailing-edge debounce so we send the settled selection, once.
const TARGET_BROADCAST_DEBOUNCE_MS = 50
const broadcastOwnTargetsSoon = debounce(broadcastOwnTargets, TARGET_BROADCAST_DEBOUNCE_MS)

let targetReportingRegistered = false

function setupTargetReporting() {
  if (targetReportingRegistered) return
  targetReportingRegistered = true
  // Fires on EVERY client, for every user's target change — including remote
  // ones this client learned about over the wire. Report only our own, or a
  // table of N clients would answer each change N times, and the copies made on
  // other canvases are exactly the lossy reconstruction this replaces.
  hooks().on('targetToken', (...args: unknown[]) => {
    const user = args[0] as { id?: string } | undefined
    if (user?.id !== game.user.id) return
    broadcastOwnTargetsSoon()
  })

  // Changing scene rebuilds the canvas and drops every placed Token, so our
  // targets are now empty (or belong to a different scene). Say so rather than
  // leaving mirroring tablets holding ids for a scene we've left.
  hooks().on('canvasReady', () => broadcastOwnTargetsSoon())
}
