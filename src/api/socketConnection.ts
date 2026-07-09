import { io, Socket } from 'socket.io-client'
import { logger } from '@/utils/utilities'
import { browserServerTransport } from '@/api/browserServerTransport'
import { capacitorServerTransport } from '@/api/capacitorServerTransport'
import type { ServerTransport } from '@/api/serverTransport'

// Pure socket/transport plumbing extracted from the server store: nothing here
// touches Pinia or app state, so these helpers can be reasoned about (and
// tested) in isolation from the connection state machine.

const SOCKET_RECONNECTION_DELAY_MS = 1_000
const SOCKET_RECONNECTION_DELAY_MAX_MS = 15_000

export function emitWithTimeout<T>(s: Socket, event: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      logger.debug('TM-DIAG emit timed out', event, { id: s.id, connected: s.connected })
      reject(new Error(`${event} timed out`))
    }, timeoutMs)
    s.emit(event, (data: T) => {
      clearTimeout(timer)
      logger.debug('TM-DIAG emit acked', event)
      resolve(data)
    })
  })
}

// Re-acquire a live socket on every attempt. A cold start can swap the socket
// out from under an in-flight request (the world-load reconnect, or socket.io's
// own reconnection), so retrying against a single captured reference would just
// hammer a dead socket until the whole budget is spent. Fetching the current
// socket each time lets a retry land on the freshly established one.
export async function emitWithRetries<T>(
  getS: () => Promise<Socket>,
  event: string,
  timeoutMs: number,
  attempts: number
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await emitWithTimeout<T>(await getS(), event, timeoutMs)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${event} failed`)
}

export function getServerTransport(isNativeMobile: boolean): ServerTransport {
  return isNativeMobile ? capacitorServerTransport : browserServerTransport
}

// `onCreated` runs synchronously after the socket object exists but before the
// connection is awaited, so callers can attach their event handlers (session,
// connect, disconnect) with no window in which a fast server could emit into
// the void.
export async function establishSocket(
  url: URL,
  transport: ServerTransport,
  keepAlive = false,
  onCreated?: (socket: Socket) => void
) {
  return new Promise<Socket>((resolve, reject) => {
    const socketIoUrl = new URL('./socket.io', url)
    Promise.resolve(transport.readSession(url))
      .then((sid) => {
        const socket = io(socketIoUrl.origin, {
          upgrade: false,
          path: socketIoUrl.pathname,
          // Mobile networks (cellular ↔ wifi handoffs, NAT-binding expirations,
          // PWA backgrounding) need an effectively unbounded retry budget — a few
          // failed attempts is normal and giving up strands the user with a dead
          // socket. delayMax: 15s caps the backoff so reconnection doesn't drift
          // into minutes on prolonged outages.
          reconnection: keepAlive,
          reconnectionDelay: SOCKET_RECONNECTION_DELAY_MS,
          reconnectionAttempts: Infinity,
          reconnectionDelayMax: SOCKET_RECONNECTION_DELAY_MAX_MS,
          transports: ['websocket'],
          withCredentials: true,
          ...(sid ? { query: { session: sid } } : {})
        })
        onCreated?.(socket)
        const onConnect = () => {
          socket.off('connect_error', onError)
          resolve(socket)
        }
        const onError = (e: Error) => {
          socket.off('connect', onConnect)
          socket.disconnect()
          reject(e)
        }
        socket.once('connect', onConnect)
        socket.once('connect_error', onError)
      })
      .catch(reject)
  })
}
