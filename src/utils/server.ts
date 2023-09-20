import { ref } from 'vue'
import { connectToFoundry, type FoundrySocket } from '@/utils/foundry-api'
import { asyncEmit } from './socket-io-helpers'
import { Socket } from 'socket.io-client'

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

async function connectToServer(url: URL) {
  console.log(url.href)
  let sid = getCookiesMap(document.cookie)['session']
  // if (!sid) {
  //   await fetch(url.href)
  //   sid = getCookiesMap(document.cookie)['session']
  // }
  console.log('sid:', sid)
  sessionId.value = sid
  foundryUrl.value = url

  await connectToFoundry(url, sid, true)
    .then((r) => {
      console.log('socket: ', r)
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
