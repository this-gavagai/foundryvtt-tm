<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'

const serverAddressStore = useServerAddressStore()
const serverStore = useServerStore()
const { connectionError } = storeToRefs(serverStore)
const serverUrl = ref(serverAddressStore.serverUrlText)
const error = ref('')

function handleSubmit() {
  error.value = ''
  try {
    serverStore.clearConnectionError()
    serverAddressStore.setServerUrl(serverUrl.value)
  } catch {
    error.value = 'serverUrl.invalid'
  }
}
</script>

<template>
  <div data-component="ServerUrlGate" class="flex h-dvh items-center justify-center p-6">
    <form
      @submit.prevent="handleSubmit"
      class="border-divider flex w-full max-w-sm flex-col gap-4 rounded border bg-white p-6"
    >
      <h1 class="text-xl">{{ $t('serverUrl.title') }}</h1>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-gray-600">{{ $t('serverUrl.label') }}</span>
        <input
          v-model="serverUrl"
          type="text"
          inputmode="url"
          autocomplete="url"
          placeholder="http://192.168.1.10:30000"
          required
          class="border-divider rounded border p-2"
        />
      </label>
      <button type="submit" class="rounded bg-blue-500 p-2 text-white">
        {{ $t('serverUrl.connect') }}
      </button>
      <p v-if="connectionError" class="text-sm text-red-700">
        {{ $t('serverUrl.connectionError') }}
      </p>
      <p v-if="error" class="text-sm text-red-700">{{ $t(error) }}</p>
    </form>
  </div>
</template>
