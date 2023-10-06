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
  <div class="cursor-pointer" @click="requestMacro(props.compendium, props.macro)">
    <slot></slot>
  </div>
</template>
