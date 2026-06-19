import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { io, Socket } from 'socket.io-client'
import { useUserStore } from '@/stores/user'
import { useWorldStore } from '@/stores/world'
import { useServerAddressStore } from '@/stores/serverAddress'
import { logger } from '@/utils/utilities'
import { TM } from '@/api/protocol'
import { fireAllRefresh } from '@/api/characterSync'
import { browserServerTransport } from '@/api/browserServerTransport'
import { capacitorServerTransport } from '@/api/capacitorServerTransport'
import {
  JOIN_DATA_RETRY_ATTEMPTS,
  JOIN_DATA_TIMEOUT_MS,
  type JoinData,
  type JoinUser,
  type ServerTransport
} from '@/api/serverTransport'

export type { JoinData, JoinUser }

const USERID_STORAGE_KEY = 'userid'
const SOCKET_RECONNECTION_DELAY_MS = 1_000
const SOCKET_RECONNECTION_DELAY_MAX_MS = 15_000
const GET_SOCKET_TIMEOUT_MS = 15_000
const PROBE_CONNECTION_TIMEOUT_MS = 3_000
const SESSION_WATCHDOG_TIMEOUT_MS = 8_000

function emitWithTimeout<T>(s: Socket, event: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs)
    s.emit(event, (data: T) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

async function emitWithRetries<T>(
  s: Socket,
  event: string,
  timeoutMs: number,
  attempts: number
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await emitWithTimeout<T>(s, event, timeoutMs)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${event} failed`)
}

function getServerTransport(isNativeMobile: boolean): ServerTransport {
  return isNativeMobile ? capacitorServerTransport : browserServerTransport
}

async function establishSocket(url: URL, transport: ServerTransport, keepAlive = false) {
  return new Promise<Socket>((resolve, reject) => {
    const socketIoUrl = new URL('./socket.io', url)
    Promise.resolve(transport.readSession())
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

export const useServerStore = defineStore('server', () => {
  const socket = ref<Socket>()
  const needsLogin = ref(false)
  const isConnected = ref(false)
  const sessionReady = ref(false)
  const connectionError = ref('')
  const serverUrl = ref<URL>()
  let connectionId = 0
  let sessionWatchdog: ReturnType<typeof setTimeout> | undefined

  function currentTransport(): ServerTransport {
    return getServerTransport(useServerAddressStore().isNativeMobile)
  }

  function clearSessionWatchdog() {
    if (sessionWatchdog === undefined) return
    clearTimeout(sessionWatchdog)
    sessionWatchdog = undefined
  }

  function disconnectCurrentSocket() {
    clearSessionWatchdog()
    socket.value?.removeAllListeners()
    socket.value?.disconnect()
    socket.value = undefined
    isConnected.value = false
    sessionReady.value = false
  }

  function clearConnectionError() {
    connectionError.value = ''
  }

  // Tear down the socket and abandon any in-flight connection attempt. Bumping
  // connectionId invalidates a pending connectToServer so a late-arriving
  // socket can't yank the user back out of the gate. Used when the user cancels
  // a stuck connection to return to the ServerUrlGate.
  function disconnect() {
    connectionId += 1
    disconnectCurrentSocket()
    needsLogin.value = false
    connectionError.value = ''
  }

  function currentSocket(): Socket | undefined {
    return socket.value?.connected ? socket.value : undefined
  }

  function getSocket(timeoutMs = GET_SOCKET_TIMEOUT_MS): Promise<Socket> {
    const connected = currentSocket()
    if (connected) return Promise.resolve(connected)
    return new Promise((resolve, reject) => {
      const existingSocket = socket.value
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Socket not available'))
      }, timeoutMs)
      const stop = watch(socket, (s) => {
        if (s?.connected) {
          resolveSocket(s)
        }
      })

      function cleanup() {
        clearTimeout(timer)
        stop?.()
        existingSocket?.off('connect', onExistingSocketConnect)
      }
      function resolveSocket(s: Socket) {
        cleanup()
        resolve(s)
      }
      function onExistingSocketConnect() {
        if (existingSocket?.connected) resolveSocket(existingSocket)
      }

      if (existingSocket) existingSocket.once('connect', onExistingSocketConnect)
    })
  }

  async function getJoinData(): Promise<JoinData> {
    const socketJoinData = async () => {
      const s = await getSocket()
      return await emitWithRetries<JoinData>(
        s,
        'getJoinData',
        JOIN_DATA_TIMEOUT_MS,
        JOIN_DATA_RETRY_ATTEMPTS
      )
    }

    if (!serverUrl.value) throw new Error('Server URL not available')
    return currentTransport().getJoinData(serverUrl.value, socketJoinData)
  }

  function handleAuthFailure() {
    needsLogin.value = true
  }

  async function login(userid: string, password: string): Promise<boolean> {
    if (!serverUrl.value) return false
    if (!(await currentTransport().verifyCredentials(serverUrl.value, userid, password)))
      return false
    localStorage.setItem(USERID_STORAGE_KEY, userid)
    try {
      await connectToServer(serverUrl.value)
      needsLogin.value = false
    } catch {
      return false
    }
    return true
  }

  // Round-trip a cheap ack-bearing emit with a short timeout. The socket.io
  // client's `connected` flag can lag behind reality (the underlying TCP/
  // websocket may be dead after a long PWA backgrounding without the client
  // having noticed yet), so an explicit probe is the only reliable check.
  // `getJoinData` already supports an ack callback server-side and has no
  // side effects, so it's a safe heartbeat.
  async function probeConnection(timeoutMs = PROBE_CONNECTION_TIMEOUT_MS): Promise<boolean> {
    const s = socket.value
    if (!s || !s.connected) return false
    return emitWithTimeout(s, 'getJoinData', timeoutMs).then(
      () => true,
      () => false
    )
  }

  // Tear down the current socket and start fresh against the last-known
  // server URL. If the session cookie is no longer valid, the session
  // watchdog/auth handler will surface the login page.
  async function forceReconnect(): Promise<void> {
    if (!serverUrl.value) return
    await connectToServer(serverUrl.value)
  }

  async function connectToServer(url: URL): Promise<Socket> {
    serverUrl.value = url
    connectionError.value = ''
    const thisConnectionId = ++connectionId
    disconnectCurrentSocket()
    sessionReady.value = false

    try {
      const newSocket = await establishSocket(url, currentTransport(), true)
      if (thisConnectionId !== connectionId) {
        newSocket.disconnect()
        throw new Error('Stale socket connection ignored')
      }
      logger.debug('TM-INIT: establishing socket connection')
      socket.value = newSocket
      socket.value.onAny((name, ...args) => {
        if (name === 'userActivity' || (name.match('module.') && !name.match(TM.CHANNEL))) return
        logger.debug('TM-RECV', name, ...args)
      })
      socket.value.onAnyOutgoing((name, ...args) => {
        logger.debug('TM-SEND', name, ...args)
      })
      isConnected.value = true
      socket.value.on('disconnect', () => {
        isConnected.value = false
        sessionReady.value = false
      })
      socket.value.on('connect', () => {
        isConnected.value = true
        sessionReady.value = false
      })

      // Watchdog: if Foundry's session event doesn't arrive shortly after
      // the socket comes up, treat it as an auth failure so the user lands
      // on LoginPage instead of a perpetual spinner. Cleared by the
      // session handler below on the first valid handshake.
      sessionWatchdog = setTimeout(() => {
        if (thisConnectionId !== connectionId) return
        logger.debug('TM-INIT: session event did not arrive — falling back to auth recovery')
        handleAuthFailure()
      }, SESSION_WATCHDOG_TIMEOUT_MS)

      socket.value.on('session', (args: { userId: string }) => {
        if (thisConnectionId !== connectionId) return
        clearSessionWatchdog()
        if (args?.userId) {
          useUserStore().setUserId(args?.userId)
          sessionReady.value = true
          needsLogin.value = false
          // Re-fire downstream refreshes on every session handshake. This
          // covers both initial auth and post-reconnect re-auth — including
          // socket.io's internal soft reconnects, which don't replace
          // socket.value and therefore don't trip App.vue's socket-watch.
          void useWorldStore().refreshWorldNow()
          fireAllRefresh()
        } else {
          sessionReady.value = false
          handleAuthFailure()
        }
      })
      return newSocket
    } catch (e) {
      logger.debug('Error loading socket: ', e)
      if (thisConnectionId === connectionId) {
        socket.value = undefined
        isConnected.value = false
        sessionReady.value = false
        connectionError.value = e instanceof Error ? e.message : 'Could not connect to server'
      }
      throw e
    }
  }

  return {
    socket,
    needsLogin,
    isConnected,
    sessionReady,
    connectionError,
    serverUrl,
    clearConnectionError,
    disconnect,
    connectToServer,
    forceReconnect,
    probeConnection,
    getSocket,
    login,
    getJoinData
  }
})
