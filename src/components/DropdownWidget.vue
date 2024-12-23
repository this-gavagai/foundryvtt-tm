<script setup lang="ts">
import { ref, computed } from 'vue'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/24/solid'

interface ListChoice {
  id: string | undefined
  name: string | undefined
}

const props = defineProps<{
  list: ListChoice[] | undefined
  selectedId: string | undefined
  disabled?: boolean
  growContainer?: boolean
  changed?: ((newId: string) => Promise<unknown> | void) | undefined
}>()

const selectedOrNone = computed({
  get: () =>
    props.selectedId === 'loading'
      ? { id: '-1', name: 'Loading...' }
      : (props.list?.find((l) => l.id === props.selectedId) ?? { id: '0', name: 'None' }),
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
</script>

<template>
  <Listbox v-model="selected" class="w-full" :disabled="props.disabled">
    <div class="relative mt-1">
      <ListboxButton
        class="relative w-full cursor-default rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-left focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
        :class="[props.disabled || waiting ? 'bg-gray-200 opacity-50' : '']"
      >
        <span class="block truncate">{{ selected?.name }}</span>
        <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <ChevronUpDownIcon class="h-5 w-5 text-gray-400" aria-hidden="true" />
        </span>
      </ListboxButton>

      <Transition
        enter-active-class="transform transition-all duration-200 overflow-hidden"
        enter-from-class="opacity-0 max-h-0"
        enter-to-class="opacity-100 max-h-60"
        leave-active-class="transform transition-all duration-200 ease-in overflow-hidden"
        leave-from-class="opacity-100 max-h-60"
        leave-to-class="opacity-0 max-h-0"
      >
        <ListboxOptions
          class="z-50 ml-1 mt-1 h-auto w-[calc(100%-10px)] overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 transition-all focus:outline-none sm:text-sm"
          :class="[props.growContainer ? 'relative' : 'absolute']"
        >
          <ListboxOption
            v-slot="{ active, selected }"
            v-for="option in list"
            :key="option.id ?? 'none'"
            :value="option"
          >
            <div
              class="relative h-10 cursor-default select-none py-2 pl-10 pr-4 font-bold"
              :class="[
                active ? 'bg-amber-100 text-amber-900' : 'text-gray-900',
                'relative cursor-default select-none py-2 pl-10 pr-4'
              ]"
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
      </Transition>
    </div>
  </Listbox>
</template>
