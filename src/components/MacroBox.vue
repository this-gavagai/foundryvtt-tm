<script setup lang="ts">
// import { inject } from 'vue'
// import { useKeys } from '@/composables/injectKeys'

// const { socket } = useServer()

const props = defineProps(['label', 'compendium', 'macro'])
// const actor = inject(useKeys().actorKey)!
function requestMacro(compendium: string, id: string) {
  console.log(compendium, id)
  // if (!actor.value) return
  // socket.value.emit('module.tablemate', {
  //   action: 'runMacro',
  //   characterId: actor.value._id,
  //   compendium: compendium,
  //   macroId: id
  // })
}
</script>

<template>
  <div @click="requestMacro(props.compendium, props.macro)">
    <span class="cursor-pointer border border-blue-800 bg-blue-300 p-1 text-xs"><slot></slot></span>
  </div>
</template>
@/types/pf2e-types
