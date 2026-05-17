<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useServerStore, type JoinUser } from '@/stores/server'

const { login, getJoinData, getSocket } = useServerStore()
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

onMounted(async () => {
  try {
    const data = await getJoinData()
    users.value = data.users
    activeUsers.value = data.activeUsers
    const firstAvailable = data.users.find((u) => !data.activeUsers.includes(u._id))
    if (firstAvailable) userid.value = firstAvailable._id
  } catch {
    error.value = 'Could not load user list. Refresh to retry.'
  } finally {
    loadingUsers.value = false
  }
  const socket = await getSocket()
  socket.on('userActivity', onUserActivity)
})

onUnmounted(async () => {
  const socket = await getSocket()
  socket.off('userActivity', onUserActivity)
})

async function handleLogin() {
  submitting.value = true
  error.value = ''
  const success = await login(userid.value, password.value)
  if (success) {
    window.location.reload()
    return
  }
  submitting.value = false
  error.value = 'Login failed — check your credentials.'
}
</script>
<template>
  <div class="flex h-dvh items-center justify-center bg-white">
    <form
      @submit.prevent="handleLogin"
      class="border-divider flex w-80 flex-col gap-4 rounded border p-6"
    >
      <h1 class="text-xl">Sign in</h1>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-gray-600">User</span>
        <select
          v-model="userid"
          required
          :disabled="loadingUsers || users.length === 0"
          autocomplete="username"
          class="border-divider rounded border bg-white p-2"
        >
          <option v-if="loadingUsers" value="">Loading users…</option>
          <option v-else-if="users.length === 0" value="">No users available</option>
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
        <span class="text-sm text-gray-600">Password</span>
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
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
      <div v-if="error" class="text-sm text-red-600">{{ error }}</div>
    </form>
  </div>
</template>
