<script setup lang="ts">
import { inject, computed } from 'vue'
import { useKeys } from '@/composables/injectKeys'
// import FeatsListItem from '@/components/FeatsListItem.vue'

const { featId } = defineProps(['featId'])
const { feats } = inject(useKeys().characterKey)!

const feat = computed(() => feats.value?.find((f) => f._id === featId))
function sendOff(this_featId: string) {
  emit('clicked', this_featId)
}

const emit = defineEmits(['clicked'])
</script>
<template>
  <div>
    <div class="relative">
      <a
        class="flex cursor-pointer truncate whitespace-nowrap"
        @click="sendOff(featId)"
        @clicked="(local_featId: string) => sendOff(local_featId)"
      >
        <span v-if="!feat?.grantedBy" class="absolute w-4 pt-1 text-right text-xs text-gray-500">
          {{
            feat?.system?.level?.taken ??
            feat?.system?.location?.value?.split('-')?.[1] ??
            feat?.system?.level?.value
          }}
        </span>
        <span class="truncate pl-6">{{ feat?.name }}</span>
      </a>
    </div>
    <div v-for="grant in feat?.itemGrants" :key="grant">
      <div class="ml-3">
        <FeatsListItem :featId="grant" @clicked="(local_featId: string) => sendOff(local_featId)" />
      </div>
    </div>
  </div>
</template>
