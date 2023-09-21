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
    })
    socket.on('connect_error', (e) => rej(e))
    socket.onAny((name, ...args) => {
      if (name === 'userActivity') return
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

  // socket.value?.on('module.keybard', (args: any) => {
  //   if (args.action === 'sendSessionId') {
  //     console.log('session updated')
  //     console.log(args.sessionId)
  //     connectToFoundry(foundryUrl.value, args.sessionId, true).then((s) => {
  //       socket.value = s
  //     })
  //     sessionId = args.sessionId
  //   }
  // })

  // const joinData: any = await new Promise((resolve) => {
  //   socket.value?.emit('getJoinData', (response: any) => {
  //     resolve(response)
  //   })
  // })
  // const userid = joinData.users.find((x: any) => x.name === username)?._id

  // const postJoin = await fetch(url.href + 'join', {
  //   method: 'post',
  //   headers: {
  //     'content-type': 'application/json',
  //     cookie: `session=${sid}`
  //   },
  //   body: JSON.stringify({
  //     action: 'join',
  //     adminKey: '',
  //     password,
  //     userid: userid
  //   })
  // })
  // const postJoinResult = await postJoin.json()
  // console.log(postJoinResult)
  // if (postJoinResult.status !== 'success') throw 'err'
  // fetch(url.href + 'game', {
  //   headers: {
  //     cookie: `session=${sid}`
  //   }
  // })
}

export function useServer(): any {
  return { foundryUrl, sessionId, foundryUsername, foundryPassword, socket, connectToServer }
}
