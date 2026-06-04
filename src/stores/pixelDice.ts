import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Pixel, PixelDieType } from '@systemic-games/pixels-web-connect'
import { useStorage } from '@vueuse/core'
import { logger } from '@/utils/utilities'

// Lazy-load the Pixel SDK. The library is ~30 KB gzipped and only needed
// when the user actually pairs a die — most users will never trigger this.
// The returned promise is cached so subsequent calls are free.
let sdkPromise: Promise<typeof import('@systemic-games/pixels-web-connect')> | undefined
function loadSdk() {
  return (sdkPromise ??= import('@systemic-games/pixels-web-connect'))
}

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
    pixel.addEventListener('roll', (face) => {
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
    })

    pixel.addEventListener('statusChanged', (status) => {
      logger.debug(`TM-pixl: ${pixel.name} status -> ${status.status}`)
      patchPixel(pixel.systemId, { status: status.status })
      // Hand a dropped connection back to the SDK's repeatConnect — it owns
      // backoff so we don't have to. We still keep the die in `pixels` so
      // the UI shows it as "disconnected (reconnecting)" rather than gone.
      if (status.status === 'disconnected') {
        loadSdk()
          .then(({ repeatConnect }) => repeatConnect(pixel))
          .catch((e) => logger.warn('TM-pixl: repeatConnect failed', pixel.systemId, e))
      }
    })

    pixel.addEventListener('battery', (battery) => {
      patchPixel(pixel.systemId, { batteryLevel: battery.level })
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
    const { repeatConnect, Color } = await loadSdk()
    await repeatConnect(pixel)
    patchPixel(pixel.systemId, {
      status: pixel.status,
      batteryLevel: pixel.batteryLevel,
      dieType: pixel.dieType,
      dieFaceCount: pixel.dieFaceCount,
      name: pixel.name
    })
    pixel.blink(Color.green).catch(() => undefined)
  }

  // Open the Web Bluetooth chooser to add a new die. The SDK persists the
  // pairing at the OS level; we only persist the resulting system ID so we
  // can re-resolve the Pixel object on the next session.
  async function pairDie() {
    const { requestPixel } = await loadSdk()
    const pixel = await requestPixel()
    await registerPixel(pixel)
  }

  // Re-resolve an already-paired die by system ID. Used both on store init
  // and from the UI when the user wants to wake a sleeping die.
  async function reconnectDie(systemId: string) {
    const { getPixel } = await loadSdk()
    const pixel = await getPixel(systemId)
    if (!pixel) {
      logger.warn(`TM-pixl: getPixel returned no pixel for ${systemId}`)
      return
    }
    await registerPixel(pixel)
  }

  async function forgetDie(systemId: string) {
    pixels.value = pixels.value.filter((p) => p.systemId !== systemId)
    systemIds.value = systemIds.value.filter((id) => id !== systemId)
  }

  // Fan out the initial reconnect for every saved die. Errors per-die are
  // logged but don't block the others — a single missing/dead die shouldn't
  // strand the rest.
  for (const id of systemIds.value) {
    reconnectDie(id).catch((e) => logger.warn('TM-pixl: initial reconnect failed', id, e))
  }

  return {
    pixels,
    lastRoll,
    pairDie,
    reconnectDie,
    forgetDie
  }
})
