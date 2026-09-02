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
import { rollCheck } from '@/api/actionRpc'
import type { Roll } from '@/types/roll-types'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import { GrantRestrictionError } from '@/utils/itemGrants'
import AddConditionModal from '@/components/AddConditionModal.vue'
import { PlusIcon } from '@heroicons/vue/24/outline'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const character = useInjectedActor()
const { _actor, effects, rollOptionLabels } = character

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
const removalPrevented = ref<string | undefined>()
const addConditionModal = ref<InstanceType<typeof AddConditionModal>>()

// A dying creature's recovery check, offered on the Dying condition itself
// rather than as its own corner of the sheet: this modal already shows the
// dying value and steps it with the +/- buttons every valued condition gets, so
// the one thing missing was the roll.
//
// PF2e derives the DC (10 + dying value, adjusted by Toughness and friends) and
// the outcome notes actor-side, so the request carries nothing but the actor.
// The roll does not change the dying value — the card says what happened and the
// value moves separately, by hand here or by a module watching for the card.
// Same division as PF2e's own sheet; applying it here would double up wherever
// that automation is switched on.
const recoveryRolls = computed<Roll[]>(() => {
  if (effectViewed.value?.system?.slug !== 'dying') return []
  // The dying value comes off the condition being viewed rather than
  // `attributes.dying`, which is PF2e's derived mirror of the same number: the
  // condition is the thing on screen, and it is what the +/- buttons step.
  // `recoveryDC` has no equivalent on the condition, and is 10 before a feat
  // like Toughness moves it.
  const dying = effectViewed.value?.system?.value?.value ?? 1
  const dc = (_actor.value?.system?.attributes?.dying?.recoveryDC ?? 10) + dying
  return [
    {
      key: 'recovery-check',
      label: t('effects.recoveryCheck', { dc }),
      color: 'blue',
      dice: ['d20'],
      armed: true,
      // `d20: [0]` is the pipeline's "roll live" sentinel; a picked or Pixel
      // face replaces the zero.
      execute: (faces) => rollCheck(_actor, 'recovery', undefined, { d20: [faces?.[0] ?? 0] })
    }
  ]
})
// Recovery first: it is the reason the modal was opened, and useInfoModalRolls
// arms the first dice-eligible roll when nothing is explicitly armed.
const modalRolls = computed<Roll[]>(() => [...recoveryRolls.value, ...inlineRolls.value])

function viewEffect(effect: EffectItem) {
  effectViewedId.value = effect._id
  activeRoll.value = undefined
  removalPrevented.value = undefined
  infoModal.value.open()
}

// PF2e marks some grants `restrict` — Unconscious can't be dismissed while
// Dying is what's causing it (see utils/itemGrants). Keep the modal open and
// say which condition is holding this one in place, rather than closing on a
// removal that never happened.
async function removeViewedEffect() {
  removalPrevented.value = undefined
  if (!effectViewed.value?.delete) return infoModal.value.close()
  try {
    await effectViewed.value.delete()
    infoModal.value.close()
  } catch (error) {
    if (!(error instanceof GrantRestrictionError)) throw error
    const { item, preventer } = error.blocked[0]
    removalPrevented.value = t('effects.removalPrevented', { item, preventer })
  }
}

function adjustViewedEffectQty(delta: number) {
  return effectViewed.value?.changeQty?.((effectViewed.value?.system?.value?.value ?? NaN) + delta)
}
</script>
<template>
  <div class="px-0! py-0!">
    <!-- The panel used to collapse to nothing when empty; it now always holds
         either the chips or the line offering to add a condition, so there is
         no zero-height state to animate away and the divider always earns its
         keep. Individual chips still animate in and out. -->
    <div class="relative flex flex-wrap items-center gap-2 px-6 py-4">
      <button
        v-if="!effects?.length"
        type="button"
        class="cursor-pointer text-left text-sm underline decoration-dotted underline-offset-4 opacity-70"
        data-part="empty"
        @pointerdown="triggerLightHapticFeedback()"
        @click="addConditionModal?.open()"
      >
        {{ $t('effects.none') }}
      </button>
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
      <!-- Adding a condition by hand. The empty state says it in words, but once
           chips are present that line is gone, so this is the way in. Kept quiet
           (and last, pushed to the panel's right edge) so it reads as a handle
           rather than another condition. -->
      <button
        type="button"
        data-part="add-condition"
        class="-mr-1 ml-auto cursor-pointer rounded p-1 opacity-50 transition duration-180 ease-out active:scale-[0.90] active:opacity-30 active:duration-60"
        :aria-label="$t('effects.addCondition')"
        :title="$t('effects.addCondition')"
        @pointerdown="triggerLightHapticFeedback()"
        @click="addConditionModal?.open()"
      >
        <PlusIcon class="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
    <Teleport to="#modals">
      <AddConditionModal ref="addConditionModal" />
      <InfoModal
        ref="infoModal"
        :itemId="effectViewed?._id"
        :imageUrl="effectViewed?.img"
        :traits="[]"
        :rolls="modalRolls"
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
        <template #bottomLeft>
          <!-- Why Remove is greyed out. `lockedBy` is set at render time from
               the grant graph; `removalPrevented` is the same answer arriving
               the hard way, when the write was refused after the fact. -->
          <p v-if="effectViewed?.lockedBy" class="text-xs opacity-70" data-part="locked-by">
            {{ $t('effects.lockedBy', { source: effectViewed.lockedBy }) }}
          </p>
          <p
            v-else-if="removalPrevented"
            class="text-xs text-red-500"
            data-part="removal-prevented"
          >
            {{ removalPrevented }}
          </p>
        </template>
        <template #actionButtons>
          <Button color="red" :disabled="!!effectViewed?.lockedBy" :clicked="removeViewedEffect">
            {{ $t('common.remove') }}
          </Button>
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
