import { ref } from 'vue'
import { defineStore } from 'pinia'
import { io, Socket } from 'socket.io-client'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

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
      reconnection: keepAlive,
      reconnectionDelay: 1000,
      reconnectionAttempts: 3,
      reconnectionDelayMax: 5000,
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
  let serverUrl: URL | undefined

  async function ensureSession(): Promise<void> {
    // No-op: GET /join on Foundry v14 resets an authenticated session to
    // unauthenticated (cookie value stays the same, but server-side auth is
    // wiped). POST /join during login establishes the session itself.
  }

  function getSocket(): Promise<Socket> {
    return new Promise((resolve) => {
      ;(function waitForSocket() {
        if (socket.value) return resolve(socket.value)
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

  async function connectToServer(url: URL, allowRelogin = true) {
    serverUrl = url
    await ensureSession()
    await establishSocket(url, true)
      .then((newSocket) => {
        logger.debug('TM-INIT: establishing socket connection')
        socket.value = newSocket
        socket.value.offAny()
        socket.value.onAny((name, ...args) => {
          if (name === 'userActivity' || (name.match('module.') && !name.match('module.tablemate')))
            return
          logger.debug('TM-RECV', name, ...args)
        })
        socket.value.onAnyOutgoing((name, ...args) => {
          logger.debug('TM-SEND', name, ...args)
        })
        socket.value.on('session', (args: { userId: string }) => {
          if (args?.userId) useUserStore().setUserId(args?.userId)
          else handleAuthFailure(url, allowRelogin)
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
    connectToServer,
    getSocket,
    login,
    getJoinData
  }
})
