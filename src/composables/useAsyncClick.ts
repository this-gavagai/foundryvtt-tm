import { ref } from 'vue'

import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import { logger } from '@/utils/utilities'

// How long the failure indication stays visible on the widget.
const FAILED_FLASH_MS = 1200

export function useAsyncClick(
  clicked: (() => unknown) | undefined,
  disabled: () => boolean | undefined
) {
  const waiting = ref(false)
  const failed = ref(false)
  let failedTimer: ReturnType<typeof setTimeout> | undefined

  function handleClick() {
    if (disabled()) return
    if (!clicked) return
    waiting.value = true
    Promise.resolve(clicked())
      .catch((error) => {
        // Every async widget action funnels through this seam, so a rejected
        // RPC (refused handler, auth denial, timeout, server switch) surfaces
        // as a brief failure flash instead of an unhandled rejection with a
        // silently-stopping spinner.
        logger.warn('TM-WARN: action failed', error)
        failed.value = true
        clearTimeout(failedTimer)
        failedTimer = setTimeout(() => (failed.value = false), FAILED_FLASH_MS)
      })
      .finally(() => (waiting.value = false))
  }

  function handlePointerDown() {
    if (!disabled()) triggerLightHapticFeedback()
  }

  return { waiting, failed, handleClick, handlePointerDown }
}
