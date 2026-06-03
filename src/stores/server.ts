import { ref } from 'vue'
import { defineStore } from 'pinia'
import { io, Socket } from 'socket.io-client'
import { useUserStore } from '@/stores/user'
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

function readSessionCookie(): string | undefined {
  return document.cookie
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === 'session')?.[1]
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
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 15000,
      transports: ['websocket'],
      withCredentials: true,
      ...(sid ? { query: { session: sid } } : {})
    })
    socket.on('connect', async () => resolve(socket))
    socket.on('connect_error', (e) => reject(e))
  })
}

export const useServerStore = defineStore('server', () => {
  const socket = ref<Socket>()
  const needsLogin = ref(false)
  const isConnected = ref(false)
  let serverUrl: URL | undefined

  function getSocket(timeoutMs = 15_000): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket not available')), timeoutMs)
      ;(function waitForSocket() {
        if (socket.value) { clearTimeout(timer); return resolve(socket.value) }
        setTimeout(waitForSocket, 100)
      })()
    })
  }

  async function getJoinData(): Promise<JoinData> {
    const s = await getSocket()
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('getJoinData timed out')), 10000)
      s.emit('getJoinData', (data: JoinData) => {
        clearTimeout(timeoutId)
        resolve(data)
      })
    })
  }

  async function attemptLogin(userid: string, password: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      const response = await fetch(`${window.location.origin}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', password, userid }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      if (!response.ok) return false
      const data = await response.json()
      return data?.status === 'success'
    } catch {
      return false
    }
  }

  async function handleAuthFailure(url: URL, allowRelogin: boolean) {
    if (allowRelogin) {
      const userid = localStorage.getItem('userid')
      const password = localStorage.getItem('password')
      if (userid && password !== null) {
        if (await attemptLogin(userid, password)) {
          socket.value?.disconnect()
          await connectToServer(url, false)
          return
        }
        localStorage.removeItem('userid')
        localStorage.removeItem('password')
      }
    }
    needsLogin.value = true
  }

  async function login(userid: string, password: string): Promise<boolean> {
    if (!(await attemptLogin(userid, password))) return false
    localStorage.setItem('userid', userid)
    localStorage.setItem('password', password)
    needsLogin.value = false
    socket.value?.disconnect()
    if (serverUrl) await connectToServer(serverUrl, false)
    return true
  }

  // Round-trip a cheap ack-bearing emit with a short timeout. The socket.io
  // client's `connected` flag can lag behind reality (the underlying TCP/
  // websocket may be dead after a long PWA backgrounding without the client
  // having noticed yet), so an explicit probe is the only reliable check.
  // `getJoinData` already supports an ack callback server-side and has no
  // side effects, so it's a safe heartbeat.
  async function probeConnection(timeoutMs = 3000): Promise<boolean> {
    const s = socket.value
    if (!s || !s.connected) return false
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      s.emit('getJoinData', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  // Tear down the current socket and start fresh against the last-known
  // server URL. `allowRelogin: true` lets handleAuthFailure retry stored
  // creds — important when reconnecting after Foundry restarted and the
  // session cookie is no longer valid.
  async function forceReconnect(): Promise<void> {
    if (!serverUrl) return
    socket.value?.disconnect()
    await connectToServer(serverUrl, true)
  }

  async function connectToServer(url: URL, allowRelogin = true) {
    serverUrl = url
    await establishSocket(url, true)
      .then((newSocket) => {
        logger.debug('TM-INIT: establishing socket connection')
        socket.value = newSocket
        socket.value.offAny()
        socket.value.onAny((name, ...args) => {
          if (name === 'userActivity' || (name.match('module.') && !name.match(TM.CHANNEL)))
            return
          logger.debug('TM-RECV', name, ...args)
        })
        socket.value.onAnyOutgoing((name, ...args) => {
          logger.debug('TM-SEND', name, ...args)
        })
        isConnected.value = true
        socket.value.on('disconnect', () => { isConnected.value = false })
        socket.value.on('connect', () => { isConnected.value = true })

        // Watchdog: if Foundry's session event doesn't arrive shortly after
        // the socket comes up, treat it as an auth failure so the user lands
        // on LoginPage instead of a perpetual spinner. Cleared by the
        // session handler below on the first valid handshake.
        let sessionSeen = false
        const sessionWatchdog = setTimeout(() => {
          if (!sessionSeen) {
            logger.debug('TM-INIT: session event did not arrive — falling back to auth recovery')
            handleAuthFailure(url, allowRelogin)
          }
        }, 8000)

        socket.value.on('session', async (args: { userId: string }) => {
          sessionSeen = true
          clearTimeout(sessionWatchdog)
          if (args?.userId) {
            useUserStore().setUserId(args?.userId)
            needsLogin.value = false
            // Re-fire downstream refreshes on every session handshake. This
            // covers both initial auth and post-reconnect re-auth — including
            // socket.io's internal soft reconnects, which don't replace
            // socket.value and therefore don't trip App.vue's socket-watch.
            // Dynamic import dodges the circular dep between server and
            // world stores (world imports useServerStore at module load).
            const { useWorldStore } = await import('@/stores/world')
            useWorldStore().refreshWorld()
            fireAllRefresh()
          } else {
            handleAuthFailure(url, allowRelogin)
          }
        })
      })
      .catch((e) => {
        logger.debug('Error loading socket: ', e)
      })

    return socket
  }

  return {
    socket,
    needsLogin,
    isConnected,
    connectToServer,
    forceReconnect,
    probeConnection,
    getSocket,
    login,
    getJoinData
  }
})
