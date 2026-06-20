import { Capacitor } from '@capacitor/core'
import type { Color, Pixel } from '@systemic-games/pixels-web-connect'

// Unified surface the Pixel store needs, regardless of transport. The web build
// gets these straight from `@systemic-games/pixels-web-connect` (Web Bluetooth);
// native (Capacitor) builds get a thin reimplementation over the
// `@capacitor-community/bluetooth-le` plugin, since `navigator.bluetooth` does
// not exist in the iOS/Android WebView.
export interface PixelApi {
  /** Prompt the user to pick a die to pair, returning its Pixel instance. */
  requestPixel(): Promise<Pixel>
  /** Resolve an already-paired die by systemId, or undefined if not found. */
  getPixel(systemId: string): Promise<Pixel | undefined>
  /** SDK auto-reconnect loop (transport-agnostic, lives in the core package). */
  repeatConnect(pixel: Pixel): Promise<unknown>
  Color: typeof Color
}

// True inside a Capacitor native shell (iOS/Android), false in a normal browser.
export const isNativeBluetooth = Capacitor.isNativePlatform()

// Whether dice pairing is even possible here. Native shells use the BLE plugin
// (assumed present); browsers need Web Bluetooth, which is absent in
// Firefox/Safari/iOS-Safari and over insecure (non-HTTPS) origins.
export const bluetoothSupported =
  isNativeBluetooth || (typeof navigator !== 'undefined' && 'bluetooth' in navigator)

// Lazy-loaded and cached: the SDK / plugin is only pulled in once the user
// actually engages with dice, keeping it out of the initial bundle.
let apiPromise: Promise<PixelApi> | undefined
export function loadPixelApi(): Promise<PixelApi> {
  return (apiPromise ??= isNativeBluetooth ? loadNativeApi() : loadWebApi())
}

async function loadWebApi(): Promise<PixelApi> {
  const m = await import('@systemic-games/pixels-web-connect')
  return {
    requestPixel: m.requestPixel,
    getPixel: m.getPixel,
    repeatConnect: m.repeatConnect,
    Color: m.Color
  }
}

async function loadNativeApi(): Promise<PixelApi> {
  const [core, { Color }, { CapacitorBleSession }, { BleClient }] = await Promise.all([
    import('@systemic-games/pixels-core-connect'),
    import('@systemic-games/pixels-core-animation'),
    import('./CapacitorBleSession'),
    import('@capacitor-community/bluetooth-le')
  ])
  const { Pixel, PixelsBluetoothIds, repeatConnect } = core

  await BleClient.initialize()

  // The store relies on requestPixel()/getPixel() returning the *same* Pixel
  // instance per systemId (its listener teardown is keyed by systemId), so cache
  // them here exactly as the web package does internally.
  const pixelsById = new Map<string, Pixel>()
  function getOrCreate(deviceId: string, name?: string): Pixel {
    let pixel = pixelsById.get(deviceId)
    if (!pixel) {
      pixel = new Pixel(new CapacitorBleSession(deviceId, name))
      pixelsById.set(deviceId, pixel)
    }
    return pixel
  }

  return {
    async requestPixel() {
      // The plugin's requestDevice supports a single AND-filter, not Web
      // Bluetooth's OR-of-filters, so we filter on the legacy service — the one
      // the shipped web SDK uses for the actual GATT connection, i.e. the layout
      // real dice expose. Newer dice that advertise only the non-legacy service
      // would need the `die.service` filter or a custom scan UI instead.
      const device = await BleClient.requestDevice({
        services: [PixelsBluetoothIds.legacyDie.service]
      })
      return getOrCreate(device.deviceId, device.name)
    },
    async getPixel(systemId: string) {
      // deviceId is stable across launches on both platforms, so we can build a
      // session straight from it; the die's name/type are learned over the
      // protocol once connected.
      return getOrCreate(systemId)
    },
    repeatConnect,
    Color
  }
}
