import type { ActorPF2e, GamePF2e, TokenPF2e } from '@7h3laughingman/pf2e-types'
import { TM_ERROR_TARGET_UNRESOLVED } from '@/api/protocol'
import { logger } from '@/utils/utilities'

type SceneLike = NonNullable<GamePF2e['scenes']['active']>
type TokenDocLike = NonNullable<ReturnType<SceneLike['tokens']['get']>> | null
type TokenDoc = NonNullable<TokenDocLike>

// A targeted request as it arrives on the wire: the token ids the proxy had
// selected, plus the scene those ids belong to. Both halves matter — token ids
// are unique per scene, not per world.
export type TargetRequest = {
  targets?: string[]
  targetScene?: string
}

export type ResolvedTarget = {
  // Every target that resolved, in the order the app sent them.
  tokenDocs: TokenDoc[]
  // The placed Token objects for those documents (right for strike/blast
  // `target` params). Shorter than tokenDocs when a target is on a scene no
  // client has drawn — the document exists, the placeable doesn't.
  tokens: TokenPF2e[]
  // First resolved target. PF2e takes a single `target` for an attack roll or a
  // damage preview, so those paths use this; see resolveTargets on why the rest
  // are still carried rather than dropped at the wire.
  tokenDoc: TokenDocLike
  token: TokenPF2e | null
  // A Proxy over the first target's Actor that intercepts getActiveTokens to
  // return the right token(s). Used by handlers that go through PF2e's
  // Statistic API.
  //
  // The handler runs on the GM's machine, so game.user.targets is the GM's UI
  // state — not the calling player's. The player's chosen target arrives via
  // the wire; this proxy lets us drive PF2e's target-resolution path without
  // mutating any user's targeting state.
  actorProxy: ActorPF2e | null
  // How many ids the app asked for, and which of them we could not find. Kept
  // so a caller can tell "the player targeted nothing" (requested 0) from "the
  // player targeted something we lost" (requested > 0, tokenDocs empty) —
  // states that used to be indistinguishable by the time they reached PF2e.
  requested: number
  unresolved: string[]
}

function explicitTokenDocumentList(tokenDoc: TokenDoc): TokenDoc[] {
  const tokenDocs = [tokenDoc]
  const nativeFind = tokenDocs.find.bind(tokenDocs)
  tokenDocs.find = ((...args: Parameters<TokenDoc[]['find']>) =>
    nativeFind(...args) ?? tokenDoc) as TokenDoc[]['find']
  return tokenDocs
}

function noFallbackTokenDocumentList(): TokenDoc[] {
  const tokenDocs: TokenDoc[] = []
  // The list is already empty, so a native find would answer undefined anyway —
  // this pins it there against a PF2e path that supplies its own fallback.
  tokenDocs.find = () => undefined
  return tokenDocs
}

// A stand-in to pass as PF2e's `target` when the player targeted NOTHING.
//
// Passing null instead is not the same thing: PF2e treats a missing target as
// "look it up yourself" and resolves it from `game.user.targets` — which on the
// handling client is the GM's own reticle, not the player's choice. So an
// untargeted tablet roll picked up whatever creature the GM happened to be
// pointing at, complete with its AC/DC comparison and target-derived modifiers.
// A stand-in that resolves to no token stops the lookup at the door.
//
// It contributes nothing of its own: no tokens (so nothing to target), no roll
// options (PF2e feeds a target actor through getSelfRollOptions('target')), and
// level 0 — PF2e compares the target's level against an incapacitation effect's
// level, and the roller's real level there would earn a degree-of-success
// adjustment for a target that does not exist.
export function noFallbackTargetActor(actor: ActorPF2e): ActorPF2e {
  return new Proxy(actor, {
    get(obj: ActorPF2e, prop: string | symbol) {
      if (prop === 'getActiveTokens') {
        return (_linked?: boolean, document?: boolean) =>
          document ? noFallbackTokenDocumentList() : []
      }
      if (prop === 'getSelfRollOptions') return () => []
      if (prop === 'level') return 0

      const val = (obj as ActorPF2e & Record<string | symbol, unknown>)[prop]
      return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(obj) : val
    }
  }) as ActorPF2e
}

