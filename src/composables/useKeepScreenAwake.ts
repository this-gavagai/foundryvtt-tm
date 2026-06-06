import { useWakeLock } from '@vueuse/core'

// Keep the screen awake during play (hard to tell if this is working or not).
// The Wake Lock API requires a user gesture, so defer the request until the
// first click, then unbind the one-shot listener.
export function useKeepScreenAwake(): void {
  const { request } = useWakeLock()
  document.addEventListener(
    'click',
    function enableNoSleep() {
      document.removeEventListener('click', enableNoSleep, false)
      request('screen')
    },
    false
  )
}
