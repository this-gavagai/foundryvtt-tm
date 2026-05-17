import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', () => {
  const userId = ref('')

  function getUserId() {
    return userId.value
  }
  function setUserId(newValue: string) {
    userId.value = newValue
  }

  return { userId, getUserId, setUserId }
})
