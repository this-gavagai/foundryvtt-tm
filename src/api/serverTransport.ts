export interface JoinUser {
  _id: string
  name: string
  role: number
  color: string
}

export interface JoinData {
  users: JoinUser[]
  activeUsers: string[]
  userId: string | null
}

// Outcome of a POST /join credential attempt. The distinction matters for
// silent re-authentication: only `rejected` means the stored credential can
// never work again (so it's discarded and the login page shown), while
// `unavailable` is transient and must leave the credential intact so a later
// attempt can heal the session without the user typing anything.
export type JoinAttempt = 'ok' | 'rejected' | 'unavailable'

export interface ServerTransport {
  // Session is scoped to a specific server — each saved server keeps its own.
  readSession(serverUrl: URL): Promise<string | undefined> | string | undefined
  getJoinData(serverUrl: URL, socketJoinData: () => Promise<JoinData>): Promise<JoinData>
  verifyCredentials(serverUrl: URL, userid: string, password: string): Promise<JoinAttempt>
  // Cheap reachability check used to pick a protocol (https vs http) before
  // committing to a server. Resolves true when the candidate answers.
  probe(serverUrl: URL): Promise<boolean>
  // Ask the server (over plain HTTP, independent of any socket) whether the
  // stored session is signed in: true = Foundry recognizes it as a logged-in
  // user, false = it's anonymous (the join form would be shown), undefined =
  // couldn't tell (unreachable, no world active, unexpected page).
  sessionIsAuthenticated(serverUrl: URL): Promise<boolean | undefined>
  // Forget the stored session for a server (used when the server is deleted).
  deleteSession(serverUrl: URL): Promise<void> | void
}

export const JOIN_DATA_TIMEOUT_MS = 3_000
export const JOIN_DATA_RETRY_ATTEMPTS = 3
export const VERIFY_CREDENTIALS_TIMEOUT_MS = 10_000
export const PROBE_TIMEOUT_MS = 4_000
export const SESSION_CHECK_TIMEOUT_MS = 4_000

export function readBrowserSessionCookie(): string | undefined {
  return document.cookie
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === 'session')?.[1]
}

// Foundry's session probe is GET / (its "home" route), NOT GET /join.
//
// This is load-bearing: Foundry's join view begins its GET handler with
// `await sessions.logoutWorld(req, res)` — merely *fetching* /join signs the
// session out of the world. Probing there therefore destroyed the very session
// it was asking about and then truthfully reported "anonymous", bouncing the
// user to the login page every time the handshake watchdog fired.
//
// The home route has no such side effect. It only redirects: /game when the
// session is authenticated, /join when it isn't, /setup with no world loaded,
// /license when the EULA is unsigned.
export function homeUrl(serverUrl: URL): URL {
  return new URL('/', serverUrl)
}

// Classify where GET / pointed us — either the Location header of an
// unfollowed redirect or the final URL after following one. Both may be
// relative, so they're resolved against the server. Suffix matching (rather
// than an exact path) keeps this working under a Foundry route prefix.
export function classifyHomeRedirect(
  target: string | undefined,
  serverUrl: URL
): boolean | undefined {
  if (!target) return undefined
  let path: string
  try {
    path = new URL(target, serverUrl.origin).pathname.replace(/\/$/, '')
  } catch {
    return undefined
  }
  if (path.endsWith('/game')) return true
  if (path.endsWith('/join')) return false
  // /setup, /license, or something that isn't Foundry at all.
  return undefined
}

