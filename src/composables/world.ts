import { ref } from 'vue'
import { useServer } from '@/composables/server'

console.log('loaded')

const world = ref<any>({})
const { socket, connectToServer } = useServer()
connectToServer(window.location.origin).then(() => {
  socket.value.emit('world', (r: any) => {
    console.log('TM-RECV world', r)
    window.world = world.value = r
  })
})

export function useWorld() {
  return { world }
}
