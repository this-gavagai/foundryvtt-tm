import { ref } from 'vue'

import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

export function useAsyncClick(
  clicked: (() => unknown) | undefined,
  disabled: () => boolean | undefined
) {
  const waiting = ref(false)

  function handleClick() {
    if (disabled()) return
    if (!clicked) return
    waiting.value = true
    Promise.resolve(clicked()).finally(() => (waiting.value = false))
  }

  function handlePointerDown() {
    if (!disabled()) triggerLightHapticFeedback()
  }

  return { waiting, handleClick, handlePointerDown }
}
