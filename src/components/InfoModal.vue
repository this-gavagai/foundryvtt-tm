<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  TransitionRoot,
  TransitionChild
} from '@headlessui/vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useInfoModalRolls } from '@/composables/useInfoModalRolls'
import { sendItemToChat, sendCompendiumItemToChat } from '@/api/actionRpc'
import { getPath } from '@/utils/utilities'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useSettingsStore } from '@/stores/settings'
import { useOverlayStack } from '@/composables/useOverlayStack'
import Spinner from './widgets/SpinnerWidget.vue'
import TraitList from './TraitList.vue'
import ManualDicePicker from './ManualDicePicker.vue'
import PendingPixelDice from './PendingPixelDice.vue'
import RollButtons from './RollButtons.vue'
import RollResultModal from './RollResultModal.vue'
import type { Roll } from '@/types/roll-types'

const { _id: characterId } = useInjectedCharacter()

const { isListening } = storeToRefs(useListenersStore())
const { manualDicePicker } = storeToRefs(useSettingsStore())

const rollResultModal = ref<InstanceType<typeof RollResultModal>>()
const waiting = ref(false)
const isOpen = ref(false)
const { zIndex, openLayer, closeLayer } = useOverlayStack()

const props = defineProps<{
  imageUrl?: string
  traits?: string[]
  itemId?: string
  itemUuid?: string
  rolls?: Roll[]
}>()

const { armedRoll, buffer, executeRollFromButton, pickFace, clearBuffer, dieFaces, hasReadyPixel, readyFaceCounts } =
  useInfoModalRolls({
    rolls: computed(() => props.rolls),
    isOpen,
    onRollResolved: (result) => {
      close(true)
      rollResultModal.value?.open(result)
    }
  })

function open() {
  openLayer()
  isOpen.value = true
  waiting.value = false
  clearBuffer()
  emit('opening')
}
function close(ignoreModal = false) {
  if (rollResultModal.value?.isOpen && !ignoreModal) {
    rollResultModal.value.close()
    return
  }
  isOpen.value = false
  closeLayer()
  emit('closing')
}
onBeforeUnmount(closeLayer)

const dragOptions = {
  swipeDistance: 50
}
const handleDrag = ({ swipe }: { swipe: [number, number] }) => {
  if (swipe[1]) close()
}

async function sendCurrentItemToChat() {
  if (!isListening.value) return
  waiting.value = true
  try {
    if (props.itemId && characterId.value) {
      await sendItemToChat(characterId.value, props.itemId)
    } else if (props.itemUuid && characterId.value) {
      await sendCompendiumItemToChat(characterId.value, props.itemUuid)
    }
  } finally {
    waiting.value = false
  }
}

const canSendToChat = computed(
  () => isListening.value && !!characterId.value && (!!props.itemId || !!props.itemUuid)
)

const emit = defineEmits(['opening', 'closing'])
defineExpose({ open, close, rollResultModal, isOpen })
</script>
<template>
  <div class="touch-manipulation transition-all">
    <TransitionRoot appear :show="isOpen" as="template">
      <Dialog as="div" @close="close" class="relative" :style="{ zIndex }">
        <TransitionChild
          as="template"
          enter="duration-300 ease-out"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="duration-100 ease-in"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-[#000D]" />
        </TransitionChild>

        <div class="fixed inset-x-0 bottom-0 overflow-y-auto">
          <div class="bottom items-bottom flex justify-center overflow-hidden p-0 pb-0 text-center">
            <TransitionChild
              as="template"
              enter="duration-300 ease-out"
              enter-from="translate-y-full"
              enter-to="translate-y-0"
              leave="duration-200 ease-in"
              leave-from="translate-y-0"
              leave-to="translate-y-full"
            >
              <DialogPanel
                data-part="panel"
                class="relative w-full max-w-4xl transform overflow-hidden bg-white p-6 text-left shadow-xl transition-all"
              >
                <slot name="banner" :close="() => close(true)" />
                <div
                  class="max-h-[70vh] overflow-auto"
                  v-drag="handleDrag"
                  :dragOptions="dragOptions"
                >
                  <div class="flex space-x-2">
                    <div
                      v-if="canSendToChat"
                      class="border active:opacity-30"
                      @click="sendCurrentItemToChat"
                    >
                      <img
                        class="h-12 w-12"
                        :class="[waiting ? 'opacity-50' : '']"
                        v-if="props.imageUrl"
                        :src="getPath(props.imageUrl)"
                        :alt="$t('infoModal.systemIcon')"
                      />
                      <Spinner
                        class="absolute -mt-9 ml-3 h-6 w-6 transition-opacity"
                        :class="[waiting ? 'opacity-100' : 'opacity-0']"
                      />
                    </div>
                    <img
                      v-else-if="props.imageUrl"
                      class="h-12 w-12 border"
                      :src="getPath(props.imageUrl)"
                      :alt="$t('infoModal.systemIcon')"
                    />
                    <div>
                      <DialogTitle as="h3" class="text-lg leading-6 font-medium text-gray-900">
                        <slot name="title"></slot>
                      </DialogTitle>
                      <div v-if="!$slots.banner" class="absolute top-0 right-0 pt-4 pr-4 sm:block">
                        <button
                          type="button"
                          data-part="close"
                          class="cursor-pointer rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-hidden"
                          @click="close(true)"
                        >
                          <span class="sr-only">{{ $t('common.close') }}</span>
                          <XMarkIcon class="h-6 w-6" aria-hidden="true" />
                        </button>
                      </div>
                      <DialogDescription>
                        <slot name="description"></slot>
                      </DialogDescription>
                    </div>
                  </div>
                  <TraitList
                    v-if="props.traits?.length"
                    :traits="props.traits"
                    class="mt-2 text-sm [&_p]:my-2"
                  />
                  <div>
                    <slot name="beforeBody"></slot>
                  </div>
                  <div class="mt-2 text-sm [&_p]:my-2">
                    <div
                      class="[&_table]:mb-2.5 [&_table]:border [&_table]:border-[gray] [&_table_:is(td,th)]:min-w-20 [&_table_:is(td,th)]:border [&_table_:is(td,th)]:border-[gray] [&_table_:is(td,th)]:p-1.25"
                    >
                      <slot name="body"></slot>
                    </div>
                  </div>
                  <div>
                    <slot></slot>
                  </div>
                </div>
                <ManualDicePicker
                  v-if="manualDicePicker && armedRoll?.dice?.length"
                  :dice="armedRoll.dice"
                  :buffer="buffer"
                  :dieFaces="dieFaces"
                  @pick-face="pickFace"
                />
                <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <!-- Left-aligned slot, paired with `justify-end` on the row
                       via `mr-auto`. Used by modals that need a per-action
                       control inline with the roll button (e.g. secret toggle). -->
                  <div class="mr-auto empty:hidden">
                    <slot name="bottomLeft"></slot>
                  </div>
                  <PendingPixelDice
                    v-if="hasReadyPixel && armedRoll?.dice?.length"
                    :dice="armedRoll.dice"
                    :buffer="buffer"
                    :readyFaceCounts="readyFaceCounts"
                    @clear="clearBuffer"
                  />
                  <RollButtons
                    :rolls="props.rolls"
                    :armedRoll="armedRoll"
                    @execute-roll="executeRollFromButton"
                  />
                  <slot name="actionButtons"></slot>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>
    <Teleport to="#modals">
      <RollResultModal ref="rollResultModal" />
    </Teleport>
  </div>
</template>
