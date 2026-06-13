import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { io, Socket } from 'socket.io-client'
import { useUserStore } from '@/stores/user'
import { useWorldStore } from '@/stores/world'
import { logger } from '@/utils/utilities'
import { TM } from '@/api/protocol'
import { fireAllRefresh } from '@/api/characterSync'

export interface JoinUser {
  _id: string
  name: string
  role: number
  color: string
}
export interface JoinData {
  users: JoinUser[]
  activeUsers: string[]
  userId: string | null
}

const USERID_STORAGE_KEY = 'userid'
const SOCKET_RECONNECTION_DELAY_MS = 1_000
const SOCKET_RECONNECTION_DELAY_MAX_MS = 15_000
const GET_SOCKET_TIMEOUT_MS = 15_000
const JOIN_DATA_TIMEOUT_MS = 3_000
const JOIN_DATA_RETRY_ATTEMPTS = 3
const VERIFY_CREDENTIALS_TIMEOUT_MS = 10_000
const PROBE_CONNECTION_TIMEOUT_MS = 3_000
const SESSION_WATCHDOG_TIMEOUT_MS = 8_000

function readSessionCookie(): string | undefined {
  return document.cookie
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === 'session')?.[1]
}

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

function establishSocket(url: URL, keepAlive = false) {
  return new Promise<Socket>((resolve, reject) => {
    const socketIoUrl = new URL('./socket.io', url)
    const sid = readSessionCookie()
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
}

export const useServerStore = defineStore('server', () => {
  const socket = ref<Socket>()
  const needsLogin = ref(false)
  const isConnected = ref(false)
  const sessionReady = ref(false)
  let serverUrl: URL | undefined
  let connectionId = 0
  let sessionWatchdog: ReturnType<typeof setTimeout> | undefined

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
    const s = await getSocket()
    return emitWithRetries<JoinData>(
      s,
      'getJoinData',
      JOIN_DATA_TIMEOUT_MS,
      JOIN_DATA_RETRY_ATTEMPTS
    )
  }

  async function verifyCredentials(userid: string, password: string): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), VERIFY_CREDENTIALS_TIMEOUT_MS)
    try {
      const response = await fetch('/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', password, userid }),
        signal: controller.signal
      })
      if (!response.ok) return false
      const data = await response.json()
      return data?.status === 'success'
    } catch {
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  }

  function handleAuthFailure() {
    needsLogin.value = true
  }

  async function login(userid: string, password: string): Promise<boolean> {
    if (!serverUrl) return false
    if (!(await verifyCredentials(userid, password))) return false
    localStorage.setItem(USERID_STORAGE_KEY, userid)
    try {
      await connectToServer(serverUrl)
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
    if (!serverUrl) return
    await connectToServer(serverUrl)
  }

  async function connectToServer(url: URL): Promise<Socket> {
    serverUrl = url
    const thisConnectionId = ++connectionId
    disconnectCurrentSocket()
    sessionReady.value = false

    try {
      const newSocket = await establishSocket(url, true)
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
      }
      throw e
    }
  }

  return {
    socket,
    needsLogin,
    isConnected,
    sessionReady,
    connectToServer,
    forceReconnect,
    probeConnection,
    getSocket,
    login,
    getJoinData
  }
})
