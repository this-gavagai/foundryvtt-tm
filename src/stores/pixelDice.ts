import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Pixel, PixelDieType } from '@systemic-games/pixels-web-connect'
import { useStorage } from '@vueuse/core'
import { logger } from '@/utils/utilities'
import { bluetoothSupported, loadPixelApi } from '@/api/pixelTransport'

// Reactive snapshot of a paired die. The underlying `pixel` instance is the
// SDK class, which is not reactive itself; we mirror the properties we care
// about so Vue can rerender on connect/battery/status changes without us
// having to expose the raw class to the template layer.
export interface PairedPixel {
  systemId: string
  name: string
  dieType: PixelDieType
  dieFaceCount: number
  status: string
  batteryLevel: number
  pixel: Pixel
}

// One physical die roll. `seq` is a per-store monotonic counter so watchers
// fire on every roll even when a die rolls the same face twice in a row
// (ref equality on a primitive face number would dedupe those out).
export interface PixelRollEvent {
  systemId: string
  dieType: PixelDieType
  dieFaceCount: number
  face: number
  seq: number
}

export const usePixelDiceStore = defineStore('pixelDice', () => {
  const pixels = ref<PairedPixel[]>([])
  const lastRoll = ref<PixelRollEvent>()
  let rollSeq = 0
  // i18n key of the last pairing failure, or undefined when there's nothing to
  // show. The component translates it (client-locale UI chrome). Cleared at the
  // start of every pair attempt.
  const pairError = ref<string>()

  // The set of die face counts (20, 8, …) that have a currently-ready die.
  // Computed once here and shared so the many mounted InfoModal instances
  // don't each rebuild this Set on every periodic battery/status event.
  const readyFaceCounts = computed(
    () => new Set(pixels.value.filter((p) => p.status === 'ready').map((p) => p.dieFaceCount))
  )
  // Tracks which systemIds have an active repeatConnect in flight, to prevent
  // the statusChanged('disconnected') handler from spawning a second one while
  // repeatConnect is already looping through its own retry cycle.
  const reconnectingIds = new Set<string>()
  // Per-die teardown for the SDK event listeners. getPixel()/requestPixel()
  // return the *same* Pixel instance for a given systemId, so re-registering
  // (manual reconnect) would stack duplicate listeners and fire each roll
  // twice. We key the teardown by systemId so attach is idempotent and forget
  // can fully unsubscribe.
  const detachers = new Map<string, () => void>()

  // Persisted list of paired system IDs. Reconnect on every page load.
  const systemIds = useStorage<string[]>('pixel-system-ids', [])

  // One-time migration from the legacy single-value key. Older builds stored
  // a single string in 'pixel-system-id'; fold it in so users don't have to
  // re-pair on upgrade. Cleared once migrated so the migration doesn't run
  // again.
  const legacyId = localStorage.getItem('pixel-system-id')
  if (legacyId) {
    if (!systemIds.value.includes(legacyId)) systemIds.value = [...systemIds.value, legacyId]
    localStorage.removeItem('pixel-system-id')
  }

  if (import.meta.env.DEV) window.pixels = pixels

  function snapshot(pixel: Pixel): PairedPixel {
    return {
      systemId: pixel.systemId,
      name: pixel.name,
      dieType: pixel.dieType,
      dieFaceCount: pixel.dieFaceCount,
      status: pixel.status,
      batteryLevel: pixel.batteryLevel,
      pixel
    }
  }

  function patchPixel(systemId: string, patch: Partial<PairedPixel>) {
    const idx = pixels.value.findIndex((p) => p.systemId === systemId)
    if (idx === -1) return
    pixels.value[idx] = { ...pixels.value[idx], ...patch }
  }

  // Wire SDK events on a freshly resolved Pixel. Listeners read live props
  // off the same Pixel instance at fire time, so they always reflect the
  // current die type / face count even if the SDK updates them post-connect.
  function attachListeners(pixel: Pixel) {
    // Idempotent: drop any prior subscription for this systemId first, since
    // the SDK hands back the same Pixel instance on re-registration.
    detachers.get(pixel.systemId)?.()

    const onRoll = (face: number) => {
      rollSeq += 1
      const event: PixelRollEvent = {
        systemId: pixel.systemId,
        dieType: pixel.dieType,
        dieFaceCount: pixel.dieFaceCount,
        face,
        seq: rollSeq
      }
      logger.debug('TM-pixl: roll', event)
      lastRoll.value = event
    }

    const onStatusChanged = (status: { status: string }) => {
      logger.debug(`TM-pixl: ${pixel.name} status -> ${status.status}`)
      patchPixel(pixel.systemId, { status: status.status })
      // Hand a dropped connection back to the SDK's repeatConnect — it owns
      // backoff so we don't have to. We still keep the die in `pixels` so
      // the UI shows it as "disconnected (reconnecting)" rather than gone.
      if (status.status === 'disconnected' && !reconnectingIds.has(pixel.systemId)) {
        reconnectingIds.add(pixel.systemId)
        loadPixelApi()
          .then(({ repeatConnect }) => repeatConnect(pixel))
          .catch((e) => logger.warn('TM-pixl: repeatConnect failed', pixel.systemId, e))
          .finally(() => reconnectingIds.delete(pixel.systemId))
      }
    }

    const onBattery = (battery: { level: number }) => {
      patchPixel(pixel.systemId, { batteryLevel: battery.level })
    }

    pixel.addEventListener('roll', onRoll)
    pixel.addEventListener('statusChanged', onStatusChanged)
    pixel.addEventListener('battery', onBattery)

    detachers.set(pixel.systemId, () => {
      pixel.removeEventListener('roll', onRoll)
      pixel.removeEventListener('statusChanged', onStatusChanged)
      pixel.removeEventListener('battery', onBattery)
    })
  }

  async function registerPixel(pixel: Pixel) {
    attachListeners(pixel)
    const idx = pixels.value.findIndex((p) => p.systemId === pixel.systemId)
    if (idx === -1) pixels.value = [...pixels.value, snapshot(pixel)]
    else pixels.value[idx] = snapshot(pixel)
    if (!systemIds.value.includes(pixel.systemId)) {
      systemIds.value = [...systemIds.value, pixel.systemId]
    }
    // A connect is already looping for this die (e.g. the auto-reconnect from
    // a statusChanged drop, or a double-click). The snapshot + listeners above
    // are now in place; don't stack a second concurrent repeatConnect.
    if (reconnectingIds.has(pixel.systemId)) return
    const { repeatConnect, Color } = await loadPixelApi()
    reconnectingIds.add(pixel.systemId)
    try {
      await repeatConnect(pixel)
    } finally {
      reconnectingIds.delete(pixel.systemId)
    }
    patchPixel(pixel.systemId, {
      status: pixel.status,
      batteryLevel: pixel.batteryLevel,
      dieType: pixel.dieType,
      dieFaceCount: pixel.dieFaceCount,
      name: pixel.name
    })
    pixel.blink(Color.green).catch(() => undefined)
  }

  // Open the device chooser to add a new die. The transport persists the
  // pairing at the OS level; we only persist the resulting system ID so we
  // can re-resolve the Pixel object on the next session.
  async function pairDie() {
    pairError.value = undefined
    if (!bluetoothSupported) {
      pairError.value = window.isSecureContext ? 'pixel.noBluetooth' : 'pixel.insecureContext'
      return
    }
    try {
      const { requestPixel } = await loadPixelApi()
      const pixel = await requestPixel()
      await registerPixel(pixel)
    } catch (e) {
      // The user dismissing the chooser is a cancel, not a failure — stay quiet.
      // Web Bluetooth throws NotFoundError; the native plugin rejects with a
      // "cancelled" message instead. Anything else is a real problem.
      const err = e as Error
      if (err?.name === 'NotFoundError' || /cancel/i.test(err?.message ?? '')) return
      logger.warn('TM-pixl: pairDie failed', e)
      pairError.value = 'pixel.pairFailed'
    }
  }

  // Re-resolve an already-paired die by system ID. Used both on store init
  // and from the UI when the user wants to wake a sleeping die.
  async function reconnectDie(systemId: string) {
    const { getPixel } = await loadPixelApi()
    const pixel = await getPixel(systemId)
    if (!pixel) {
      logger.warn(`TM-pixl: getPixel returned no pixel for ${systemId}`)
      return
    }
    await registerPixel(pixel)
  }

  async function forgetDie(systemId: string) {
    const entry = pixels.value.find((p) => p.systemId === systemId)
    pixels.value = pixels.value.filter((p) => p.systemId !== systemId)
    systemIds.value = systemIds.value.filter((id) => id !== systemId)
    reconnectingIds.delete(systemId)
    // Unsubscribe before disconnecting so the resulting statusChanged event
    // can't re-arm the auto-reconnect path and resurrect a die the user just
    // forgot. Without this the listeners (and roll → lastRoll forwarding) also
    // leak for the life of the SDK's cached Pixel instance.
    detachers.get(systemId)?.()
    detachers.delete(systemId)
    await entry?.pixel.disconnect().catch(() => undefined)
  }

  // Fan out the initial reconnect for every saved die. Errors per-die are
  // logged but don't block the others — a single missing/dead die shouldn't
  // strand the rest. Kept out of the store setup body (idempotent) so
  // instantiating the store in a test doesn't reach for Bluetooth; the app
  // calls start() once at bootstrap.
  let started = false
  function start(): void {
    if (started) return
    started = true
    for (const id of systemIds.value) {
      reconnectDie(id).catch((e) => logger.warn('TM-pixl: initial reconnect failed', id, e))
    }
  }

  return {
    pixels,
    lastRoll,
    readyFaceCounts,
    bluetoothSupported,
    pairError,
    pairDie,
    reconnectDie,
    forgetDie,
    start
  }
})
