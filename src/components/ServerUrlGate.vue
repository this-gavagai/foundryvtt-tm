<script setup lang="ts">
import { computed, nextTick, ref, watch, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

const serverAddressStore = useServerAddressStore()
const serverStore = useServerStore()
const { servers, serverUrlText } = storeToRefs(serverAddressStore)

// Two sections rather than one list with a sentinel entry mixed into it:
// picking a saved server and typing a new address are different tasks, and the
// dropdown had to carry a fake option that could never be a real origin.
type Mode = 'saved' | 'new'

const hasSaved = computed(() => servers.value.length > 0)

// Consumed once, on setup: an explicit "join a new server" opens straight on
// that section. With nothing saved there is no other section to open on.
const startOnNew = serverAddressStore.consumePendingNewServer() || !servers.value.length
const mode = ref<Mode>(startOnNew ? 'new' : 'saved')

// Defaults to the active server, else the first saved one. Never a sentinel —
// when nothing is saved the saved section isn't reachable at all.
const selected = ref(serverUrlText.value || servers.value[0] || '')
const newUrl = ref('')
const error = ref('')
const checking = ref(false)

const input = useTemplateRef<HTMLInputElement>('input')

// Reveal + focus the textbox whenever the new-server section opens. Switching
// sections also drops any error: it described the other section's field, and
// leaving it under this one reads as a complaint about what was just typed.
watch(
  mode,
  (next) => {
    error.value = ''
    if (next !== 'new') return
    newUrl.value = ''
    void nextTick(() => input.value?.focus())
  },
  { immediate: true }
)

// Strip the protocol for display — the saved origin keeps it for connecting,
// but the dropdown reads cleaner showing just host:port.
function displayName(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

async function handleSubmit() {
  error.value = ''
  if (mode.value === 'saved') {
    // Probe reachability before committing so an unreachable saved server
    // reports it right here. This is the user's only feedback point: once the
    // server is committed the gate hands off to ConnectedApp, and connection
    // failures from there retry quietly rather than surfacing anything.
    checking.value = true
    try {
      const reachable = await serverStore.probeServer(new URL(selected.value))
      if (!reachable) {
        error.value = 'serverUrl.unreachable'
        return
      }
      serverAddressStore.selectServer(selected.value)
    } catch {
      error.value = 'serverUrl.invalid'
    } finally {
      checking.value = false
    }
    return
  }
  // Fresh address: resolve the protocol (https first, then http) before
  // committing, so a bare host connects over whichever responds.
  checking.value = true
  try {
    const result = await serverStore.resolveServerUrl(newUrl.value)
    if (result.ok) {
      serverAddressStore.commitServerUrl(result.url)
    } else {
      error.value = result.reason === 'unreachable' ? 'serverUrl.unreachable' : 'serverUrl.invalid'
    }
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div data-component="ServerUrlGate" class="flex h-full flex-col">
    <div class="flex flex-1 items-center justify-center p-6">
      <form
        @submit.prevent="handleSubmit"
        data-part="gate-form"
        class="flex w-full max-w-sm flex-col gap-4 rounded border p-6"
      >
        <h1 class="text-lg">{{ $t('serverUrl.title') }}</h1>

        <!-- Hidden when nothing is saved: there is no second section to reach,
             and a switcher with one dead half is just noise. -->
        <div
          v-if="hasSaved"
          data-part="mode-switch"
          role="tablist"
          class="flex gap-1 rounded border p-1"
        >
          <button
            v-for="tab in (['saved', 'new'] as const)"
            :key="tab"
            type="button"
            role="tab"
            data-part="mode-tab"
            :aria-selected="mode === tab"
            class="flex-1 rounded p-1.5 text-sm"
            :class="mode === tab ? 'bg-gray-200 font-semibold' : 'opacity-60'"
            @click="mode = tab"
            @pointerdown="triggerLightHapticFeedback()"
          >
            {{ tab === 'saved' ? $t('serverUrl.savedServer') : $t('serverUrl.new') }}
          </button>
        </div>

        <label v-if="mode === 'saved'" class="flex flex-col gap-1">
          <span data-part="field-label" class="text-sm">{{ $t('serverUrl.server') }}</span>
          <select
            v-model="selected"
            data-part="server-select"
            class="rounded border p-2 transition duration-180 ease-out active:scale-[0.97] active:opacity-50 active:duration-60"
            @pointerdown="triggerLightHapticFeedback()"
          >
            <option v-for="origin in servers" :key="origin" :value="origin">
              {{ displayName(origin) }}
            </option>
          </select>
        </label>

        <label v-else class="flex flex-col gap-1">
          <span data-part="field-label" class="text-sm">{{ $t('serverUrl.label') }}</span>
          <input
            ref="input"
            v-model="newUrl"
            type="text"
            inputmode="url"
            autocomplete="url"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            placeholder="http://192.168.1.10:30000"
            required
            class="rounded border p-2"
          />
        </label>

        <button
          type="submit"
          data-part="connect"
          class="rounded p-2 transition duration-180 ease-out active:scale-[0.97] active:opacity-50 active:duration-60 disabled:opacity-50"
          :disabled="checking"
          @pointerdown="!checking && triggerLightHapticFeedback()"
        >
          {{ checking ? $t('serverUrl.checking') : $t('serverUrl.connect') }}
        </button>
        <p v-if="error" data-part="error" class="text-sm">{{ $t(error) }}</p>
      </form>
    </div>
  </div>
</template>
