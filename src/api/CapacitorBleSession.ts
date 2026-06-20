import { BleClient, type BleService } from '@capacitor-community/bluetooth-le'
import { PixelSession, PixelsBluetoothIds } from '@systemic-games/pixels-core-connect'
import { logger } from '@/utils/utilities'

// A Pixel die exposes one of two GATT service layouts depending on firmware
// generation. The legacy layout is the one the shipped web SDK connects against,
// so we try it first, then the newer one. We don't trust the SDK's hard-coded
// characteristic UUIDs (its `legacyDie` set even lists notify === service, a
// quirk of that data); instead we match the *service* by UUID and then pick the
// notify/write characteristics by their declared properties.
const PIXEL_SERVICE_UUIDS = [
  PixelsBluetoothIds.legacyDie.service,
  PixelsBluetoothIds.die.service
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
  // Which write modes the resolved write characteristic actually supports. iOS
  // hangs (then times out) on a with-response write to a characteristic that
  // only advertises write-without-response, so we must honour these.
  private _canWrite = false
  private _canWriteNoResponse = false
  private _connected = false

  async connect(timeoutMs: number): Promise<void> {
    // Already connected and set up (e.g. repeatConnect calling again): just
    // re-announce ready so a freshly attached listener gets the event.
    if (this._connected && this._service) {
      this._notifyConnectionEvent('ready')
      return
    }
    this._notifyConnectionEvent('connecting')
    try {
      await BleClient.connect(
        this._systemId,
        () => {
          // Fired by the OS when the link drops (not on our own disconnect()).
          this._resetLink()
          this._notifyConnectionEvent('disconnected', 'linkLoss')
        },
        timeoutMs > 0 ? { timeout: timeoutMs } : undefined
      )
      this._notifyConnectionEvent('connected')
      const services = await BleClient.getServices(this._systemId)
      this._resolveCharacteristics(services)
      this._connected = true
    } catch (e) {
      // Reset so a repeatConnect retry re-runs the *whole* sequence rather than
      // skipping straight to subscribe with no resolved characteristics.
      this._resetLink()
      await BleClient.disconnect(this._systemId).catch(() => undefined)
      logger.warn('TM-pixl: connect failed', this._systemId, e)
      this._notifyConnectionEvent('disconnected', 'host')
      throw e
    }
    this._notifyConnectionEvent('ready')
  }

  private _resetLink() {
    this._connected = false
    this._service = this._notify = this._write = undefined
    this._canWrite = this._canWriteNoResponse = false
  }

  private _resolveCharacteristics(services: BleService[]) {
    for (const wanted of PIXEL_SERVICE_UUIDS) {
      const svc = services.find((s) => s.uuid.toLowerCase() === wanted)
      if (!svc) continue
      const notify = svc.characteristics.find((c) => c.properties.notify || c.properties.indicate)
      const write = svc.characteristics.find(
        (c) => c.properties.write || c.properties.writeWithoutResponse
      )
      if (notify && write) {
        this._service = svc.uuid
        this._notify = notify.uuid
        this._write = write.uuid
        this._canWrite = write.properties.write
        this._canWriteNoResponse = write.properties.writeWithoutResponse
        // warn-level so it survives a production build during field debugging.
        logger.warn(
          `TM-pixl: resolved ${this._systemId} svc=${svc.uuid} notify=${notify.uuid} ` +
            `write=${write.uuid} (write=${this._canWrite} writeNoResp=${this._canWriteNoResponse})`
        )
        return
      }
    }
    // Rich error: the store logs this on pair failure, so we see exactly what the
    // device exposed when no usable Pixel service/characteristics were found.
    const dump = services.map((s) => ({
      uuid: s.uuid,
      chars: s.characteristics.map((c) => ({ uuid: c.uuid, ...c.properties }))
    }))
    throw new Error(`TM-pixl: no usable Pixel service on ${this._systemId}: ${JSON.stringify(dump)}`)
  }

  async disconnect(): Promise<void> {
    this._resetLink()
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
    // The Pixels serializer hands us a raw ArrayBuffer for full messages but a
    // Uint8Array for type-only ones (e.g. WhoAreYou). Web Bluetooth accepts
    // either; the plugin needs a DataView, and `new DataView(typedArray)` throws
    // ("Expected ArrayBuffer"), so view the typed array's own buffer region.
    const source = data as ArrayBuffer | ArrayBufferView
    const view = ArrayBuffer.isView(source)
      ? new DataView(source.buffer, source.byteOffset, source.byteLength)
      : new DataView(source)
    // Honour the requested mode when the characteristic supports it, otherwise
    // fall back to the mode it does support. Pixels acknowledge at the protocol
    // level (a reply over the notify characteristic), not via the BLE write
    // response, so a without-response write loses nothing functionally.
    const useNoResponse = withoutResponse ? this._canWriteNoResponse : !this._canWrite
    if (useNoResponse) {
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
