<script setup lang="ts">
import { inject } from 'vue'
import { useServer } from '@/utils/server'
const { socket } = useServer()

const props = defineProps(['label', 'compendium', 'macro'])
const actor: any = inject('actor')

function requestMacro(compendium: string, id: string) {
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
