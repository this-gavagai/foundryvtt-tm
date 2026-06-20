<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ServerIcon, TrashIcon } from '@heroicons/vue/24/solid'
import { lastLoginUserName } from '@/stores/user'

defineProps<{ origin: string; active: boolean }>()
const emit = defineEmits<{ select: [origin: string]; remove: [origin: string] }>()

const { t } = useI18n()

// Strip the protocol for display — the saved origin keeps it for connecting,
// but the list reads cleaner showing just host:port.
function displayName(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

// The user last signed in to this server, shown as the row's second line. Falls
// back to a muted "not signed in" for servers that were added but never used.
function userLabel(origin: string): string {
  return lastLoginUserName(origin) || t('serverUrl.notSignedIn')
}
</script>

<template>
  <li data-part="server-row" :data-active="active" class="flex items-center gap-2">
    <button
      type="button"
      data-part="server-select"
      class="flex min-w-0 flex-1 items-center gap-3 text-left"
      @click="emit('select', origin)"
    >
      <ServerIcon data-part="server-icon" class="h-5 w-5 flex-none" aria-hidden="true" />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex w-full items-center gap-2">
          <span data-part="server-name" class="min-w-0 flex-1 truncate">{{
            displayName(origin)
          }}</span>
          <span
            v-if="active"
            data-part="server-active-dot"
            class="flex-none"
            role="img"
            :aria-label="$t('serverUrl.active')"
          />
        </span>
        <span data-part="server-user" class="min-w-0 truncate">{{ userLabel(origin) }}</span>
      </span>
    </button>
    <button
      type="button"
      data-part="server-delete"
      class="flex-none self-stretch rounded px-2"
      :aria-label="$t('serverUrl.deleteServer', { server: displayName(origin) })"
      @click="emit('remove', origin)"
    >
      <TrashIcon class="h-5 w-5" aria-hidden="true" />
    </button>
  </li>
</template>
