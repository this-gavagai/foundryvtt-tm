<script setup lang="ts">
import { inject } from 'vue'
import { useServer } from '@/utils/server'

const { foundryUrl } = useServer()

const infoModal: any = inject('infoModal')

const { actor } = defineProps(['actor'])
function infoPortrait() {
  infoModal.value.open({
    title: 'Quill',
    description: 'Handsome Young Man',
    body: '<p>The Quill is a rare species.</p><p>He have friend.</p>'
  })
}
</script>

<template>
  <div class="flex border p-4 items-center">
    <img
      class="h-24"
      :src="foundryUrl + actor.prototypeToken.texture?.src"
      @click="infoPortrait()"
    />
    <div class="pl-2">
      <h3 class="text-2xl whitespace-nowrap overflow-hidden">{{ actor.name }}</h3>
      <div class="text-md whitespace-nowrap overflow-hidden">
        {{ actor.items?.find((x: any) => x.type === 'ancestry')?.name }}
        {{ actor.items?.find((x: any) => x.type === 'background')?.name }}
      </div>
      <div class="text-md whitespace-nowrap overflow-hidden">
        {{ actor.items?.find((x: any) => x.type === 'class').name }}
        (Level {{ actor.system.details.level.value }})
      </div>
    </div>
  </div>
</template>
