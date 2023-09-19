import { ref } from 'vue'
import { connectToFoundry, type FoundrySocket } from '@/utils/foundry-api'
import { Socket } from 'socket.io-client'

const socket = ref<Socket>()

const foundryUrl = ref<URL>(new URL('http://localhost'))
let sessionId = ref<String>('')
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

async function connectToServer(url: URL, username: string, password: string) {
  await fetch(window.location.origin)
  const sid = getCookiesMap(document.cookie)['session']

  console.log(username)
  const postJoin = await fetch(url.href + 'join', {
    method: 'post',
    headers: {
      'content-type': 'application/json',
      cookie: `session=${sid}`
    },
    body: JSON.stringify({
      action: 'join',
      adminKey: '',
      password,
      userid: 'USTjxwcLFhdONHph'
    })
  })
  const postJoinResult = await postJoin.json()
  if (postJoinResult.status !== 'success') throw 'err'

  console.log(sid)
  console.log(url)

  console.log('sid:', sid)
  connectToFoundry(url, sid, true)
    .then((r) => {
      console.log('socket: ', r)
      socket.value = r
      foundryUrl.value = url
      foundryUsername.value = username
      foundryPassword.value = password
    })
    .catch((e) => {
      console.log(e)
    })

  socket.value?.on('module.keybard', (args: any) => {
    if (args.action === 'sendSessionId') {
      console.log('session updated')
      console.log(args.sessionId)
      connectToFoundry(foundryUrl.value, args.sessionId, true).then((s) => {
        socket.value = s
      })
      sessionId = args.sessionId
    }
  })
}

export function useServer(): any {
  return { foundryUrl, sessionId, foundryUsername, foundryPassword, socket, connectToServer }
}
