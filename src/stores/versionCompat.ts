import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { PROTOCOL_VERSION, CAPABILITY_VOICE_MEMO, CAPABILITY_IMAGE_UPLOAD } from '@/api/protocol'

// Tracks whether the connected Foundry module speaks the same wire protocol as
// this app build. Fed from the LISTENER_ONLINE handler (see api/socketSetup.ts),
// which the module emits on startup and in reply to our presence heartbeat.
export const useVersionCompatStore = defineStore('versionCompat', () => {
  // Protocol version + human-readable release the module last reported. Both are
  // undefined until we've heard from a module — or when a module too old to send
  // them answers, which itself signals an incompatible (pre-handshake) build.
  const moduleProtocol = ref<number | undefined>(undefined)
  const moduleVersion = ref<string | undefined>(undefined)
  // Additive feature flags the connected module advertised (see CAPABILITY_* in
  // protocol.ts). Empty until we've heard from a module, or when an older module
  // that predates the capability handshake answers.
  const moduleCapabilities = ref<string[]>([])
  const heardFromModule = ref(false)

  // Only assert a mismatch once we've actually heard from a module — before that
  // the absence of data is "not connected yet", not "incompatible".
  const isMismatched = computed(
    () => heardFromModule.value && moduleProtocol.value !== PROTOCOL_VERSION
  )

  // Gate for the voice-memo composer: a module too old to advertise the
  // capability simply doesn't offer it, so the app hides the affordance rather
  // than sending an RPC the module would reject.
  const supportsVoiceMemo = computed(() => moduleCapabilities.value.includes(CAPABILITY_VOICE_MEMO))

  // Gate for the composer's image-attach button, mirroring supportsVoiceMemo: a
  // module too old to advertise the capability (or a world with no configured
  // upload folder) simply doesn't offer image attachments.
  const supportsImageUpload = computed(() =>
    moduleCapabilities.value.includes(CAPABILITY_IMAGE_UPLOAD)
  )

  function reportModule(
    protocol: number | undefined,
    version: string | undefined,
    capabilities: string[] | undefined = []
  ) {
    heardFromModule.value = true
    moduleProtocol.value = protocol
    moduleVersion.value = version
    moduleCapabilities.value = capabilities ?? []
  }

  return {
    appProtocol: PROTOCOL_VERSION,
    appVersion: __APP_VERSION__,
    moduleProtocol,
    moduleVersion,
    moduleCapabilities,
    supportsVoiceMemo,
    supportsImageUpload,
    isMismatched,
    reportModule
  }
})
