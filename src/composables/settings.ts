import { ref } from 'vue'

const skipCharacterAlts = ref(false)

export function useSettings() {
  return { skipCharacterAlts }
}
