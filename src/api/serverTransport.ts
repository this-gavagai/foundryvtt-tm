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
  // Forget the stored session for a server (used when the server is deleted).
  deleteSession(serverUrl: URL): Promise<void> | void
}

export const JOIN_DATA_TIMEOUT_MS = 3_000
export const JOIN_DATA_RETRY_ATTEMPTS = 3
export const VERIFY_CREDENTIALS_TIMEOUT_MS = 10_000
export const PROBE_TIMEOUT_MS = 4_000

export function readBrowserSessionCookie(): string | undefined {
  return document.cookie
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === 'session')?.[1]
}
