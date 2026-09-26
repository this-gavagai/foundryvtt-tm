import { CapacitorHttp } from '@capacitor/core'
import { Fetch } from 'socket.io-client'

// A long-poll that answers after pingInterval (25s by default) must not be cut
// off first, so the read timeout sits well above it.
const POLL_TIMEOUT_MS = 60_000

// Engine.io long-polling carried by the native HTTP stack instead of the
// WebView.
//
// Foundry v14 authenticates a socket from the Cookie header of its handshake and
// from nothing else — not the query, not socket.io's `auth`, not any other
// header (all verified against 14.367). A WebView socket can't set that header
// itself, so it depends on WebKit attaching the session cookie to a cross-site
// request from capacitor://localhost, and iOS 27 does not. Native requests
// carry the native cookie jar, where the transport keeps the session, so the
// handshake runs here. The connection then upgrades to a WebSocket that carries
// no cookie at all, which is fine: the engine.io session it joins was
// authenticated at the handshake, and Foundry never looks again.
export class CapacitorPolling extends Fetch {
  override doPoll() {
    this.request()
      .then((data) => this.onData(data))
      .catch((err: unknown) => this.onError('capacitor poll error', err, undefined))
  }

  override doWrite(data: string, callback: () => void) {
    this.request(data)
      .then(() => callback())
      .catch((err: unknown) => this.onError('capacitor write error', err, undefined))
  }

  private async request(data?: string): Promise<string> {
    const isPost = data !== undefined
    const response = await CapacitorHttp.request({
      url: this.uri(),
      method: isPost ? 'POST' : 'GET',
      responseType: 'text',
      headers: isPost ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {},
      ...(isPost ? { data } : {}),
      connectTimeout: POLL_TIMEOUT_MS,
      readTimeout: POLL_TIMEOUT_MS
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`polling request returned ${response.status}`)
    }
    return typeof response.data === 'string' ? response.data : String(response.data ?? '')
  }
}
