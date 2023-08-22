import { Socket } from 'socket.io-client'

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useSheet: any = defineStore('sheet', () => {
  const actor = ref({})
  const socket = ref<Socket>()

  const foundryUrl = ref(new URL('http://192.168.2.148:30000/'))
  const foundryUsername = ref('Gamemaster')
  const foundryPassword = ref('goshane')

  // info modal properties
  const infoModal = ref(null)

  return { actor, socket, infoModal, foundryUrl, foundryUsername, foundryPassword }
})
