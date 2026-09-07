// Which KIND of client each user is signed in from, learned off the module
// channel.
//
// A user id is not a client. Foundry tracks a list of sockets per user
// (server-side `user.sockets`), so one user can be signed in from a Foundry
// browser and from Tabula at the same time — and `user.active`, the only thing
// the world tells every client, is true if ANY of them is connected. That
// conflation is what this file exists to undo, for the one decision that cannot
// survive it: the handler election (gmHandlerSetting.ts).
//
// A GM sitting in Tabula is not running the module. Nothing in that browser
// answers a request, so electing them means every request from every tablet goes
// unanswered while a perfectly good second GM sits idle — and silently, because
// the app cannot tell "the elected GM is thinking" from "the elected GM is a
// phantom". The sheet-user flag (utils/sheetUser.ts) already covers the users a
// world CONFIGURED as sheet users, whose browsers are redirected at init. It
// cannot cover a GM who simply opens the app and signs in as themselves, which
// is the case this closes.
//
// ── The two facts, and why they are shaped differently ────────────────────
//
// APP: sticky. Set the first time we hear the app speak for a user, cleared
// when that user goes fully inactive (their last socket closed — see the
// userConnected wiring in listener.ts). NOT a TTL, because the app's heartbeat
// stops the moment a phone locks or the tab is backgrounded while its socket
// stays up: an expiring app mark would quietly re-elect exactly the phantom this
// file is here to keep out of the election.
//
// FOUNDRY: a TTL, refreshed by a heartbeat (TM.HANDLER_PRESENT) and by any
// other Foundry-originated traffic. It has to expire on its own: a GM who
// closes their Foundry tab but leaves Tabula signed in never goes inactive, so
// nothing else would ever retract it.
//
// Exclusion is the AND of the two — signed in from the app, with no live Foundry
// client. Both halves are positive evidence, which is what makes the unknown
// case safe: a client that has just started, or one talking to a module too old
// to send a presence beat, knows nothing about anybody, excludes nobody, and
// behaves exactly as it did before this file existed.
//
// ── Why every client agrees ───────────────────────────────────────────────
//
// The election must reach the same answer on every client or a request is
// answered twice (a double mutation, not a duplicate card). These maps are built
// from broadcasts on the module channel, which every client receives, so they
// converge — and the two ways they can momentarily differ are both bounded:
// a client that has not yet heard the beat over-includes (deferring to a GM who
// is answering anyway), and the handoff window where one client has expired a
// beat another still holds is the same window requestDedup.ts already covers.

// How often a module client says it is here. Matched to the app's own presence
// heartbeat (stores/listenersOnline.ts) — the two are the same conversation from
// opposite ends.
export const HANDLER_PRESENT_INTERVAL_MS = 30_000

// How long a Foundry client stays counted without a beat. Four intervals, which
// is deliberately generous: a backgrounded browser tab has its timers throttled
// to roughly one a minute, and the cost of being late here is a request nobody
// answers, so the beat is given room to be slow before its client is written off.
export const FOUNDRY_CLIENT_TTL_MS = 4 * HANDLER_PRESENT_INTERVAL_MS

// Users we have heard the Tabula app speak for. Sticky — see above.
const appClients = new Set<string>()
// userId → when a Foundry client for them last said anything.
const foundryClients = new Map<string, number>()

export function noteAppClient(userId: string | undefined): void {
  if (userId) appClients.add(userId)
}

export function noteFoundryClient(userId: string | undefined, now = Date.now()): void {
  if (userId) foundryClients.set(userId, now)
}

// Everything we know about a user, dropped when their last client disconnects.
// Both facts go together: the next connection may be either kind, and carrying
// yesterday's answer over is how a GM who moved from the app to Foundry (or back)
// would keep being judged by the client they are no longer using.
export function forgetClient(userId: string | undefined): void {
  if (!userId) return
  appClients.delete(userId)
  foundryClients.delete(userId)
}

export function hasFoundryClient(userId: string | undefined, now = Date.now()): boolean {
  const lastSeen = userId ? foundryClients.get(userId) : undefined
  return lastSeen !== undefined && now - lastSeen <= FOUNDRY_CLIENT_TTL_MS
}

// The question the election asks: is this user signed in from Tabula and nowhere
// else? Only then is there nothing behind their id that could answer a request.
export function isTabulaOnlyClient(userId: string | undefined, now = Date.now()): boolean {
  if (!userId || !appClients.has(userId)) return false
  return !hasFoundryClient(userId, now)
}

export function resetClientCensusForTest(): void {
  appClients.clear()
  foundryClients.clear()
}
