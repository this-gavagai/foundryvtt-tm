import { ref } from 'vue'

const skipCharacterAlts = ref(true)

export function useSettings() {
  return { skipCharacterAlts }
}
