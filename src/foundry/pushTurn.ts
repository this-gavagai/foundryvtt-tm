// "It's your turn" — a push to the owners of the character an encounter has just
// reached.
//
// This is the notification a phone-in-pocket player actually wants: chat push
// tells them the table is talking, a turn alert tells them the table is waiting.
// It rides the machinery chat push already built (relay POST + retries +
// delivery reporting, see pushDelivery.ts); all that is new is who to notify and
// what to say.
//
// Driven from the core `updateCombat` hook rather than PF2e's `pf2e.startTurn`.
// Two reasons: `updateCombat` is guaranteed to fire on every client (so the
// leader election below is ours to make, exactly as it is for chat), and it does
// not depend on the system's turn-boundary internals, which are the part of PF2e
// most likely to move.

import { readPushConfig, isPrimaryGM } from './pushRegistration'
import {
  deliverPush,
  notificationTitle,
  ownedByRecipients,
  pushableArtUrl,
  worldUsers,
  type WorldUser
} from './pushDelivery'
import { logger } from '@/utils/utilities'

// CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
const OWNER = 3

// Structural views of the bits we read. The hook hands us live documents, but
// Foundry's types for turn state vary by version and PF2e re-declares parts of
// it, so these describe only what is actually touched.
interface ActorLike {
  ownership?: Record<string, number>
  prototypeToken?: { texture?: { src?: string | null } | null } | null
  img?: string | null
}

interface CombatantLike {
  name?: string | null
  actorId?: string | null
  actor?: ActorLike | null
  hidden?: boolean
  defeated?: boolean
  token?: { texture?: { src?: string | null } | null } | null
}

// A LIVE Combat document, so `started` is readable here as the getter it is —
// unlike in the app, which only ever sees the stored source and has to derive it
// (see stores/combat.ts).
interface CombatLike {
  id?: string | null
  active?: boolean
  started?: boolean
  round?: number | null
  turn?: number | null
  combatant?: CombatantLike | null
}

// Which fields, changed, mean the turn moved. `turn` alone is not enough: the
// last combatant of a round hands over with turn going 3 → 0 alongside a round
// bump, and a round-only change happens when an encounter is rewound.
function isTurnChange(changed: Record<string, unknown> | undefined): boolean {
  return !!changed && ('turn' in changed || 'round' in changed)
}

// One notification per (encounter, round, turn), for the life of this client.
//
// A GM stepping back and forth through the tracker re-fires `updateCombat` with
// the same round/turn they were on a moment ago, and PF2e's own turn automation
// re-updates the encounter as it runs. Neither is a new turn, and a player whose
// phone buzzed three times for one turn learns to ignore the alert.
const pushedTurns = new Set<string>()

function turnKey(combat: CombatLike): string {
  return `${combat.id}:${combat.round}:${combat.turn}`
}

// The users to tell: everyone who OWNS the combatant's actor and is not a GM,
// plus any companion-app user standing in for one of them.
//
// GMs are excluded by role, not by ownership: Foundry considers a GM the owner of
// every actor in the world, so including them would buzz the GM's phone for
// every goblin in the encounter. A GM who plays a character is normally not in
// its ownership map either, so this is also the honest reading of "whose
// character is this".
function recipientsFor(actor: ActorLike | null | undefined, users: WorldUser[]): string[] {
  const ownership = actor?.ownership
  if (!ownership) return []
  const owners = new Set<string>()
  for (const user of users) {
    if (game.users.get(user.id)?.isGM) continue
    if ((ownership[user.id] ?? ownership.default ?? 0) >= OWNER) owners.add(user.id)
  }
  for (const id of ownedByRecipients(owners, users)) owners.add(id)
  return [...owners]
}

// Token art first (the image the player is looking at on the map), then the
// actor's own portrait — the same preference the app's turn bar uses.
function portraitUrl(combatant: CombatantLike): string | undefined {
  return pushableArtUrl(
    combatant.token?.texture?.src ??
      combatant.actor?.prototypeToken?.texture?.src ??
      combatant.actor?.img
  )
}

export async function notifyTurnStart(combat: unknown, changed: unknown): Promise<void> {
  try {
    // Only the elected primary GM posts, so a turn seen by N GM clients produces
    // one push, not N. Same election as chat push.
    if (!isPrimaryGM()) return
    if (!isTurnChange(changed as Record<string, unknown> | undefined)) return

    const config = readPushConfig()
    if (!config?.turnAlerts) return

    const encounter = combat as CombatLike
    if (!encounter.active || !encounter.started) return
    if (typeof encounter.round !== 'number' || typeof encounter.turn !== 'number') return

    const combatant = encounter.combatant
    if (!combatant) return
    // A hidden combatant's turn is not something its owner is meant to be told
    // about out of band — the GM is running it off-screen. Defeated combatants
    // still get their turn in the tracker, but nobody is waiting on them to act.
    if (combatant.hidden === true || combatant.defeated === true) return

    const key = turnKey(encounter)
    if (pushedTurns.has(key)) return

    const recipients = recipientsFor(combatant.actor, worldUsers())
    if (!recipients.length) return

    // Marked before the await, not after: `deliverPush` retries for seconds, and
    // PF2e's turn automation can fire another `updateCombat` for this same turn
    // while it is in flight.
    pushedTurns.add(key)

    const name = combatant.name || 'Your character'
    await deliverPush(config, {
      recipients,
      // Every recipient is being addressed personally, so the whole audience is
      // `direct`: its own rate-limit bucket at the relay, no collapsing behind
      // ambient chat, and no suppression for looking "connected" (see the same
      // reasoning for whispers in pushNotify.ts — Foundry takes tens of seconds
      // to notice a backgrounded app, which is exactly when this matters).
      direct: recipients,
      title: notificationTitle(name),
      body: `Your turn — round ${encounter.round}`,
      // Deliberately no messageId: there is no chat message behind this, and the
      // app deep-links a tap to whatever id it is given.
      portraitUrl: portraitUrl(combatant)
    })
  } catch (error) {
    // Never let a push failure disrupt the encounter.
    logger.warn('TABLEMATE: turn push error', error)
  }
}

// Encounters end and start again; nothing should be remembered across a reload
// of the tracker's world. Exposed for tests, which need each case to start from
// a clean slate.
export function resetTurnPushMemory(): void {
  pushedTurns.clear()
}
