// Holding roll cards back until Dice So Nice's 3D dice land.
//
// DSN delays a roll card on every Foundry screen: each client hides the new card,
// throws the dice itself, and reveals the card once they settle — unless the
// world turns that off with "Show chat message immediately". Tabula is not a
// Foundry client, so it receives the card the moment it exists, before any dice
// have been thrown anywhere, and would announce the result while the table is
// still watching it roll.
//
// So the elected GM's client stands in for the table. It waits on its own DSN
// for each new roll card and says when the dice have landed (TM.DICE_REVEALED),
// and a request that posted roll cards holds its ack until they have. That
// screen is usually the one the table watches; players' own clients animate on
// their own clock and can land a moment either side of it.
//
// What "landed" means is DSN's to say, through its public
// `waitFor3DAnimationByMessageID` — which also answers at once for every card it
// is not going to animate (dice hidden on this client, a roll with no dice, the
// immediate-display setting), so nothing here has to restate those rules.

import { DICE_REVEAL_MAX_MS } from '@/api/protocol'
import { logger } from '@/utils/utilities'
import type { ChatOrigin } from './chatOrigin'

const DSN_MODULE_ID = 'dice-so-nice'
const DSN_IMMEDIATE_SETTING = 'immediatelyDisplayChatMessages'

// How long a card waits while this client's tab is hidden. DSN does not throw
// dice in a background tab: it queues the throw until the tab is shown again
// (unless the client opted to skip it instead), so waiting for it would hold
// every card at the table for as long as the GM's laptop shows something else.
export const HIDDEN_TAB_REVEAL_MS = 3_000

// How long a card waits for DSN at most, with the tab showing — a throw that
// runs long, or one DSN never reports finishing. Short of the app's ceiling by
// a round trip, so a release (or a held ack) sent at this point still reaches
// the app inside it.
const REVEAL_ROUND_TRIP_MS = 500
export const REVEAL_CEILING_MS = DICE_REVEAL_MAX_MS - REVEAL_ROUND_TRIP_MS

// Narrow probe shapes, read off the live globals at call time. DSN is another
// package; if it renames any of this, the probe fails and cards are released
// at once, which is how a world without DSN behaves anyway.
type Dice3D = { waitFor3DAnimationByMessageID?: (messageId: string) => Promise<unknown> }
type DsnProbe = {
  dice3d?: Dice3D
  modules?: { get?: (id: string) => { active?: boolean } | undefined }
  settings?: { get?: (scope: string, key: string) => unknown }
}
type RollCard = { id?: string | null; rolls?: unknown[] | null }

function probe(): DsnProbe | undefined {
  return (globalThis as { game?: DsnProbe }).game
}

// Whether DSN is holding roll cards back on this client right now: the module
// is active, its API is up, and the world has not asked for cards immediately.
export function diceRevealHeld(): boolean {
  const game = probe()
  if (!game?.modules?.get?.(DSN_MODULE_ID)?.active) return false
  if (typeof game.dice3d?.waitFor3DAnimationByMessageID !== 'function') return false
  try {
    return game.settings?.get?.(DSN_MODULE_ID, DSN_IMMEDIATE_SETTING) !== true
  } catch {
    // Not registered yet (DSN's own `init` has not run). Nothing is being held.
    return false
  }
}

// Whether a Setting document is the world switch above, so its change can be
// re-announced to connected apps.
export function isDiceRevealSetting(setting: unknown): boolean {
  return (setting as { key?: unknown } | null)?.key === `${DSN_MODULE_ID}.${DSN_IMMEDIATE_SETTING}`
}

// Resolves when DSN has revealed the card on this client, or when it is no
// longer worth waiting: HIDDEN_TAB_REVEAL_MS after the tab is (or becomes)
// hidden, or REVEAL_CEILING_MS in any case. Never rejects.
function diceLanded(messageId: string): Promise<void> {
  return new Promise((resolve) => {
    const page = (globalThis as { document?: Document }).document
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined
    const ceiling = globalThis.setTimeout(done, REVEAL_CEILING_MS)

    function done() {
      globalThis.clearTimeout(ceiling)
      globalThis.clearTimeout(hiddenTimer)
      page?.removeEventListener('visibilitychange', onVisibilityChange)
      resolve()
    }

    // Shown again before the timer runs out: DSN flushes the queued throw, so
    // go back to waiting for it.
    function onVisibilityChange() {
      globalThis.clearTimeout(hiddenTimer)
      hiddenTimer = page?.hidden ? globalThis.setTimeout(done, HIDDEN_TAB_REVEAL_MS) : undefined
    }

    onVisibilityChange()
    page?.addEventListener('visibilitychange', onVisibilityChange)
    try {
      Promise.resolve(probe()?.dice3d?.waitFor3DAnimationByMessageID?.(messageId)).then(done, done)
    } catch (error) {
      logger.warn('TABLEMATE: Dice So Nice wait failed; releasing the card', messageId, error)
      done()
    }
  })
}

// One wait per card, shared by the broadcast and any ack holding on it.
const reveals = new Map<string, Promise<void>>()
// The roll cards each request posted, in creation order.
const requestRolls = new WeakMap<ChatOrigin, string[]>()

// Start waiting on a card that has just been created. `origin` is the request
// executing on this client when it was created, if any, so that request's ack
// can wait on it too. `onRevealed` runs once, when the dice have landed.
export function trackDiceReveal(
  message: unknown,
  origin: ChatOrigin | undefined,
  onRevealed: (messageId: string) => void
): void {
  const card = message as RollCard | null
  const id = card?.id
  if (!id || !card.rolls?.length || !diceRevealHeld()) return
  if (origin) requestRolls.set(origin, [...(requestRolls.get(origin) ?? []), id])
  if (reveals.has(id)) return
  reveals.set(
    id,
    diceLanded(id).then(() => {
      reveals.delete(id)
      try {
        onRevealed(id)
      } catch (error) {
        logger.error('TABLEMATE: failed to announce a revealed roll card', id, error)
      }
    })
  )
}

// The roll cards a request posted, once their dice have landed — or at once
// when `waitForDice` is false, which is the case for physical dice: the player
// already knows what they rolled. Never rejects.
export async function settleRequestDice(
  origin: ChatOrigin,
  waitForDice: boolean
): Promise<string[]> {
  const ids = requestRolls.get(origin) ?? []
  if (waitForDice) await Promise.all(ids.map((id) => reveals.get(id)))
  return ids
}

export function resetDiceRevealForTest(): void {
  reveals.clear()
}
