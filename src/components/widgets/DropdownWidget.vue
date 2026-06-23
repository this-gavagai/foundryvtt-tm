<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/24/solid'
import { useTopOverlayZIndex } from '@/composables/useOverlayStack'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
interface ListChoice {
  id: string | undefined
  name: string | undefined
}

const { t } = useI18n()

const props = defineProps<{
  list: ListChoice[] | undefined
  selectedId: string | undefined
  disabled?: boolean
  growContainer?: boolean
  changed?: (newId: string) => unknown
}>()

const selectedOrNone = computed({
  get: () =>
    props.selectedId === 'loading'
      ? { id: '-1', name: t('common.loading') }
      : (props.list?.find((l) => l.id === props.selectedId) ?? { id: '0', name: t('common.none') }),
  set: (newValue) => handleChange(newValue)
})

const waiting = ref(false)
function handleChange(newValue: ListChoice) {
  if (props.changed) {
    waiting.value = true
    const response = props.changed?.(newValue.id ?? '')
    Promise.resolve(response).then(() => (waiting.value = false))
  } else {
    emit('change', newValue.id)
  }
}

const selected = ref(selectedOrNone)

defineExpose({ selected })
const emit = defineEmits(['change'])

// The options popover is teleported to <body> so ancestor `overflow: hidden`
// and `transform` containing blocks (modal panels) don't clip it. Teleport
// drops us out of the normal absolute-positioning context, so we measure the
// button's bounding rect and apply position: fixed coordinates directly.
const buttonWrapper = ref<HTMLElement | null>(null)
const optionsStyle = ref<Record<string, string>>({})

// Render above the modal that contains us (overlays start at z-index 60). When
// no overlay is open we're a page-level dropdown, so fall back to 50.
const topOverlayZIndex = useTopOverlayZIndex()

function measure() {
  const el = buttonWrapper.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  optionsStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: `${topOverlayZIndex.value > 0 ? topOverlayZIndex.value + 1 : 50}`
  }
}

// Capture-mode so scrolls in ancestor containers (modal body, page) trigger
// repositioning — bubble doesn't reach a teleported child.
function onScroll() {
  measure()
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})

// Measure on button click so the popover starts at the right place even
// before any scroll happens.
function onButtonClick() {
  nextTick(measure)
}
</script>

<template>
  <Listbox
    v-model="selected"
    v-slot="{ open }"
    as="div"
    data-part="dropdown"
    class="w-full"
    :disabled="props.disabled"
  >
    <div ref="buttonWrapper" class="relative mt-1" @click="onButtonClick">
      <ListboxButton
        :data-waiting="waiting ? true : undefined"
        class="focus-visible:ring-opacity-75 relative w-full cursor-default rounded-md border border-gray-400 bg-white py-2 pr-10 pl-3 text-left transition duration-75 hover:border-gray-500 hover:bg-gray-50 focus:outline-hidden focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 active:scale-[0.98] active:border-indigo-500 active:bg-indigo-50 sm:text-sm"
        :class="[
          props.disabled || waiting ? 'bg-gray-200 opacity-50' : '',
          open ? 'border-indigo-500 ring-2 ring-indigo-200' : ''
        ]"
        @pointerdown="!props.disabled && !waiting && triggerLightHapticFeedback()"
      >
        <span class="block truncate">{{ selected?.name }}</span>
        <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <ChevronUpDownIcon
            class="h-5 w-5 text-gray-400 transition-transform duration-150"
            :class="open ? 'rotate-180 text-indigo-500' : ''"
            aria-hidden="true"
          />
        </span>
      </ListboxButton>
    </div>

    <!-- `static` keeps ListboxOptions in the DOM whether the listbox is open
         or not, which gives Teleport stable children to render (no
         conditional first-render error). `v-show` drives visibility. -->
    <Teleport to="body">
      <ListboxOptions
        static
        v-show="open"
        :style="optionsStyle"
        data-part="dropdown-options"
        class="max-h-60 overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-hidden sm:text-sm"
      >
        <ListboxOption
          v-slot="{ active, selected }"
          v-for="option in list"
          :key="option.id ?? 'none'"
          :value="option"
        >
          <div
            class="relative h-10 cursor-default py-2 pr-4 pl-10 font-bold select-none"
            :class="[
              active ? 'bg-amber-100 text-amber-900' : 'text-gray-900',
              'relative cursor-default py-2 pr-4 pl-10 select-none'
            ]"
            @pointerdown="!waiting && triggerLightHapticFeedback()"
          >
            <span :class="[selected ? 'font-medium' : 'font-normal', 'block truncate']">
              {{ option.name }}
            </span>
            <span
              v-if="selected"
              class="absolute inset-y-0 left-0 flex items-center pl-3 text-amber-600"
            >
              <CheckIcon class="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </ListboxOption>
      </ListboxOptions>
    </Teleport>
  </Listbox>
</template>
