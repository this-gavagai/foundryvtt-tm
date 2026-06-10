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
