import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const MANUAL_DICE_PICKER_KEY = 'tm-manual-dice-picker'

function loadManualDicePicker(): boolean {
  return localStorage.getItem(MANUAL_DICE_PICKER_KEY) === '1'
}

export const useSettingsStore = defineStore('settings', () => {
  const skipCharacterAlts = ref(false)
  // When enabled, InfoModal shows a per-die face picker so the user can manually
  // select dice results that get fed into Foundry instead of (or alongside) a
  // Pixel Die roll. Persisted to localStorage so the preference survives reloads.
  const manualDicePicker = ref(loadManualDicePicker())
  watch(manualDicePicker, (v) => {
    if (v) localStorage.setItem(MANUAL_DICE_PICKER_KEY, '1')
    else localStorage.removeItem(MANUAL_DICE_PICKER_KEY)
  })

  return { skipCharacterAlts, manualDicePicker }
})
