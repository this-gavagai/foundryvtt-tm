<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ArrowRightStartOnRectangleIcon, ServerStackIcon } from '@heroicons/vue/24/solid'
import { availableLocales, setLocale } from '@/plugins/i18n'
import { useTheme, THEMES } from '@/composables/useTheme'
import { useSettingsStore } from '@/stores/settings'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useServerStore } from '@/stores/server'
import ModalBox from './ModalBox.vue'
import Dropdown from '@/components/widgets/DropdownWidget.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import Button from '@/components/widgets/ButtonWidget.vue'

const emit = defineEmits<{ manageServers: [] }>()

const { locale, t } = useI18n()
const { activeTheme, setTheme } = useTheme()
const { showUnreadOnPortrait } = storeToRefs(useSettingsStore())
const { isNativeMobile } = storeToRefs(useServerAddressStore())

// 'moonlit/coolblue' → "Moonlit · Coolblue"; THEMES order puts variants right
// after their parent.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const themeList = [
  { id: '', name: t('common.none') },
  ...THEMES.map(({ id }) => ({ id, name: id.split('/').map(cap).join(' · ') }))
]

const modalRef = ref<InstanceType<typeof ModalBox>>()
function open() {
  modalRef.value?.open()
}
function close() {
  modalRef.value?.close()
}

// Hand off to the SideMenu-owned server drawer; close ourselves first so the
// drawer slides in over a clean view rather than stacking on the modal.
function manageServers() {
  close()
  emit('manageServers')
}

// Drop the saved password and the live session so the login page comes back —
// the way to switch to a different Foundry user, which silent re-authentication
// would otherwise never let you reach.
function signOut() {
  close()
  void useServerStore().signOut()
}

defineExpose({ open, close })
</script>
<template>
  <ModalBox ref="modalRef" :title="$t('settings.title')">
    <div class="mt-4 flex flex-col gap-4">
      <div>
        <div class="text-lg italic">{{ $t('sideMenu.language') }}</div>
        <Dropdown
          :list="availableLocales"
          :selectedId="locale"
          :changed="(newId: string) => setLocale(newId)"
        />
      </div>
      <div>
        <div class="text-lg italic">{{ $t('sideMenu.theme') }}</div>
        <Dropdown
          :list="themeList"
          :selectedId="activeTheme ?? ''"
          :changed="(newId: string) => setTheme(newId || null)"
        />
      </div>
      <hr class="opacity-30" />
      <Toggle :active="showUnreadOnPortrait" @changed="(v: boolean) => (showUnreadOnPortrait = v)">
        <span class="text-lg italic">{{ $t('settings.showUnreadOnPortrait') }}</span>
      </Toggle>
      <template v-if="isNativeMobile">
        <hr class="opacity-30" />
        <Button
          class="w-full"
          color="lightgray"
          :clicked="manageServers"
          :aria-label="$t('serverUrl.servers')"
        >
          <template #default>
            <span class="inline-flex items-center justify-center gap-1">
              <ServerStackIcon class="h-5 w-5" aria-hidden="true" />
              <span class="whitespace-nowrap">{{ $t('serverUrl.servers') }}</span>
            </span>
          </template>
        </Button>
        <Button
          class="w-full"
          color="lightgray"
          :clicked="signOut"
          :aria-label="$t('login.signOut')"
        >
          <template #default>
            <span class="inline-flex items-center justify-center gap-1">
              <ArrowRightStartOnRectangleIcon class="h-5 w-5" aria-hidden="true" />
              <span class="whitespace-nowrap">{{ $t('login.signOut') }}</span>
            </span>
          </template>
        </Button>
        <p data-part="sign-out-hint" class="-mt-2 text-sm opacity-70">
          {{ $t('login.signOutHint') }}
        </p>
      </template>
    </div>
  </ModalBox>
</template>
