<script lang="ts">
export default { name: 'EffectsAndConditions' }
</script>
<script setup lang="ts">
// defineOptions({ name: 'EffectsAndConditions' })
import { ref, computed } from 'vue'
import InfoModal from '@/components/InfoModal.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import Button from '@/components/widgets/ButtonWidget.vue'
import ParsedDescription from './ParsedDescription.vue'
import { getPath } from '@/utils/utilities'
import type { EffectItem } from '@/composables/character'

const character = useInjectedCharacter()
const { effects } = character
const infoModal = ref()
const effectViewedId = ref<string | undefined>()
const effectViewed = computed(() => effects.value?.find((e) => e._id === effectViewedId.value))

function viewEffect(effect: EffectItem) {
  effectViewedId.value = effect._id
  infoModal.value.open()
}

function removeViewedEffect() {
  infoModal.value.close()
  if (effectViewed.value?.delete) return effectViewed.value.delete()
}

function adjustViewedEffectQty(delta: number) {
  return effectViewed.value?.changeQty?.((effectViewed.value?.system?.value?.value ?? NaN) + delta)
}
</script>
<template>
  <div :class="{ 'border-none': effects?.length === 0 }">
    <div
      class="relative flex flex-wrap gap-2 overflow-hidden px-6 transition-all duration-300"
      :class="[
        effects?.length && effects?.length > 0
          ? 'border-opacity-100 scale-y-100 py-4'
          : 'border-opacity-0 scale-y-0 py-0'
      ]"
    >
      <TransitionGroup
        enter-active-class="transform duration-300 ease-out"
        enter-from-class=" opacity-0 max-h-0"
        enter-to-class="opacity-100 max-h-[55px]"
        leave-active-class="transform duration-200 ease-in"
        leave-from-class="opacity-100 max-h-[55px]"
        leave-to-class=" opacity-0 max-h-0"
      >
        <div
          class="cursor-pointer"
          v-for="effect in effects"
          :key="effect._id"
          @click="viewEffect(effect)"
        >
          <div class="w-[38px]">
            <div class="relative">
              <div
                v-if="effect.system?.value?.isValued"
                class="absolute right-0 bottom-0 border border-black bg-[#FFFFFFCC] px-1 text-xs"
              >
                {{ effect.system?.value?.value }}
              </div>
              <img :src="getPath(effect.img ?? '')" class="rounded-full" :alt="$t('effects.effectIcon')" />
            </div>
            <div
              class="hidden overflow-hidden text-center text-[0.5rem] whitespace-nowrap"
              data-part="label"
            >
              {{ effect?.name?.replace('Effect: ', '') }}
            </div>
          </div>
        </div>
      </TransitionGroup>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :itemId="effectViewed?._id"
        :imageUrl="effectViewed?.img"
        :traits="[]"
      >
        <template #title>
          {{ effectViewed?.name }}
          {{ effectViewed?.system?.value?.value }}
        </template>
        <template #description>
          <span class="capitalize">{{ effectViewed?.type }}</span>
        </template>
        <template #body>
          <ParsedDescription :text="effectViewed?.system?.description?.value" />
        </template>
        <template #actionButtons>
          <Button color="red" :clicked="removeViewedEffect">{{ $t('common.remove') }}</Button>
          <Button
            v-if="effectViewed?.system?.value?.isValued"
            color="lightgray"
            :clicked="() => adjustViewedEffectQty(-1)"
          >
            -
          </Button>
          <Button
            v-if="effectViewed?.system?.value?.isValued"
            color="lightgray"
            :clicked="() => adjustViewedEffectQty(1)"
          >
            +
          </Button>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
