import { ref } from 'vue'
import io, { Socket } from 'socket.io-client'
import { type EventsMap } from './foundry-types'

type FoundrySocket = Socket<EventsMap, EventsMap>

const socket = ref<Socket>()

const foundryUrl = ref<URL>(new URL('http://localhost'))
const sessionId = ref<String>('')
const foundryUsername = ref<String>('')
const foundryPassword = ref<String>('')

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

function connectToFoundry(url: URL, sessionId: string, keepAlive = false) {
  // console.log('connecting...')
  return new Promise<FoundrySocket>((ful, rej) => {
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

    socket.on('connect', async () => {
      ful(socket)
      console.log('socket connected')
      socket.emit('module.tablemate', { action: 'anybodyHome' })
    })
    socket.on('connect_error', (e) => rej(e))
    socket.onAny((name, ...args) => {
      if (name === 'userActivity' || (name.match('module.') && !name.match('module.tablemate')))
        return
      console.log('RECV', name, ...args)
    })
    socket.onAnyOutgoing((name, ...args) => {
      console.log('SEND', name, ...args)
    })
  })
}

async function connectToServer(url: URL) {
  let sid = getCookiesMap(document.cookie)['session']
  if (!sid) throw new Error('No Session ID found')
  sessionId.value = sid
  foundryUrl.value = url

  await connectToFoundry(url, sid, true)
    .then((r) => {
      socket.value = r
    })
    .catch((e) => {
      console.log(e)
    })
}

export function useServer(): any {
  return { foundryUrl, sessionId, foundryUsername, foundryPassword, socket, connectToServer }
}
