import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', () => {
  const skipCharacterAlts = ref(false)

  return { skipCharacterAlts }
})
