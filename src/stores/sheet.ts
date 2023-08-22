import { Socket } from 'socket.io-client'
import { authenticateFoundry, connectToFoundry, type FoundrySocket } from '@/utils/foundry-api'

import { ref, reactive, computed } from 'vue'
import { defineStore } from 'pinia'

export const login = {
  url: new URL('http://192.168.2.148:30000/'),
  username: 'Gamemaster',
  password: 'goshane'
}

export const useSheet: any = defineStore('sheet', async () => {
  const foundry = ref(login)
  const foundryUrl = ref(login.url)
  const foundryUsername = ref(login.username)
  const foundryPassword = ref(login.password)

  // console.log(skt)
  // const socket = ref<Socket>(skt)
  // console.log(socket.value)

  const actor = ref({})
  const infoModal = ref({})

  return { actor, infoModal, foundryUrl, foundryUsername, foundryPassword }
})
