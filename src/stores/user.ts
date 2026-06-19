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

function loginUserKey(origin: string): string {
  return `${LOGIN_USER_PREFIX}${origin}`
}

export function rememberLoginUser(origin: string, userid: string): void {
  if (origin && userid) localStorage.setItem(loginUserKey(origin), userid)
}

export function lastLoginUser(origin: string): string {
  if (!origin) return ''
  return (
    localStorage.getItem(loginUserKey(origin)) ??
    localStorage.getItem(LEGACY_LOGIN_USER_KEY) ??
    ''
  )
}

export function forgetLoginUser(origin: string): void {
  localStorage.removeItem(loginUserKey(origin))
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
