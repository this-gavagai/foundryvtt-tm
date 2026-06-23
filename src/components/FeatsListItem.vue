<script setup lang="ts">
import { computed } from 'vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
// import FeatsListItem from '@/components/FeatsListItem.vue'

const { featId } = defineProps(['featId'])
const { feats } = useInjectedCharacter()

const feat = computed(() => feats.value?.find((f) => f._id === featId))
function sendOff(this_featId: string) {
  emit('clicked', this_featId)
}

const emit = defineEmits(['clicked'])
</script>
<template>
  <div v-if="feat">
    <div data-part="feat-row" class="relative">
      <ViewableItem
        class="flex truncate whitespace-nowrap"
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
        <span class="pl-6">{{ feat?.name }}</span>
      </ViewableItem>
    </div>
    <div
      data-part="sub-feat"
      class="ml-3"
      v-for="grant in feat?.itemGrants"
      :key="grant"
    >
      <FeatsListItem :featId="grant" @clicked="(local_featId: string) => sendOff(local_featId)" />
    </div>
  </div>
</template>
