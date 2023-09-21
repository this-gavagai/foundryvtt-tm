<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useServer } from './utils/server'
import Character from '@/components/Character.vue'

const { socket, connectToServer } = useServer()
const characterId = ref<String | null>()

function pickChar(actorId: String | null) {
  if (!actorId) return
  characterId.value = actorId
  socket.value.emit('module.tablemate', {
    action: 'requestCharacterDetails',
    characterId: actorId
  })
}
connectToServer(window.location.origin).then(() => {
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.get('id')) pickChar(urlParams.get('id'))
})

onMounted(async () => {
  await nextTick()
  setTimeout(() => window.history.pushState(null, '', '/game'), 100)
})
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
