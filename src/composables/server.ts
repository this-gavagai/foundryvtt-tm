import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import { useUserId } from '@/composables/user'
import { logger } from '@/utils/utilities'

const socket = ref<Socket>()
const sessionId = ref<string>('')
const needsLogin = ref(false)
let serverUrl: URL | undefined

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

function getCookiesMap(cookiesString: string) {
  return cookiesString
    .split(';')
    .map((cookieString): string[] => cookieString.trim().split('='))
    .reduce((acc: { [key: string]: string }, curr: string[]) => {
      acc[curr[0]] = curr[1]
      return acc
    }, {})
}

function establishSocket(url: URL, sessionId: string, keepAlive = false) {
  return new Promise<Socket>((resolve, reject) => {
    const socketIoUrl = new URL('./socket.io', url)
    const socket = io(socketIoUrl.origin, {
      upgrade: false,
      path: socketIoUrl.pathname,
      reconnection: keepAlive,
      reconnectionDelay: 1000,
      reconnectionAttempts: 3,
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
      extraHeaders: {
        cookie: `session=${sessionId}`
      },
      query: { session: sessionId }
    })
    socket.on('connect', async () => resolve(socket))
    socket.on('connect_error', (e) => reject(e))
  })
}

async function ensureSession(): Promise<string> {
  let sid = getCookiesMap(document.cookie)['session']
  if (!sid) {
    await fetch(`${window.location.origin}/join`, { credentials: 'include' })
    sid = getCookiesMap(document.cookie)['session']
  }
  return sid
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
  const sid = await ensureSession()
  sessionId.value = sid
  await establishSocket(url, sid, true)
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
        if (args?.userId) useUserId().setUserId(args?.userId)
        else handleAuthFailure(url, allowRelogin)
      })
    })
    .catch((e) => {
      logger.debug('Error loading socket: ', e)
    })

  return socket
}

function getSocket(): Promise<Socket> {
  return new Promise((resolve) => {
    ;(function waitForSocket() {
      if (socket.value) return resolve(socket.value)
      setTimeout(waitForSocket, 100)
    })()
  })
}

export function useServer() {
  return {
    connectToServer,
    getSocket,
    needsLogin,
    login,
    getJoinData
  }
}
