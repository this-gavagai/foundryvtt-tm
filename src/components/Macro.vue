<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { inject } from 'vue'
import { useServer } from '@/composables/server'
const { socket } = useServer()

const props = defineProps(['label', 'compendium', 'macro'])
const actor: Ref<Actor | undefined> = inject('actor')!
function requestMacro(compendium: string, id: string) {
  if (!actor.value) return
  socket.value.emit('module.tablemate', {
    action: 'runMacro',
    characterId: actor.value._id,
    compendium: compendium,
    macroId: id
  })
}
</script>

<template>
  <div @click="requestMacro(props.compendium, props.macro)">
    <span class="cursor-pointer p-1 bg-blue-300 text-xs border border-blue-800"><slot></slot></span>
  </div>
</template>
