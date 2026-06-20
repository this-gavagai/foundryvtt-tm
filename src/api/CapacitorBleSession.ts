import { BleClient, type BleService } from '@capacitor-community/bluetooth-le'
import { PixelSession, PixelsBluetoothIds } from '@systemic-games/pixels-core-connect'
import { logger } from '@/utils/utilities'

// A Pixel die exposes one of two GATT service layouts depending on firmware
// generation. We don't trust the hard-coded characteristic UUIDs (the shipped
// web SDK's `legacyDie` set even lists notify === service, which is a quirk of
// that data); instead we match the *service* against either known UUID and then
// pick the actual notify/write characteristics by their declared properties.
const PIXEL_SERVICE_UUIDS = [
  PixelsBluetoothIds.die.service,
  PixelsBluetoothIds.legacyDie.service
].map((u) => u.toLowerCase())

/**
 * A {@link PixelSession} backed by the native `@capacitor-community/bluetooth-le`
 * plugin. This replaces the Web Bluetooth transport used by
 * `@systemic-games/pixels-web-connect` on Capacitor (iOS/Android) builds, where
 * `navigator.bluetooth` does not exist in the WebView.
 *
 * The systemId is the plugin's `deviceId`: a per-app UUID on iOS, the BLE MAC on
 * Android. It is stable across launches, so reconnecting a saved die needs no
 * fresh scan.
 */
export class CapacitorBleSession extends PixelSession {
  // Resolved at connect time from on-device service discovery.
  private _service?: string
  private _notify?: string
  private _write?: string
  private _connected = false

  async connect(timeoutMs: number): Promise<void> {
    if (!this._connected) {
      this._notifyConnectionEvent('connecting')
      try {
        await BleClient.connect(
          this._systemId,
          () => {
            // Fired by the OS when the link drops (not on our own disconnect()).
            this._connected = false
            this._service = this._notify = this._write = undefined
            this._notifyConnectionEvent('disconnected', 'linkLoss')
          },
          timeoutMs > 0 ? { timeout: timeoutMs } : undefined
        )
      } catch (e) {
        this._notifyConnectionEvent('disconnected', 'host')
        throw e
      }
      this._connected = true
      this._notifyConnectionEvent('connected')
      this._resolveCharacteristics(await BleClient.getServices(this._systemId))
    }
    // Always re-announce ready so a listener attached after connection still
    // gets the event — mirrors the web BleSession's behaviour.
    this._notifyConnectionEvent('ready')
  }

  private _resolveCharacteristics(services: BleService[]) {
    const svc = services.find((s) => PIXEL_SERVICE_UUIDS.includes(s.uuid.toLowerCase()))
    if (!svc) {
      throw new Error(`TM-pixl: no Pixel service on device ${this._systemId}`)
    }
    const notify = svc.characteristics.find((c) => c.properties.notify || c.properties.indicate)
    const write = svc.characteristics.find(
      (c) => c.properties.write || c.properties.writeWithoutResponse
    )
    if (!notify || !write) {
      throw new Error(`TM-pixl: Pixel notify/write characteristics not found on ${this._systemId}`)
    }
    this._service = svc.uuid
    this._notify = notify.uuid
    this._write = write.uuid
  }

  async disconnect(): Promise<void> {
    this._connected = false
    this._service = this._notify = this._write = undefined
    await BleClient.disconnect(this._systemId).catch((e) =>
      logger.debug('TM-pixl: disconnect ignored', this._systemId, e)
    )
  }

  async subscribe(listener: (dataView: DataView) => void): Promise<() => void> {
    if (!this._service || !this._notify) {
      throw new Error('TM-pixl: subscribe before connect')
    }
    const service = this._service
    const notify = this._notify
    await BleClient.startNotifications(this._systemId, service, notify, (value) => {
      if (value?.byteLength) listener(value)
    })
    return () => {
      BleClient.stopNotifications(this._systemId, service, notify).catch((e) =>
        logger.debug('TM-pixl: stopNotifications ignored', this._systemId, e)
      )
    }
  }

  async writeValue(data: ArrayBuffer, withoutResponse?: boolean): Promise<void> {
    if (!this._service || !this._write) {
      throw new Error('TM-pixl: writeValue before connect')
    }
    const view = new DataView(data)
    if (withoutResponse) {
      await BleClient.writeWithoutResponse(this._systemId, this._service, this._write, view)
    } else {
      await BleClient.write(this._systemId, this._service, this._write, view)
    }
  }

  dispose(): void {
    this.setConnectionEventListener(undefined)
    BleClient.disconnect(this._systemId).catch(() => undefined)
  }
}
