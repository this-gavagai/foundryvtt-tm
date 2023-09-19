<script setup lang="ts">
import { ref } from 'vue'
import { useServer } from './utils/server'
import Character from '@/components/Character.vue'

const { socket, connectToServer } = useServer()
const characterId = ref('')

const url = import.meta.env.PROD
  ? new URL(window.location.origin)
  : new URL('http://192.168.2.176:30000')
const usr = 'Gamemaster'
const pwd = 'goshane'

connectToServer(url, usr, pwd)

function pickChar(actorId: string) {
  console.log(actorId)
  characterId.value = actorId
  socket.value.emit('module.keybard', {
    action: 'requestCharacterDetails',
    characterId: actorId
  })
  console.log(characterId.value)
}
</script>
<template>
  <Suspense>
    <template #default>
      <div>
        <Character :characterId="characterId" v-if="characterId" />
        <div v-else>
          <div class="p-6 text-center w-full">Choose your hero:</div>
          <div class="p-4 text-xl" @click="pickChar('AnmCgwhd5JCwfaZc')">Leaf Leaf Stick</div>
          <div class="p-4 text-xl" @click="pickChar('N7bBdCCXOANneraT')">Vanquility Gemini</div>
          <div class="p-4 text-xl" @click="pickChar('jZX9AzfZISlxQss7')">Friend</div>
        </div>
      </div>
    </template>
    <template #fallback>
      <div>Loading...</div>
    </template>
  </Suspense>
</template>

<style scoped></style>
<!-- Quill: N7bBdCCXOANneraT -->
<!-- LLeaf: AnmCgwhd5JCwfaZc -->
