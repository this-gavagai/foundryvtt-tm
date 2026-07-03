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

export interface ServerTransport {
  // Session is scoped to a specific server — each saved server keeps its own.
  readSession(serverUrl: URL): Promise<string | undefined> | string | undefined
  getJoinData(serverUrl: URL, socketJoinData: () => Promise<JoinData>): Promise<JoinData>
  verifyCredentials(serverUrl: URL, userid: string, password: string): Promise<boolean>
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

// A page served at /join with the user dropdown present is Foundry's login
// form — proof the session is anonymous. (An authenticated session is
// redirected to /game instead, whose markup has no such select.)
export function joinHtmlHasUserSelect(html: string): boolean {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return !!document.querySelector('select[name="userid"]')
}

// Shared classification for a followed GET /join: landing on /game means the
// session is authenticated; a page with the join form means it's anonymous;
// anything else (setup/license/auth screens, unexpected markup) is unknown.
export function classifyJoinResponse(finalUrl: string, html: string): boolean | undefined {
  try {
    if (new URL(finalUrl).pathname.startsWith('/game')) return true
  } catch {
    /* no final URL available — fall through to the markup check */
  }
  if (joinHtmlHasUserSelect(html)) return false
  return undefined
}
