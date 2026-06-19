<script setup lang="ts">
import { ref } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import { CheckCircleIcon, PlusIcon, ServerStackIcon, TrashIcon, XMarkIcon } from '@heroicons/vue/24/solid'
import { storeToRefs } from 'pinia'

import { useServerAddressStore } from '@/stores/serverAddress'
import { useServerStore } from '@/stores/server'

const emit = defineEmits<{ join: [] }>()

const serverAddressStore = useServerAddressStore()
const serverStore = useServerStore()
const { servers, serverUrlText } = storeToRefs(serverAddressStore)

const isOpen = ref(false)
function open() {
  isOpen.value = true
}
function close() {
  isOpen.value = false
}

// Strip the protocol for display — the saved origin keeps it for connecting,
// but the list reads cleaner showing just host:port.
function displayName(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

function select(origin: string) {
  serverStore.clearConnectionError()
  serverAddressStore.selectServer(origin)
  close()
}

function remove(origin: string) {
  serverAddressStore.removeServer(origin)
}

function joinNew() {
  close()
  emit('join')
}

defineExpose({ open })
</script>

<template>
  <div data-component="ServerSidebar">
    <TransitionRoot as="template" :show="isOpen">
      <Dialog as="div" class="relative z-50" @close="close">
        <TransitionChild
          as="template"
          enter="transition-opacity ease-linear duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="transition-opacity ease-linear duration-300"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-gray-900/80" />
        </TransitionChild>

        <div class="fixed inset-0 flex justify-end">
          <TransitionChild
            as="template"
            enter="transition ease-in-out duration-300 transform"
            enter-from="translate-x-full"
            enter-to="translate-x-0"
            leave="transition ease-in-out duration-300 transform"
            leave-from="translate-x-0"
            leave-to="translate-x-full"
          >
            <DialogPanel class="relative ml-16 flex w-full max-w-xs flex-1">
              <TransitionChild
                as="template"
                enter="ease-in-out duration-300"
                enter-from="opacity-0"
                enter-to="opacity-100"
                leave="ease-in-out duration-300"
                leave-from="opacity-100"
                leave-to="opacity-0"
              >
                <div class="absolute top-0 -left-16 flex w-16 justify-center pt-5">
                  <button type="button" class="-m-2.5 p-2.5" @click="close">
                    <span class="sr-only">{{ $t('common.close') }}</span>
                    <XMarkIcon class="h-6 w-6 text-white" aria-hidden="true" />
                  </button>
                </div>
              </TransitionChild>
              <div
                class="flex grow flex-col gap-y-4 overflow-y-auto px-6 pt-5 pb-4"
                data-part="panel"
              >
                <h2 data-part="title" class="flex items-center gap-2 text-lg">
                  <ServerStackIcon class="h-5 w-5" aria-hidden="true" />
                  {{ $t('serverUrl.servers') }}
                </h2>

                <ul role="list" class="flex flex-col gap-2">
                  <li
                    v-for="origin in servers"
                    :key="origin"
                    data-part="server-row"
                    :data-active="origin === serverUrlText"
                  >
                    <button
                      type="button"
                      data-part="server-select"
                      class="flex min-w-0 flex-1 items-center gap-2 text-left"
                      @click="select(origin)"
                    >
                      <CheckCircleIcon
                        v-if="origin === serverUrlText"
                        data-part="server-active-mark"
                        class="h-5 w-5 flex-none"
                        aria-hidden="true"
                      />
                      <span class="min-w-0 flex-1 truncate">{{ displayName(origin) }}</span>
                      <span
                        v-if="origin === serverUrlText"
                        data-part="server-active-label"
                        class="flex-none text-xs"
                      >
                        {{ $t('serverUrl.active') }}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-part="server-delete"
                      class="flex-none rounded p-1"
                      :aria-label="$t('serverUrl.deleteServer', { server: displayName(origin) })"
                      @click="remove(origin)"
                    >
                      <TrashIcon class="h-5 w-5" aria-hidden="true" />
                    </button>
                  </li>
                </ul>

                <p v-if="!servers.length" data-part="empty" class="text-sm">
                  {{ $t('serverUrl.noServers') }}
                </p>

                <button
                  type="button"
                  data-part="join-new"
                  class="mt-auto flex items-center justify-center gap-1.5 rounded p-2.5"
                  @click="joinNew"
                >
                  <PlusIcon class="h-5 w-5" aria-hidden="true" />
                  {{ $t('serverUrl.joinNew') }}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </TransitionRoot>
  </div>
</template>
