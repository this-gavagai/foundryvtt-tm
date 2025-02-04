import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import type { SessionEventArgs } from '@/types/foundry-types'
import { useUserId } from '@/composables/user'

const socket = ref<Socket>()
const sessionId = ref<string>('')

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

async function connectToServer(url: URL) {
  const sid = getCookiesMap(document.cookie)['session']
  if (!sid) {
    window.location.href = window.location.origin
  }
  sessionId.value = sid
  await establishSocket(url, sid, true)
    .then((newSocket) => {
      console.log('TM-INIT: establishing socket connection')
      socket.value = newSocket
      socket.value.offAny()
      socket.value.onAny((name, ...args) => {
        if (name === 'userActivity' || (name.match('module.') && !name.match('module.tablemate')))
          return
        console.log('TM-RECV', name, ...args)
      })
      socket.value.onAnyOutgoing((name, ...args) => {
        console.log('TM-SEND', name, ...args)
      })
      socket.value.on('session', (args: SessionEventArgs) => {
        if (args?.userId) useUserId().setUserId(args?.userId)
        else window.location.href = window.location.origin
      })
    })
    .catch((e) => {
      console.log('Error loading socket: ', e)
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
    getSocket
  }
}