// The scene a request's token ids live on. `targetScene` is what the targeting
// client itself reported, so prefer it absolutely; fall back to the active scene
// only for a pre-protocol-4 app that sends no scene at all (which is exactly the
// guess every resolution site used to make unconditionally).
function sceneForRequest(source: GamePF2e, sceneId: string | undefined): SceneLike | null {
  if (sceneId) {
    const named = source.scenes.get(sceneId) as SceneLike | undefined
    if (named) return named
    // Named a scene we don't have — do NOT quietly retry on the active scene.
    // Token ids are only unique within a scene, so a blind retry can resolve to
    // a DIFFERENT token that happens to share the id. Better to resolve nothing
    // and let the caller refuse.
    logger.warn('TABLEMATE: targeted request named an unknown scene', sceneId)
    return null
  }
  return (source.scenes.active as SceneLike | null) ?? null
}

// Resolve a targeted request's token ids against the scene it named.
//
// Non-throwing: use this where an empty result is a legitimate outcome (a chat
// card clicked by someone who isn't the requester). Handlers answering an RPC
// should use resolveRequestedTargets, which refuses instead of rolling blind.
export function resolveTargets(source: GamePF2e, request: TargetRequest): ResolvedTarget {
  const ids = request.targets ?? []
  const scene = sceneForRequest(source, request.targetScene)

  const tokenDocs: TokenDoc[] = []
  const unresolved: string[] = []
  for (const id of ids) {
    const doc = scene?.tokens.get(id) ?? null
    if (doc) tokenDocs.push(doc)
    else unresolved.push(id)
  }

  const tokens = tokenDocs
    .map((doc) => doc.object as TokenPF2e | null)
    .filter((t): t is TokenPF2e => !!t)

  const tokenDoc = tokenDocs[0] ?? null
  const token = tokenDoc?.object ?? null
  const actor = tokenDoc?.actor ?? null
  const actorProxy =
    actor && tokenDoc
      ? (new Proxy(actor, {
          get(obj: ActorPF2e, prop: string | symbol) {
            if (prop === 'getActiveTokens') {
              return (_linked?: boolean, document?: boolean) =>
                document ? explicitTokenDocumentList(tokenDoc) : token ? [token] : []
            }
            const val = (obj as ActorPF2e & Record<string | symbol, unknown>)[prop]
            return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(obj) : val
          }
        }) as ActorPF2e)
      : null

  return { tokenDocs, tokens, tokenDoc, token, actorProxy, requested: ids.length, unresolved }
}

// Refuse a request whose target resolved as a document but not as a PLACED
// Token. Some PF2e entry points (AttackRollParams.target — strikes, their damage
// rolls, elemental blasts) take a Token object rather than an actor, and a Token
// object exists only for the scene its client currently has drawn. So when the
// elected GM is looking at another scene, the player's target resolves to a
// document we cannot pass anywhere: the attack would roll with no target at all
// (or, worse, with the GM's own — see noFallbackTargetActor).
//
// Refusing costs a targeted strike while the GM is off-scene, and a retry keeps
// failing until they navigate back — which is information the table needs. The
// alternative is an attack card that looks complete and compares against the
// wrong creature, which is the whole reason TM_ERROR_TARGET_UNRESOLVED exists.
export function requirePlaceableTarget(resolved: ResolvedTarget): ResolvedTarget {
  if (resolved.requested > 0 && !resolved.token) {
    logger.warn(
      'TABLEMATE: targets resolved as documents but not as placed tokens — is this client viewing that scene?'
    )
    throw new Error(TM_ERROR_TARGET_UNRESOLVED)
  }
  return resolved
}

type TargetSetLike = { ids: string[] }

// This client's OWN target set while a swap is in place: the object displaced
// from `user.targets`, which is the selection actually drawn on this canvas.
// Null the rest of the time, when the property itself is the answer.
let displacedTargets: TargetSetLike | null = null

// The ids this client is really targeting, swap or no swap.
//
// Anything that REPORTS this client's targeting must read it through here.
// `user.targets` is the stand-in for the duration of a roll, so a report built
// straight off the property describes the stand-in — and a client that is both
// the elected handler and somebody's targeting proxy would tell every mirroring
// tablet that it is targeting the roller's target, or (on an untargeted roll)
// nothing at all, while its own reticle sits unchanged on screen. That report
// then outlives the roll: nothing re-broadcasts until the next re-target.
// See listener.broadcastOwnTargets, the one caller.
export function ownTargetIds(source: GamePF2e): string[] {
  const set: TargetSetLike | undefined = displacedTargets ?? source.user.targets
  return set?.ids ?? []
}

