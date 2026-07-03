import { ref, watch } from 'vue'
import { useInjectedActor } from '@/composables/injectKeys'

// Returns a flag that starts false and flips true one animation frame after the
// character's initial data has painted. Gate entrance transitions on it so a
// freshly loaded sheet — whether hydrated from the IndexedDB cache or the first
// live fetch — shows its content at rest instead of animating each piece in,
// while changes the user makes later in the session still animate.
//
// `_actor` (rather than any derived list) is the signal: most derived fields
// are always-defined and so can't distinguish "data arriving on load" from "the
// user changed something." Must be called from within a sheet that provides
// the actor injection.
export function useAnimationsReady() {
  const { _actor } = useInjectedActor()
  const animationsReady = ref(false)
  const stop = watch(
    () => !!_actor.value,
    (loaded) => {
      if (!loaded) return
      // Let this first populated frame paint un-animated before enabling.
      requestAnimationFrame(() => {
        animationsReady.value = true
      })
      // Defer the unsubscribe so it's safe even when `immediate` runs this
      // callback synchronously, before `stop` has been assigned.
      void Promise.resolve().then(() => stop?.())
    },
    { immediate: true }
  )
  return animationsReady
}
