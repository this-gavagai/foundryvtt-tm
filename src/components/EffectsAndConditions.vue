<script lang="ts">
export default { name: 'EffectsAndConditions' }
</script>
<script setup lang="ts">
// defineOptions({ name: 'EffectsAndConditions' })
import { ref, computed } from 'vue'
import InfoModal from '@/components/InfoModal.vue'
import { useInjectedActor } from '@/composables/injectKeys'
import { useAnimationsReady } from '@/composables/useAnimationsReady'
import Button from '@/components/widgets/ButtonWidget.vue'
import ParsedDescription from './ParsedDescription.vue'
import { getPath } from '@/utils/utilities'
import type { EffectItem } from '@/composables/character'
import type { ActiveRoll } from '@/types/api-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

const character = useInjectedActor()
const { effects, rollOptionLabels } = character

// Suppress the panel's enter/scale transitions until the character's initial
// data has painted, so a sheet that loads with effects already present (from
// the IndexedDB cache or the first live fetch) shows them at rest instead of
// animating each one in; effects added deliberately later still animate.
const animationsReady = useAnimationsReady()

const infoModal = ref()
const effectViewedId = ref<string | undefined>()
const effectViewed = computed(() => effects.value?.find((e) => e._id === effectViewedId.value))
const activeRoll = ref<ActiveRoll>()
const inlineRolls = useRollsFromActiveRoll(activeRoll)

function viewEffect(effect: EffectItem) {
  effectViewedId.value = effect._id
  activeRoll.value = undefined
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
  <div class="px-0! py-0!" :class="{ 'border-none': effects?.length === 0 }">
    <div
      class="relative flex flex-wrap gap-2 overflow-hidden px-6"
      :class="[
        animationsReady ? 'transition-all duration-300' : '',
        effects?.length && effects?.length > 0
          ? 'border-opacity-100 scale-y-100 py-4'
          : 'border-opacity-0 scale-y-0 py-0'
      ]"
    >
      <TransitionGroup
        :enter-active-class="animationsReady ? 'transform duration-300 ease-out' : ''"
        :enter-from-class="animationsReady ? ' opacity-0 max-h-0' : ''"
        :enter-to-class="animationsReady ? 'opacity-100 max-h-[55px]' : ''"
        leave-active-class="transform duration-200 ease-in"
        leave-from-class="opacity-100 max-h-[55px]"
        leave-to-class=" opacity-0 max-h-0"
      >
        <div
          class="cursor-pointer"
          v-for="effect in effects"
          :key="effect._id"
          @pointerdown="triggerLightHapticFeedback()"
          @click="viewEffect(effect)"
        >
          <div class="w-[38px]">
            <div class="relative">
              <div
                v-if="effect.system?.value?.isValued"
                class="absolute right-0 bottom-0 px-1 text-xs"
                data-part="effect-level"
              >
                {{ effect.system?.value?.value }}
              </div>
              <img
                :src="getPath(effect.img ?? '')"
                class="rounded-full"
                :alt="$t('effects.effectIcon')"
              />
            </div>
            <div
              class="block overflow-hidden text-center text-[0.5rem] whitespace-nowrap"
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
        :rolls="inlineRolls"
      >
        <template #title>
          {{ effectViewed?.name }}
          {{ effectViewed?.system?.value?.value }}
        </template>
        <template #description>
          <span class="capitalize">{{ effectViewed?.type }}</span>
        </template>
        <template #body>
          <ParsedDescription
            :text="effectViewed?.system?.description?.value"
            :labels="rollOptionLabels"
            @update:activeRoll="activeRoll = $event"
          />
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
