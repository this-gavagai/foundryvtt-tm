import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { PROTOCOL_VERSION } from '@/api/protocol'

// Tracks whether the connected Foundry module speaks the same wire protocol as
// this app build. Fed from the LISTENER_ONLINE handler (see api/socketSetup.ts),
// which the module emits on startup and in reply to our presence heartbeat.
export const useVersionCompatStore = defineStore('versionCompat', () => {
  // Protocol version + human-readable release the module last reported. Both are
  // undefined until we've heard from a module — or when a module too old to send
  // them answers, which itself signals an incompatible (pre-handshake) build.
  const moduleProtocol = ref<number | undefined>(undefined)
  const moduleVersion = ref<string | undefined>(undefined)
  const heardFromModule = ref(false)

  // Only assert a mismatch once we've actually heard from a module — before that
  // the absence of data is "not connected yet", not "incompatible".
  const isMismatched = computed(
    () => heardFromModule.value && moduleProtocol.value !== PROTOCOL_VERSION
  )

  function reportModule(protocol: number | undefined, version: string | undefined) {
    heardFromModule.value = true
    moduleProtocol.value = protocol
    moduleVersion.value = version
  }

  return {
    appProtocol: PROTOCOL_VERSION,
    appVersion: __APP_VERSION__,
    moduleProtocol,
    moduleVersion,
    isMismatched,
    reportModule
  }
})
