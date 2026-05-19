// TODO: be more responsive with pixel dice. Potentially, show result on roll, but give some indication that it hasn't yet been returned from the server?
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Pixel } from '@systemic-games/pixels-web-connect'
import { useStorage } from '@vueuse/core'
import { logger } from '@/utils/utilities'

// Lazy-load the Pixel SDK. The library is ~30 KB gzipped and only needed
// when the user actually pairs a die — most users will never trigger this.
// The returned promise is cached so subsequent calls are free.
let sdkPromise: Promise<typeof import('@systemic-games/pixels-web-connect')> | undefined
function loadSdk() {
  return (sdkPromise ??= import('@systemic-games/pixels-web-connect'))
}

export const usePixelDiceStore = defineStore('pixelDice', () => {
  const lastRoll = ref<number>()
  const pixel = ref<Pixel>()
  if (import.meta.env.DEV) window.pixel = pixel

  const systemIds = useStorage('pixel-system-id', '')

  // Mirror of pixel.status as a reactive ref. The underlying Pixel object
  // is an external class instance and not reactive, so we drive this from
  // the SDK's statusChanged event (registered in setupListeners) plus a
  // post-connect read.
  const pixelStatus = ref<string | undefined>(pixel.value?.status)

  async function pixelConnect() {
    const { requestPixel } = await loadSdk()
    pixel.value = await requestPixel()
    systemIds.value = pixel.value?.systemId
    await setupListeners()
  }
  async function pixelReconnect() {
    if (!systemIds.value) return
    const { getPixel } = await loadSdk()
    pixel.value = await getPixel(systemIds.value)
    logger.debug('TM-pixl: status', pixel.value?.status)
    await setupListeners()
  }
  async function pixelDisconnect() {
    pixel.value = undefined
    pixelStatus.value = undefined
    systemIds.value = undefined
  }

  // setup listeners
  async function setupListeners() {
    if (!pixel.value) return
    const { repeatConnect } = await loadSdk()
    // Connect to die
    logger.debug('TM-pixl: Connecting...')
    await repeatConnect(pixel.value)
    logger.debug('TM-pixl: Connected')
    pixelStatus.value = pixel.value.status
    blink()
    // Add listener to get notified on rolls
    pixel.value.addEventListener('roll', (face) => {
      logger.debug(`TM-pixl: => rolled face: ${face}`)
      lastRoll.value = face
    })
    // Mirror status changes onto the reactive pixelStatus ref, and trigger
    // a reconnect if we get unexpectedly dropped.
    pixel.value.addEventListener('statusChanged', (status) => {
      logger.debug(`TM-pixl: Dice status changed to ${status.status}`, status)
      pixelStatus.value = status.status
      if (status.status === 'disconnected' && pixel.value) repeatConnect(pixel.value)
    })
  }

  // utility methods
  function getLastRoll() {
    // Get last roll state
    const rollState = pixel.value?.rollState
    return rollState
  }

  async function readStatus() {
    // Read RSSI (signal strength)
    const rssi = await pixel.value?.queryRssi()
    logger.debug(`=> rssi: ${rssi}`)
    // And battery level
    logger.debug(`=> Battery: ${pixel.value?.batteryLevel}%`)
  }

  async function blink() {
    const { Color } = await loadSdk()
    // Make LEDs flash a color
    await pixel.value?.blink(Color.green)
  }

  // Reestablish connection if the user has previously paired a die. This
  // triggers the SDK download — but only for returning Pixel users, not
  // first-time visitors.
  if (systemIds.value && !pixel.value) {
    logger.debug('TM: hello dere')
    pixelReconnect()
  } else if (pixel.value && pixel.value.status === 'disconnected') {
    setupListeners()
  }

  return {
    lastRoll,
    pixel,
    pixelStatus,
    pixelConnect,
    pixelReconnect,
    pixelDisconnect,
    getLastRoll,
    readStatus,
    blink
  }
})
