// Authorization for client-initiated RPCs: the single gate the dispatch loop
// checks before invoking a handler, so a handler never runs against an actor the
// requesting user doesn't own.
//
// Pure by construction — the world is passed in rather than read off the `game`
// global, which is what makes the security boundary unit-testable without a
// Foundry client (see __tests__/rpcAuthorize.spec.ts). The declared requirement
// per action lives with the handler it guards, in rpcTable.ts.
//
// NOTE: args.userId is self-reported over Foundry's module channel and cannot be
// authenticated there, so this is best-effort within Foundry's trust model
// (anyone with world login is trusted for player-level actions). It closes the
// gap where only actorId-keyed actions were checked at all, leaving every
// characterId-keyed action — nearly all of them — ungated.

import type { ModuleEventArgs } from '@/types/api-types'

// What a client-initiated action requires of its requester.
//
//   'owner'      requester must OWN the target actor (resolved from actorId or
//                characterId). Covers rolls, spellcasting, equipment, damage,
//                chat-as-actor, item mutation, etc.
//   'world-user' no target actor; the requester need only be a known user of
//                this world. Covers read-only compendium browsing, plus the two
//                actions that belong to the PLAYER rather than a character
//                (reactions, push registration).
export type AuthRequirement = 'owner' | 'world-user'

// CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
const OWNER = 3

export type ActorLike = {
  ownership?: Record<string, number>
  testUserPermission?: (user: unknown, level: string | number) => boolean
}

type UserLike = { isGM?: boolean }

// The slice of `game` authorization reads. Structural on purpose: the listener
// passes the live game, a test passes two Maps.
export type AuthWorld = {
  users: { get: (id: string) => UserLike | null | undefined }
  actors: { get: (id: string) => ActorLike | null | undefined }
}

export function userOwnsActor(
  world: AuthWorld,
  actor: ActorLike | null | undefined,
  userId: string
): boolean {
  if (!actor) return false
  const user = world.users.get(userId)
  if (!user) return false
  // A GM (Foundry: role >= ASSISTANT) owns every actor in the world. This is
  // what testUserPermission below already answers; stating it up front keeps the
  // ownership-map fallback from denying a GM who owns nothing explicitly.
  if (user.isGM) return true
  // Prefer Foundry's canonical permission test, which also honours default
  // ownership; fall back to reading the ownership map (explicit entry, else
  // default) so an actor shared via ownership.default is still recognized.
  if (typeof actor.testUserPermission === 'function') {
    return actor.testUserPermission(user, 'OWNER')
  }
  const ownership = actor.ownership ?? {}
  return (ownership[userId] ?? ownership.default ?? 0) >= OWNER
}

// Ownership by actor id, for the paths that hold an id rather than a document:
// the RPC gate below, and the character-refresh request, which has its own
// dispatch path in listener.ts but the same ownership rule.
export function userOwnsActorById(
  world: AuthWorld,
  actorId: string | null | undefined,
  userId: string
): boolean {
  if (!actorId) return false
  return userOwnsActor(world, world.actors.get(actorId), userId)
}

// The actor an 'owner' request is about. Two spellings because the wire has
// two: actorId on the actor-scoped actions, characterId on the character-scoped
// ones (nearly all of them).
export function targetActorId(args: ModuleEventArgs): string | undefined {
  if ('actorId' in args && typeof args.actorId === 'string') return args.actorId
  if ('characterId' in args && typeof args.characterId === 'string') return args.characterId
  return undefined
}

// Fail-closed: an action whose descriptor declares no requirement — which
// rpcTable.ts makes a compile error, so this is the runtime backstop for a
// hand-crafted or future action — is denied rather than waved through.
export function authorizeRequest(
  world: AuthWorld,
  requirement: AuthRequirement | undefined,
  args: ModuleEventArgs
): boolean {
  if (!requirement) return false
  if (requirement === 'world-user') return !!world.users.get(args.userId)
  return userOwnsActorById(world, targetActorId(args), args.userId)
}
