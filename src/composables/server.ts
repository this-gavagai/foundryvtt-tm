// TODO: does the socket need to be reactive here? It doesn't look like it. How did that happen anyway?
import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'

const socket = ref<Socket>()
const sessionId = ref<String>('')

function getCookiesMap(cookiesString: string) {
  return cookiesString
    .split(';')
    .map(function (cookieString) {
      return cookieString.trim().split('=')
    })
    .reduce(function (acc: any, curr: any) {
      acc[curr[0]] = curr[1]
      return acc
    }, {})
}

function establishSocket(url: URL, sessionId: string, keepAlive = false) {
  return new Promise<Socket>((ful, rej) => {
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
    socket.on('connect', async () => ful(socket))
    socket.on('connect_error', (e) => rej(e))
  })
}

async function connectToServer(url: URL) {
  let sid = getCookiesMap(document.cookie)['session']
  if (!sid) {
    window.location.href = window.location.origin
  }
  sessionId.value = sid
  await establishSocket(url, sid, true)
    .then((r) => {
      socket.value = r
      socket.value.offAny()
      socket.value.onAny((name, ...args) => {
        if (name === 'userActivity' || (name.match('module.') && !name.match('module.tablemate')))
          return
        console.log('TM-RECV', name, ...args)
      })
      socket.value.onAnyOutgoing((name, ...args) => {
        console.log('TM-SEND', name, ...args)
      })
    })
    .catch((e) => {
      console.log('Error loading socket: ', e)
    })
  return socket
}

function getSocket(): Promise<Socket> {
  return new Promise((resolve: any, reject: any) => {
    ;(function waitForSocket() {
      if (socket.value) return resolve(socket.value)
      setTimeout(waitForSocket, 100)
    })()
  })
}

export function useServer(): any {
  return {
    // socket,
    connectToServer,
    getSocket
  }
}
