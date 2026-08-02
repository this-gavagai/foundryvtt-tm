// World-scoped policy for WHICH GM client handles Tablemate requests, and in
// what order.
//
// Out of the box every GM is a candidate and the tie-break is the lowest user
// _id (see iAmFirstGM in listener.ts) — an arbitrary but stable choice that all
// clients agree on, which is what keeps two GMs from both executing a request.
// That default is fine until the GMs differ in practice: one is on a phone, one
// runs the stream overlay, one is an assistant GM who shouldn't be doing the
// table's dice work. This setting lets the world say so.
//
// The stored value is structured, not a hand-typed list, because it is edited
// through the GM Handlers menu (gmHandlerMenu.ts) rather than a text field:
//
//   { order: [userId, …],     // priority order, highest first
//     ignored: [userId, …] }  // clients that must never handle a request
//
// User IDs, not names, so renaming a GM can't quietly change who handles
// requests. Anyone absent from `order` still handles them and simply ranks after
// everyone in it — so a GM who joins the world after the list was saved is never
// silently locked out. The ONLY way to stop a GM handling requests is `ignored`,
// which the menu exposes as a per-GM "Handles" checkbox.
//
// World scope, not client: every client evaluates the same election locally and
// must reach the same answer, so the inputs have to be shared world data. A
// client-scoped "I ignore requests" toggle would only be visible to the GM who
// set it, and the other GMs would still elect them and then wait forever.

import { MODULE_ID } from '@/api/protocol'
import { isSheetUser, type SheetFlaggedUser } from './utils/sheetUser'

declare const game: {
  settings: {
    register: (scope: string, key: string, config: object) => void
    get: (scope: string, key: string) => unknown
    set: (scope: string, key: string, value: unknown) => Promise<unknown>
  }
}

export const GM_HANDLERS_SETTING = 'gmHandlers'

export interface GmHandlerPolicy {
  // User IDs in priority order (index 0 = highest priority).
  order: string[]
  // User IDs whose clients must never handle a request.
  ignored: string[]
}

const EMPTY_POLICY: GmHandlerPolicy = { order: [], ignored: [] }

// A user as far as this policy is concerned. Foundry exposes both `_id` (source)
// and `id` (document getter); accept either so callers can pass a User document
// or a plain row from the menu.
export interface HandlerUser {
  _id?: string | null
  id?: string | null
}

function handlerId(user: HandlerUser): string {
  return user._id ?? user.id ?? ''
}

// The setting is a free-form Object, so a value written by an older release (or
// a hand-edited world) can be any shape. Coerce to string ids, drop blanks and
// duplicates, and keep `ignored` out of `order` so a GM can never be both
// prioritized and opted out.
export function normalizeGmHandlerPolicy(value: unknown): GmHandlerPolicy {
  const raw = (value ?? {}) as { order?: unknown; ignored?: unknown }
  const ids = (list: unknown) =>
    Array.isArray(list)
      ? Array.from(new Set(list.filter((id): id is string => typeof id === 'string' && !!id)))
      : []
  const ignored = ids(raw.ignored)
  const order = ids(raw.order).filter((id) => !ignored.includes(id))
  return { order, ignored }
}

// Setting registration. config: false — the value is structured and is edited
// through the GM Handlers menu, so Foundry's generic settings UI must not try to
// render it as a field.
export function registerGmHandlerSetting(onChange: () => void) {
  game.settings.register(MODULE_ID, GM_HANDLERS_SETTING, {
    name: 'GM handlers',
    scope: 'world',
    config: false,
    type: Object,
    default: EMPTY_POLICY,
    onChange
  })
}

export function gmHandlerPolicy(): GmHandlerPolicy {
  try {
    return normalizeGmHandlerPolicy(game.settings.get(MODULE_ID, GM_HANDLERS_SETTING))
  } catch {
    // Setting not registered yet (or an unexpectedly old world): fall back to
    // today's behavior rather than leaving nobody to handle requests.
    return EMPTY_POLICY
  }
}

