import { Socket } from 'socket.io-client'
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useSheet: any = defineStore('sheet', () => {
  // const actor = ref({})
  const socket = ref<Socket>()
  return { socket }
})
