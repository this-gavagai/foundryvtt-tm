<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useServerStore, type JoinUser } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'

const { t } = useI18n()
const serverStore = useServerStore()
const { login, getJoinData, getSocket, rememberedLoginUser } = serverStore
const serverAddressStore = useServerAddressStore()
const { isNativeMobile, serverUrlText } = storeToRefs(serverAddressStore)

// Host:port of the server being signed in to — the saved origin keeps its
// protocol for connecting, but it reads cleaner here without it.
const serverName = computed(() => serverUrlText.value.replace(/^https?:\/\//, ''))

// Return to the ServerUrlGate to pick a different server. Tearing down the
// socket first (like ConnectedApp's cancel) abandons any in-flight connection
// so a late socket can't yank the user back out of the gate; the server stays
// in the saved list — only the active selection is cleared. Native-only: in
// browser mode the app is served by its one Foundry host, so there's nothing
// to switch to.
function changeServer() {
  serverStore.disconnect()
  serverAddressStore.clearActiveServer()
}
const userid = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref('')
const users = ref<JoinUser[]>([])
const activeUsers = ref<string[]>([])
const loadingUsers = ref(true)

function onUserActivity(userId: string, data: { active?: boolean }) {
  if (data.active === true) {
    if (!activeUsers.value.includes(userId)) activeUsers.value.push(userId)
    if (userid.value === userId) {
      const firstAvailable = users.value.find((u) => !activeUsers.value.includes(u._id))
      userid.value = firstAvailable?._id ?? ''
    }
  } else if (data.active === false) {
    activeUsers.value = activeUsers.value.filter((id) => id !== userId)
    if (!userid.value || activeUsers.value.includes(userid.value)) {
      userid.value = userId
    }
  }
}

// A cold-boot socket can answer getJoinData with an empty-but-successful user
// list (the session/world isn't ready yet) instead of throwing. That's
// recoverable, not a dead end — so we keep retrying for a while until the world
// finishes coming up, on top of always offering the manual retry button.
const MAX_AUTO_RETRIES = 5
const AUTO_RETRY_DELAY_MS = 3_000
let autoRetries = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

function cancelAutoRetry() {
  if (retryTimer === undefined) return
  clearTimeout(retryTimer)
  retryTimer = undefined
}

function scheduleAutoRetry() {
  if (autoRetries >= MAX_AUTO_RETRIES) return
  autoRetries += 1
  retryTimer = setTimeout(loadUsers, AUTO_RETRY_DELAY_MS)
}

async function loadUsers() {
  cancelAutoRetry()
  loadingUsers.value = true
  error.value = ''
  try {
    const data = await getJoinData()
    users.value = data.users
    activeUsers.value = data.activeUsers
    if (data.users.length === 0) {
      error.value = t('login.noUsersRetry')
      scheduleAutoRetry()
      return
    }
    autoRetries = 0
    // Prefer this server's remembered login user (if it still exists and isn't
    // already signed in), otherwise fall back to the first available user.
    const remembered = rememberedLoginUser()
    const rememberedSelectable =
      remembered &&
      data.users.some((u) => u._id === remembered) &&
      !data.activeUsers.includes(remembered)
    const firstAvailable = data.users.find((u) => !data.activeUsers.includes(u._id))
    userid.value = rememberedSelectable ? remembered : (firstAvailable?._id ?? '')
    const socket = await getSocket()
    socket.off('userActivity', onUserActivity)
    socket.on('userActivity', onUserActivity)
  } catch {
    error.value = t('login.couldNotLoadUsers')
    scheduleAutoRetry()
  } finally {
    loadingUsers.value = false
  }
}

// Manual retry resets the auto-retry budget so the user can keep trying.
function retryUsers() {
  autoRetries = 0
  void loadUsers()
}

onMounted(loadUsers)

onUnmounted(async () => {
  cancelAutoRetry()
  try {
    const socket = await getSocket(1_000)
    socket.off('userActivity', onUserActivity)
  } catch {
    // socket never connected — nothing to clean up
  }
})

async function handleLogin() {
  submitting.value = true
  error.value = ''
  const name = users.value.find((u) => u._id === userid.value)?.name
  const success = await login(userid.value, password.value, name)
  if (success) {
    window.location.reload()
    return
  }
  submitting.value = false
  error.value = t('login.error')
}
</script>
<template>
  <div data-component="LoginPage" class="flex h-full items-center justify-center">
    <form
      @submit.prevent="handleLogin"
      class="border-divider flex w-80 flex-col gap-4 rounded border p-6"
    >
      <h1 class="text-xl">{{ $t('login.signIn') }}</h1>
      <p v-if="serverName" data-part="server" class="-mt-2 text-sm text-gray-600">
        {{ $t('login.connectingTo') }} <span class="font-medium">{{ serverName }}</span>
      </p>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-gray-600">{{ $t('login.userLabel') }}</span>
        <select
          v-model="userid"
          required
          :disabled="loadingUsers || users.length === 0"
          autocomplete="username"
          class="border-divider rounded border bg-white p-2"
        >
          <option v-if="loadingUsers" value="">{{ $t('login.loadingUsers') }}</option>
          <option v-else-if="users.length === 0" value="">{{ $t('login.noUsersAvailable') }}</option>
          <option
            v-for="u in users"
            :key="u._id"
            :value="u._id"
            :disabled="activeUsers.includes(u._id)"
          >
            {{ u.name }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-gray-600">{{ $t('login.passwordLabel') }}</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="border-divider rounded border p-2"
        />
      </label>
      <button
        type="submit"
        :disabled="submitting || loadingUsers || !userid"
        class="rounded bg-blue-500 p-2 text-white disabled:opacity-50"
      >
        {{ submitting ? $t('login.signingIn') : $t('login.signIn') }}
      </button>
      <div v-if="error" data-part="error" class="flex items-center justify-between gap-2 text-sm">
        <span>{{ error }}</span>
        <button
          type="button"
          class="underline transition duration-180 ease-out active:scale-[0.90] active:opacity-50 active:duration-60"
          @click="retryUsers"
        >
          {{ $t('login.retry') }}
        </button>
      </div>
      <button
        v-if="isNativeMobile"
        type="button"
        data-part="change-server"
        class="text-sm text-gray-500 underline transition duration-180 ease-out active:scale-[0.90] active:opacity-50 active:duration-60"
        @click="changeServer"
      >
        {{ $t('login.changeServer') }}
      </button>
    </form>
  </div>
</template>
