<script setup lang="ts">
import { computed, ref } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import { PlusIcon, ServerStackIcon, XMarkIcon } from '@heroicons/vue/24/solid'
import { storeToRefs } from 'pinia'

import { useServerAddressStore } from '@/stores/serverAddress'
import { useServerStore } from '@/stores/server'
import ServerRow from '@/components/ServerRow.vue'

const emit = defineEmits<{ join: [] }>()

const serverAddressStore = useServerAddressStore()
const serverStore = useServerStore()
const { servers, serverUrlText } = storeToRefs(serverAddressStore)

// Split the saved servers into the one currently connected (pulled to the top
// under its own heading) and the rest. activeServer is only set when the active
// origin is actually in the saved list, so an unsaved/transient active server
// won't render an empty "active" section.
const activeServer = computed(() =>
  servers.value.find((origin) => origin === serverUrlText.value)
)
const inactiveServers = computed(() =>
  servers.value.filter((origin) => origin !== serverUrlText.value)
)

const isOpen = ref(false)
function open() {
  isOpen.value = true
}
function close() {
  isOpen.value = false
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
  <div>
    <TransitionRoot as="template" :show="isOpen">
      <!-- Dialog teleports its content to a portal at <body>, so the
           data-component marker lives here (inside the portal subtree) rather
           than on the outer wrapper — otherwise the themed [data-component]
           selectors wouldn't match the rendered panel. -->
      <Dialog as="div" data-component="ServerSidebar" class="relative z-70" @close="close">
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
            <DialogPanel class="relative ml-16 flex w-full max-w-sm flex-1">
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
                class="flex grow flex-col gap-y-4 overflow-y-auto bg-white px-6 pt-5 pb-4"
                data-part="panel"
              >
                <h2 data-part="title" class="flex items-center gap-2 text-lg">
                  <ServerStackIcon class="h-5 w-5" aria-hidden="true" />
                  {{ $t('serverUrl.servers') }}
                </h2>

                <section v-if="activeServer" data-part="server-section">
                  <h3 data-part="section-heading">{{ $t('serverUrl.activeSection') }}</h3>
                  <ul role="list" class="flex flex-col gap-2.5">
                    <ServerRow
                      :origin="activeServer"
                      :active="true"
                      @select="select"
                      @remove="remove"
                    />
                  </ul>
                </section>

                <section v-if="inactiveServers.length" data-part="server-section">
                  <h3 data-part="section-heading">{{ $t('serverUrl.otherServers') }}</h3>
                  <ul role="list" class="flex flex-col gap-2.5">
                    <ServerRow
                      v-for="origin in inactiveServers"
                      :key="origin"
                      :origin="origin"
                      :active="false"
                      @select="select"
                      @remove="remove"
                    />
                  </ul>
                </section>

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
