// TODO (feature): handle multiple dice
// TODO (bug): rolling dice with damage infoModal (or action infomodal) open still rolls a strike, even though no dice are requested. needs another sanity check

import { ref } from 'vue'
import {
  repeatConnect,
  requestPixel,
  getPixel,
  Color,
  type Pixel
} from '@systemic-games/pixels-web-connect'
import { useStorage } from '@vueuse/core'

export const lastRoll = ref<number>()
export const pixel = ref<Pixel>()
window.pixel = pixel

const systemIds = useStorage('pixel-system-id', '')

export function usePixelDice() {
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
      const reconnectLoop = async () => {
        if (!pixel.value) return
        console.log('trying again')
        await repeatConnect(pixel.value)
        if (pixel.value.status !== 'ready') setTimeout(reconnectLoop, 5000)
      }
      if (status.status === 'disconnected') reconnectLoop()
    })
  }

  async function pixelConnect() {
    pixel.value = await requestPixel()
    systemIds.value = pixel.value?.systemId
    await afterConnect()
  }

  async function pixelReconnect() {
    pixel.value = await getPixel(systemIds.value)
    await afterConnect()
  }

  function getLastRoll() {
    // Get last roll state
    const rollState = pixel.value?.rollState
    // console.log(`=> roll state: ${(rollState as rolled).state}, face up: ${pixel.face}`)
    return rollState
  }

  // function getPixel() {
  //   if (pixel.value) return pixel
  // }

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

  return { pixelConnect, pixelReconnect, getPixel, getLastRoll, readStatus, blink, lastRoll, pixel }
}
