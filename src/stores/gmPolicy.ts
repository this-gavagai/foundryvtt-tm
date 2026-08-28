import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { ManualRollPolicy } from '@/types/api-types'

// World-scoped GM policy the Foundry module piggybacks on its LISTENER_ONLINE
// announcement (see api/socketSetup.ts). Drives the client-side UX only — the
// manual face picker and Pixel dice affordances gray out proactively — while
// the module's dispatch gate stays authoritative for enforcement.
export const useGmPolicyStore = defineStore('gmPolicy', () => {
  // 'allow' until a module announces otherwise; a module too old to send the
  // field keeps reporting undefined, which also reads as 'allow'.
  const manualRollPolicy = ref<ManualRollPolicy>('allow')
  const manualRollsBlocked = computed(() => manualRollPolicy.value === 'reject')

  function reportPolicy(policy: ManualRollPolicy | undefined) {
    manualRollPolicy.value = policy ?? 'allow'
  }

  // The policy belongs to the world that announced it. On a server/user switch
  // it must not carry over — a new world's affordances would be greyed out (or
  // offered) on the previous world's rule until its module next announces.
  function reset() {
    manualRollPolicy.value = 'allow'
  }

  return { manualRollPolicy, manualRollsBlocked, reportPolicy, reset }
})
