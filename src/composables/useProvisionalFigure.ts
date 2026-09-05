import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'

// The attributes and tooltip that mark a number the sheet did not get from PF2e.
//
// Two different doubts share one visual language (see the dotted underline in
// themes/core/_core.css), and they are not equally urgent:
//
//   stale        PF2e's own number, gone out of date because a write landed
//                with no GM to recompute it. Correct as of the last payload.
//   provisional  this device's arithmetic standing in for a number that never
//                arrived, with the rule engine's gaps named.
//
// Stale wins when both are true: "waiting for the GM" is the actionable half,
// and a figure cannot really be both — a provisional number has no GM answer to
// have gone stale.
export function useProvisionalFigure(
  stale: Ref<boolean> | ComputedRef<boolean>,
  provisional: Ref<boolean | undefined> | ComputedRef<boolean | undefined>,
  caveat: Ref<string | undefined> | ComputedRef<string | undefined>
) {
  const { t } = useI18n()
  return {
    attrs: computed(() => ({
      'data-derived-stale': stale.value || undefined,
      'data-derived-provisional': (!stale.value && provisional.value) || undefined,
      title: stale.value
        ? t('sync.awaitingGm')
        : provisional.value
          ? t('sync.provisional', { caveat: caveat.value ?? '' })
          : undefined
    }))
  }
}
