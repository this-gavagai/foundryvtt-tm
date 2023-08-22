<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSheet } from '@/stores/sheet'

const sheet: any = useSheet()
const { actor, infoModal } = storeToRefs(sheet)

const props = defineProps<{
  title: string
  filter: any
  consumables: [Object: any]
}>()
defineEmits(['consumableClicked'])
</script>
<template>
  <div v-if="props.consumables.filter(props.filter).length" class="mt-4 first:mt-0">
    <h2 class="text-lg underline">{{ props.title }}</h2>
    <ul>
      <li v-for="w in props.consumables.filter(props.filter)" class="text-md">
        <div>
          <span class="cursor-pointer" @click="$emit('consumableClicked', w._id)">
            <span class="text-xs">{{ w.system.quantity }}x </span>
            <span>{{ w.name }}</span>
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>