// Run `run()` with `game.user.targets` presenting the PLAYER's targets (or
// nothing) in place of this client's own selection.
//
// The safety net behind noFallbackTargetActor, for the PF2e entry points that
// resolve a target from `game.user.targets` whatever we pass as a `target`
// param — strikes and blasts, the action-macro helper, spell damage, and the
// inline-check listener. Hand it the resolved placeables and those paths target
// what the player targeted; hand it nothing and they target nothing, instead of
// inheriting the handling GM's reticle. rollCheck names the check kinds that
// need it (NEEDS_AMBIENT_SHIELD); everything else passes an explicit target and
// runs unswapped.
//
// The real UserTargets is never touched: we swap the PROPERTY for a fresh
// instance of the same class and put the original descriptor back in `finally`.
// Membership is written through Set.prototype.add so UserTargets#add can't
// refresh a reticle. Nothing is broadcast and nothing is drawn, so the client's
// UI never changes — this is not a write to the user's targeting, which the app
// must never do.
//
// The one race: a target the user clicks during the roll lands in the stand-in
// and is dropped. Rolls are sub-second and dispatch is serialized, so that costs
// at most a re-click; clobbering their selection on restore would be worse.
export async function withMirroredTargets<T>(
  source: GamePF2e,
  tokens: TokenPF2e[],
  run: () => Promise<T>
): Promise<T> {
  const user = source.user
  const descriptor = Object.getOwnPropertyDescriptor(user, 'targets')
  const held: GamePF2e['user']['targets'] | undefined = descriptor?.value
  // Only swap what we can put back exactly as we found it: a configurable own
  // value property whose class we can instantiate empty. Anything else (a
  // prototype getter, a frozen property, a Foundry refactor) means we roll
  // unshielded rather than risk leaving this client's targeting broken.
  if (!descriptor || !descriptor.configurable || typeof held?.constructor !== 'function') {
    logger.debug('TABLEMATE: cannot isolate this client targeting; rolling unshielded')
    return run()
  }
  let standIn: unknown
  try {
    // `constructor` is typed Function, which says nothing about being newable;
    // the guard above checked it is callable and the try/catch covers the rest.
    const TargetSet = held.constructor as new (user: unknown) => unknown
    standIn = new TargetSet(user)
    for (const token of tokens) Set.prototype.add.call(standIn as Set<TokenPF2e>, token)
  } catch (error) {
    logger.debug('TABLEMATE: could not build a stand-in target set', error)
    return run()
  }

  // Only the OUTERMOST swap holds this client's real set — a nested one would
  // displace the outer stand-in, and publishing that is the bug ownTargetIds
  // exists to prevent. Dispatch is serialized, so nesting means one handler
  // calling another; the guard makes it harmless rather than relying on that.
  const outermost = !displacedTargets
  if (outermost) displacedTargets = held

  Object.defineProperty(user, 'targets', { ...descriptor, value: standIn })
  try {
    return await run()
  } finally {
    Object.defineProperty(user, 'targets', descriptor)
    if (outermost) displacedTargets = null
  }
}

// The empty case: nothing the player targeted, so nothing this client's own
// selection may substitute for it.
export function withoutAmbientTargets<T>(source: GamePF2e, run: () => Promise<T>): Promise<T> {
  return withMirroredTargets(source, [], run)
}

// Resolve for an RPC handler, refusing the request when the player targeted
// something we cannot find.
//
// Every failure upstream of here — the mirror holding targets from a proxy it no
// longer follows, a proxy that changed scenes, a token deleted mid-turn — used
// to arrive as `target: null` and roll anyway, producing a normal-looking card
// with no AC comparison, no degree of success, and no target-derived modifiers.
// The player could not tell that from a correct roll. Throwing turns the whole
// class into one visible, distinguishable failure (TM_ERROR_TARGET_UNRESOLVED).
//
// A PARTIAL loss doesn't throw: the roll can still proceed against what we
// found, and refusing would be a regression for AoE selections that clip a
// token the GM has since removed. It is logged, and `unresolved` travels on the
// result for callers that want to say more.
export function resolveRequestedTargets(source: GamePF2e, request: TargetRequest): ResolvedTarget {
  const resolved = resolveTargets(source, request)
  if (resolved.requested > 0 && resolved.tokenDocs.length === 0) {
    throw new Error(TM_ERROR_TARGET_UNRESOLVED)
  }
  if (resolved.unresolved.length) {
    logger.warn(
      'TABLEMATE: some targeted tokens could not be resolved',
      resolved.unresolved,
      'scene',
      request.targetScene ?? '(active)'
    )
  }
  return resolved
}
