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

console.log('TM first pixel experience')
const lastRoll = ref<number>()
const pixel = ref<Pixel>()
window.pixel = pixel

const systemIds = useStorage('pixel-system-id', '')

// this shouldn't be necessasry, but not sure how else to make pixel reactive
const pixelStatus = ref<string | undefined>(pixel.value?.status)
setInterval(() => {
  pixelStatus.value = pixel.value?.status
}, 500)

async function pixelConnect() {
  pixel.value = await requestPixel()
  systemIds.value = pixel.value?.systemId
  await setupListeners()
}
async function pixelReconnect() {
  if (!systemIds.value) return
  pixel.value = await getPixel(systemIds.value)
  console.log('TM-pixl: status', pixel.value?.status)
  await setupListeners()
}
async function pixelDisconnect() {
  pixel.value = undefined
  systemIds.value = undefined
}

// setup liseners
async function setupListeners() {
  if (!pixel.value) return
  // Connect to die
  console.log('TM-pixl: Connecting...')
  await repeatConnect(pixel.value)
  console.log('TM-pixl: Connected')
  blink()
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

// utility methods
function getLastRoll() {
  // Get last roll state
  const rollState = pixel.value?.rollState
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
  await pixel.value?.blink(Color.green)
}

// reestablish connection if needed
if (systemIds.value && !pixel.value) {
  console.log('TM: hello dere')
  pixelReconnect()
} else if (pixel.value && pixel.value.status === 'disconnected') {
  setupListeners()
}

export function usePixelDice() {
  return {
    pixelConnect,
    pixelReconnect,
    pixelDisconnect,
    getPixel,
    getLastRoll,
    readStatus,
    pixelStatus,
    blink,
    lastRoll,
    pixel
  }
}
