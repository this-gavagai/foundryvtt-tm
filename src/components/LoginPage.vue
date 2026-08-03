<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useServerStore, type JoinUser } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import { logger } from '@/utils/utilities'

const { t } = useI18n()
const serverStore = useServerStore()
const { login, getJoinData, getSocket, requestReconnect, rememberedLoginUser } = serverStore
const { isConnected } = storeToRefs(serverStore)
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
// recoverable, not a dead end — so we keep retrying (with backoff, no cap:
// a Foundry world boot takes longer than any fixed retry budget) until the
// page unmounts, on top of always offering the manual retry button.
const AUTO_RETRY_BASE_DELAY_MS = 3_000
const AUTO_RETRY_MAX_DELAY_MS = 15_000
let autoRetries = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
// True only while a getJoinData call is actually in flight. Distinct from
// loadingUsers (the "Loading…" display), which is also true while we sit
// waiting for the socket to come up before the first attempt. The isConnected
// watch keys off this so it can fire that first load without tripping over the
// connecting-state display.
let loadInFlight = false

function cancelAutoRetry() {
  if (retryTimer === undefined) return
  clearTimeout(retryTimer)
  retryTimer = undefined
}

function scheduleAutoRetry() {
  const delay = Math.min(AUTO_RETRY_BASE_DELAY_MS * 2 ** autoRetries, AUTO_RETRY_MAX_DELAY_MS)
  autoRetries += 1
  retryTimer = setTimeout(loadUsers, delay)
}

async function loadUsers() {
  if (loadInFlight) return
  cancelAutoRetry()
  loadingUsers.value = true
  error.value = ''
  // No live socket yet? Don't call getJoinData — in the browser build it's
  // socket-only, so each attempt would just burn its 3s budget waiting on a
  // socket that doesn't exist (3s × 3 = the ~9s post-reboot "Loading…" stall)
  // and never send an emit. The store already owns bringing the socket up
  // (socket.io's own reconnection + the repair loop), so we stay on "Loading…"
  // and let the isConnected watch fire the real load the instant it connects.
  // The Retry button forces a fresh socket for a wedged connection.
  if (!isConnected.value) {
    logger.debug('TM-DIAG loadUsers: socket not connected — deferring to isConnected watch')
    return
  }
  loadInFlight = true
  try {
    const data = await getJoinData()
    logger.debug('TM-DIAG loadUsers: getJoinData returned', { users: data.users.length })
    users.value = data.users
    activeUsers.value = data.activeUsers
    if (data.users.length === 0) {
      // No users came back. A socket that connected before the world was ready
      // is bound server-side to a stale join context: re-emitting getJoinData on
      // it returns an empty list forever, no matter how long we wait. Only a
      // *fresh* socket re-runs the join handshake against the now-ready world —
      // which is exactly what pressing Retry (or relaunching the app) does. So
      // always ask for a new socket, not just when the current one looks dead;
      // requestReconnect is idempotent and store-serialized, so these retries
      // can't stack teardowns on top of the store's own repair loops. A
      // still-valid session then bounces us straight into the app; otherwise the
      // new socket answers getJoinData (or HTTP shows the real login form) on the
      // next attempt.
      logger.debug('TM-DIAG loadUsers: empty user list', { connected: isConnected.value })
      error.value = t('login.noUsersRetry')
      void requestReconnect()
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
    // getJoinData failed on both the socket and the HTTP fallback. Ask for a
    // fresh socket so the next attempt lands on a live one.
    logger.debug('TM-DIAG loadUsers: getJoinData threw — repairing socket')
    error.value = t('login.couldNotLoadUsers')
    void requestReconnect()
    scheduleAutoRetry()
  } finally {
    loadInFlight = false
    loadingUsers.value = false
  }
}

// Manual retry resets the backoff so the user can keep trying at full speed.
function retryUsers() {
  autoRetries = 0
  void loadUsers()
}

// The retry *button* additionally forces a fresh socket — the in-app
// equivalent of the relaunch users discovered cures a wedged connection.
// (Not part of retryUsers: the isConnected watch below calls that on every
// reconnect, and reconnecting from there would loop.)
function manualRetry() {
  void requestReconnect()
  retryUsers()
}

// Only attempt the load on mount if the socket is already up; otherwise stay on
// "Loading…" and let the isConnected watch below fire it the moment the socket
// connects (no dead-wait burning the emit budget on a missing socket).
onMounted(() => {
  if (isConnected.value) void loadUsers()
})

// When the socket (re)connects while we're sitting here without a user list,
// load immediately — this is both the first-load trigger on a cold start (the
// socket wasn't up at mount) and the recovery trigger when a fresh socket
// replaces a stale/pre-world one. Gate on loadInFlight (not loadingUsers) so
// the connecting-state "Loading…" display doesn't block this first load.
watch(isConnected, (connected) => {
  if (!connected || loadInFlight || users.value.length > 0) return
  retryUsers()
})

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
    // No reload needed: login() reconnected with the fresh session, and the
    // session handshake clears needsLogin (unmounting this page) and fires the
    // world/actor refreshes itself.
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
          @pointerdown="!(loadingUsers || users.length === 0) && triggerLightHapticFeedback()"
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
        @pointerdown="!(submitting || loadingUsers || !userid) && triggerLightHapticFeedback()"
      >
        {{ submitting ? $t('login.signingIn') : $t('login.signIn') }}
      </button>
      <div v-if="error" data-part="error" class="flex items-center justify-between gap-2 text-sm">
        <span>{{ error }}</span>
        <button
          type="button"
          class="underline transition duration-180 ease-out active:scale-[0.90] active:opacity-50 active:duration-60"
          @pointerdown="triggerLightHapticFeedback()"
          @click="manualRetry"
        >
          {{ $t('login.retry') }}
        </button>
      </div>
      <button
        v-if="isNativeMobile"
        type="button"
        data-part="change-server"
        class="text-sm text-gray-500 underline transition duration-180 ease-out active:scale-[0.90] active:opacity-50 active:duration-60"
        @pointerdown="triggerLightHapticFeedback()"
        @click="changeServer"
      >
        {{ $t('login.changeServer') }}
      </button>
    </form>
  </div>
</template>
