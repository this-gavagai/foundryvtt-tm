<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject } from 'vue'
import { useServer } from '@/composables/server'
import { useKeys } from '@/composables/injectKeys'

// const { socket } = useServer()

const props = defineProps(['label', 'compendium', 'macro'])
const actor = inject(useKeys().actorKey)!
function requestMacro(compendium: string, id: string) {
  if (!actor.value) return
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