// Attributes for the session cookie the native app plants for a Foundry server.
//
// Foundry v14 authenticates a socket from the Cookie header alone. It no longer
// reads the `session` query parameter v13 accepted — its own client passes none
// (it is same-origin, so the cookie is automatic). The native app's WebView page
// is a *different site* from the Foundry server, so that cookie only rides along
// on the cross-site wss:// handshake when it is SameSite=None, and Chromium
// refuses SameSite=None unless the cookie is also Secure.
//
// Capacitor's cookie plugin exposes no SameSite option — its Android
// implementation concatenates `<key>=<value>; expires=<expires>; path=<path>`
// into a Set-Cookie string — so the attributes are appended to the path value,
// the only lever available. Verified on-device: without this the handshake gets
// `session: null` and every getJoinData emit goes unanswered.
//
// http:// servers keep a bare path: no attribute combination helps them. A
// Secure cookie is never sent back over a plain connection, and SameSite=None
// without Secure is rejected outright.
//
// On Android that is moot anyway — Capacitor's default androidScheme makes the
// page origin https://localhost, and Chromium refuses to even construct a
// ws:// socket from an https page ("An insecure WebSocket connection may not be
// initiated from a page loaded over HTTPS"), so a plain-http Foundry server has
// never been reachable there on any Foundry version. iOS runs from
// capacitor://localhost, which is not an https page, so ws:// is allowed and
// http servers do work there — up to v13. On v14 they need this cookie, which
// http can't have.
export function sessionCookiePath(serverUrl: URL): string {
  return serverUrl.protocol === 'https:' ? '/; SameSite=None; Secure' : '/'
}

// The body of a POST /join credential attempt.
//
// Foundry renamed this field: its server read `req.body.userid` up to and
// including v14 build 364, and reads `req.body.userId` from 14.367 on (verified
// against a live 14.367 server, which answered a *valid* id sent as `userid`
// with JOIN.ErrorUserDoesNotExist — it never saw an id at all — and accepted
// the same id as `userId`). Both generations destructure the body and ignore
// keys they don't know, so sending both spellings satisfies every build rather
// than betting on one: v13 and v14≤364 read `userid`, v14.367+ reads `userId`.
//
// Foundry's own v14 join form also sends `username`, but its server ignores it
// and resolves the id client-side — the id is the canonical key. Sending a name
// too would only add a way to fail when a user has been renamed, so we don't.
export function joinRequestBody(
  userid: string,
  password: string
): { action: 'join'; userid: string; userId: string; password: string } {
  return { action: 'join', userid, userId: userid, password }
}

// Error keys Foundry sends (as a plain-text 401 body, un-localized) when the
// credential itself can never succeed — each one proves the server *resolved
// the user* and refused them, so it can only be the password or the ban.
// Anything else — including an unrecognized refusal and JOIN.WorldPendingSetup,
// which clears once the GM finishes setup — is treated as transient so a stored
// password survives it.
//
// JOIN.ErrorUserDoesNotExist is deliberately NOT here, even though a deleted
// user is terminal. It is the one error Foundry also answers when it did not
// understand *which* user we meant, which is exactly what a renamed request
// field looks like (see joinRequestBody). Reading that as `rejected` is what
// turned the 14.367 rename into a total lockout: every stored password was
// deleted on the spot. Treating it as transient keeps the credential, shows the
// login page, and leaves a genuinely deleted user to be handled there — a
// failure the user can see and recover from.
const TERMINAL_JOIN_ERRORS = ['JOIN.ErrorInvalidPassword', 'JOIN.ErrorBanned']

// Classify a POST /join response. Success is a JSON body Foundry only ever
// sends when someone got logged in; everything else leans transient unless
// Foundry named a terminal credential error, because wrongly calling an outage
// `rejected` throws away a good password and puts the user back on the login
// page.
export function classifyJoinPost(status: number, bodyText: string): JoinAttempt {
  if (status >= 200 && status < 300) {
    let parsed: unknown
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      // A 2xx that isn't JSON is Foundry's rendered "no active game" page.
      return 'unavailable'
    }
    const body = parsed as { status?: string; redirect?: string } | null
    if (body?.status === 'success') return 'ok'
    // A build that stopped sending `status` but still named where to go next
    // logged us in all the same: Foundry answers every *failed* join with a
    // non-2xx and a plain-text error key, never with JSON.
    if (body?.status === undefined && typeof body?.redirect === 'string') return 'ok'
    return 'unavailable'
  }
  return TERMINAL_JOIN_ERRORS.some((key) => bodyText.includes(key)) ? 'rejected' : 'unavailable'
}
