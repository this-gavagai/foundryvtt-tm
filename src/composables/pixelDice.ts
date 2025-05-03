// TODO: be more responsive with pixel dice. Potentially, show result on roll, but give some indication that it hasn't yet been returned from the server?
import { ref } from 'vue'
import {
  repeatConnect,
  requestPixel,
  getPixel,
  Color,
  type Pixel
} from '@systemic-games/pixels-web-connect'
import { useStorage } from '@vueuse/core'

const lastRoll = ref<number>()
const pixel = ref<Pixel>()
window.pixel = pixel

const systemIds = useStorage('pixel-system-id', '')

export function usePixelDice() {
  async function pixelConnect() {
    pixel.value = await requestPixel()
    systemIds.value = pixel.value?.systemId
    await afterConnect()
  }
  async function pixelReconnect() {
    pixel.value = await getPixel(systemIds.value)
    await afterConnect()
  }
  async function pixelDisconnect() {
    pixel.value = undefined
    systemIds.value = undefined
  }

  async function afterConnect() {
    if (!pixel.value) return
    // Connect to die
    console.log('TM-pixl: Connecting...')
    await repeatConnect(pixel.value)

    // Add listener to get notified on rolls
    pixel.value.addEventListener('roll', (face) => {
      console.log(`TM-pixl: => rolled face: ${face}`)
      lastRoll.value = face
    })
    // detect disconnect, and then do...something?
    pixel.value.addEventListener('statusChanged', (status) => {
      console.log(`TM-pixl: Dice status changed to ${status.status}`, status)
      if (status.status === 'disconnected' && pixel.value) repeatConnect(pixel.value)
    })
  }

  function getLastRoll() {
    // Get last roll state
    const rollState = pixel.value?.rollState
    // console.log(`=> roll state: ${(rollState as rolled).state}, face up: ${pixel.face}`)
    return rollState
  }

  async function readStatus() {
    // Read RSSI (signal strength)
    const rssi = await pixel.value?.queryRssi()
    console.log(`=> rssi: ${rssi}`)
    // And battery level
    console.log(`=> Battery: ${pixel.value?.batteryLevel}%`)
  }

  async function blink() {
    // Make LEDs flash a color
    await pixel.value?.blink(Color.red)
  }

  return {
    pixelConnect,
    pixelReconnect,
    pixelDisconnect,
    getPixel,
    getLastRoll,
    readStatus,
    blink,
    lastRoll,
    pixel
  }
}
