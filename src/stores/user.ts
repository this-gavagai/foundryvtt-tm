import { ref } from 'vue'
import { defineStore } from 'pinia'

// The Foundry user document _id (distinct from the login username stored under
// 'userid'). Persisted so caches that key by user — e.g. the chat snapshot —
// can resolve the same key on a cold launch, before the session handshake has
// repopulated the store.
const FOUNDRY_USER_ID_KEY = 'foundryUserId'

// Last-known Foundry user _id, available synchronously before `setUserId` runs.
export function lastKnownUserId(): string {
  return localStorage.getItem(FOUNDRY_USER_ID_KEY) ?? ''
}

// The login username (Foundry user _id chosen on the login page) is remembered
// per server origin so each saved server prefills its own last user. The bare
// 'userid' key is the pre-multi-server value, read as a one-time fallback.
const LOGIN_USER_PREFIX = 'userid:'
const LEGACY_LOGIN_USER_KEY = 'userid'
// The human-readable display name for that login user, remembered alongside the
// _id so the server list can label each saved server with a name (the _id is
// opaque). Stored separately from the id key so older installs that only have
// the id still resolve the user, just without a name to show.
const LOGIN_NAME_PREFIX = 'username:'

function loginUserKey(origin: string): string {
  return `${LOGIN_USER_PREFIX}${origin}`
}

function loginNameKey(origin: string): string {
  return `${LOGIN_NAME_PREFIX}${origin}`
}

export function rememberLoginUser(origin: string, userid: string, name?: string): void {
  if (!origin || !userid) return
  localStorage.setItem(loginUserKey(origin), userid)
  if (name) localStorage.setItem(loginNameKey(origin), name)
}

export function lastLoginUser(origin: string): string {
  if (!origin) return ''
  return (
    localStorage.getItem(loginUserKey(origin)) ??
    localStorage.getItem(LEGACY_LOGIN_USER_KEY) ??
    ''
  )
}

// The display name last used to sign in to this server, or '' if none was ever
// remembered (e.g. a server added but never logged into, or an install from
// before names were stored).
export function lastLoginUserName(origin: string): string {
  if (!origin) return ''
  return localStorage.getItem(loginNameKey(origin)) ?? ''
}

export function forgetLoginUser(origin: string): void {
  localStorage.removeItem(loginUserKey(origin))
  localStorage.removeItem(loginNameKey(origin))
}

export const useUserStore = defineStore('user', () => {
  const userId = ref('')

  function getUserId() {
    return userId.value
  }
  function setUserId(newValue: string) {
    userId.value = newValue
    if (newValue) localStorage.setItem(FOUNDRY_USER_ID_KEY, newValue)
  }

  return { userId, getUserId, setUserId }
})
