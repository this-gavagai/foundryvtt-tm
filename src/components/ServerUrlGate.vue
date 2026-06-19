<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { Bars3Icon } from '@heroicons/vue/24/solid'
import { useServerStore } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'
import ServerSidebar from '@/components/ServerSidebar.vue'

const serverAddressStore = useServerAddressStore()
const serverStore = useServerStore()
const { connectionError } = storeToRefs(serverStore)
const serverUrl = ref(serverAddressStore.serverUrlText)
const error = ref('')

const sidebar = useTemplateRef<InstanceType<typeof ServerSidebar>>('sidebar')
const input = useTemplateRef<HTMLInputElement>('input')

function handleSubmit() {
  error.value = ''
  try {
    serverStore.clearConnectionError()
    serverAddressStore.setServerUrl(serverUrl.value)
  } catch {
    error.value = 'serverUrl.invalid'
  }
}

// "Join a new server" from the sidebar: clear the field and focus it so the
// user can type a fresh address.
function focusForm() {
  serverUrl.value = ''
  serverStore.clearConnectionError()
  input.value?.focus()
}
</script>

<template>
  <div data-component="ServerUrlGate" class="flex h-full flex-col">
    <header data-part="gate-header" class="flex items-center justify-between px-4 py-3">
      <h1 class="text-lg">{{ $t('serverUrl.title') }}</h1>
      <button
        type="button"
        data-part="gate-menu-button"
        class="-m-2 rounded p-2"
        :aria-label="$t('serverUrl.servers')"
        @click="sidebar?.open()"
      >
        <Bars3Icon class="h-6 w-6" aria-hidden="true" />
      </button>
    </header>

    <div class="flex flex-1 items-center justify-center p-6">
      <form
        @submit.prevent="handleSubmit"
        data-part="gate-form"
        class="flex w-full max-w-sm flex-col gap-4 rounded border p-6"
      >
        <label class="flex flex-col gap-1">
          <span data-part="field-label" class="text-sm">{{ $t('serverUrl.label') }}</span>
          <input
            ref="input"
            v-model="serverUrl"
            type="text"
            inputmode="url"
            autocomplete="url"
            placeholder="http://192.168.1.10:30000"
            required
            class="rounded border p-2"
          />
        </label>
        <button type="submit" data-part="connect" class="rounded p-2">
          {{ $t('serverUrl.connect') }}
        </button>
        <p v-if="connectionError" data-part="error" class="text-sm">
          {{ $t('serverUrl.connectionError') }}
        </p>
        <p v-if="error" data-part="error" class="text-sm">{{ $t(error) }}</p>
      </form>
    </div>

    <ServerSidebar ref="sidebar" @join="focusForm" />
  </div>
</template>
