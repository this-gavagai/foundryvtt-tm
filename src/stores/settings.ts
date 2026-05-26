import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', () => {
  const skipCharacterAlts = ref(false)
  // When enabled, InfoModal shows a per-die face picker so the user can manually
  // select dice results that get fed into Foundry instead of (or alongside) a
  // Pixel Die roll.
  const manualDicePicker = ref(false)

  return { skipCharacterAlts, manualDicePicker }
})