// Collapse a policy that merely restates the default election back to the empty
// policy. The menu always submits a full, explicit ordering of today's GMs, and
// storing one that just repeats the by-id default is noise — worse, it would push
// a GM who joins the world later to the bottom of the list instead of ranking
// them by id with everyone else. With no opt-outs and a by-id order, the two
// policies elect exactly the same client, so prefer the empty one.
export function collapseGmHandlerPolicy(policy: GmHandlerPolicy): GmHandlerPolicy {
  const { order, ignored } = normalizeGmHandlerPolicy(policy)
  if (ignored.length) return { order, ignored }
  const byId = [...order].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return order.every((id, index) => id === byId[index]) ? EMPTY_POLICY : { order, ignored }
}

export async function saveGmHandlerPolicy(policy: GmHandlerPolicy): Promise<void> {
  await game.settings.set(MODULE_ID, GM_HANDLERS_SETTING, normalizeGmHandlerPolicy(policy))
}

// Whether this user's client may handle Tablemate requests at all. An opted-out
// GM is treated as unavailable everywhere — including when a player has picked
// them as their targeting proxy — so the request falls through to the next
// eligible GM instead of landing on the client the world said to leave alone.
export function gmHandlesRequests(
  user: HandlerUser | undefined,
  policy: GmHandlerPolicy = gmHandlerPolicy()
): boolean {
  if (!user) return false
  return !policy.ignored.includes(handlerId(user))
}

// Priority rank, lower handles first. Listed GMs get their list position;
// everyone else sorts after all of them (ties then break by id, preserving the
// pre-setting election among unlisted GMs).
export function gmHandlerRank(
  user: HandlerUser,
  policy: GmHandlerPolicy = gmHandlerPolicy()
): number {
  const index = policy.order.indexOf(handlerId(user))
  return index === -1 ? policy.order.length : index
}

// A candidate for the election, as the listener sees one.
export interface ElectableUser extends HandlerUser, SheetFlaggedUser {
  isGM?: boolean
  active?: boolean
}

// Is this GM's client the kind of client that can execute a request at all?
//
// A sheet user's browser is redirected to the Tabula app at init (tablemate.ts),
// so it never loads the module's listener — but it IS signed in, so `active` is
// true and every other client would happily elect it and then wait forever for
// an ack. A GM given a sheet is therefore out of the election, permanently and
// on every client, for the same reason a player is: there is nothing there to
// answer.
//
// Deliberately NOT folded into the policy's `ignored` list: this is a fact about
// how the user is signed in, not a choice the world made about them. Writing it
// into the policy would leave a stale opt-out behind the day they stop being a
// sheet user.
export function isHandlerCapableClient(user: SheetFlaggedUser | undefined): boolean {
  return !!user && !isSheetUser(user)
}

// Does `me` win the election among `users`? THE routing decision: every request
// from every client is answered by the one user this returns true for, so the
// answer must be identical on every client from the same inputs — which is why
// the inputs are world data (the policy) plus user.active, and why there is no
// requester parameter. Routing cannot depend on who asked.
//
// Eligible = an active GM, on a client that can actually handle requests, whom
// the policy has not opted out. Among those, the comparator decides, and `me`
// wins by there being nobody ahead.
export function isElectedHandler(
  me: ElectableUser | undefined,
  users: ElectableUser[],
  policy: GmHandlerPolicy = gmHandlerPolicy()
): boolean {
  // One eligibility test, applied to `me` and to every rival alike. The listener
  // only ever asks about itself, where `active` is necessarily true — but this is
  // a plain predicate now, and one that answered "yes, you are elected" for an
  // offline GM would be a trap for the next caller.
  const eligible = (user: ElectableUser | undefined): boolean =>
    !!user?.isGM &&
    user.active === true &&
    isHandlerCapableClient(user) &&
    gmHandlesRequests(user, policy)

  if (!eligible(me)) return false
  return !users.filter(eligible).some((other) => compareGmHandlers(other, me!, policy) < 0)
}

// Election order: negative when `a` handles requests before `b`. The single
// comparison both the listener's election and the menu's display ordering go
// through.
export function compareGmHandlers(
  a: HandlerUser,
  b: HandlerUser,
  policy: GmHandlerPolicy = gmHandlerPolicy()
): number {
  const byRank = gmHandlerRank(a, policy) - gmHandlerRank(b, policy)
  if (byRank !== 0) return byRank
  const idA = handlerId(a)
  const idB = handlerId(b)
  // Plain codepoint comparison, never localeCompare: every client must reach the
  // same election from the same inputs, and locale-sensitive collation can order
  // mixed-case ids differently from one client to the next.
  return idA < idB ? -1 : idA > idB ? 1 : 0
}
