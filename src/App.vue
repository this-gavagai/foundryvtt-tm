<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useServer } from './utils/server'
import Character from '@/components/Character.vue'

const { socket, connectToServer } = useServer()
const characterId = ref('')
// const usr = ref('')
// const pwd = ref('')
const authenticated = ref<Boolean>(false)

// const url = import.meta.env.PROD
//   ? new URL(window.location.origin)
//   : new URL('http://192.168.2.176:30000')

function pickChar(actorId: string) {
  characterId.value = actorId
  socket.value.emit('module.tablemate', {
    action: 'requestCharacterDetails',
    characterId: actorId
  })
}
onMounted(async () => {
  await nextTick()
  setTimeout(() => window.history.pushState(null, '', '/game'), 100)
})
connectToServer(window.location.origin)
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
        <!-- <div v-else class="p-4">
          <input class="border p-2 m-2" type="text" name="usr" id="usr" v-model="usr" />
          <input class="border p-2 m-2" type="password" name="pwd" id="pwd" v-model="pwd" /><br />
          <button class="border p-2 m-2" @click="attemptLogin()">Sign in</button>
        </div> -->
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
