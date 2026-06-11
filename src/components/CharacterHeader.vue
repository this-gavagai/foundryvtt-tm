<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { Bars3Icon } from '@heroicons/vue/24/solid'
import HitPoints from '@/components/HitPoints.vue'
import HeroPoints from '@/components/HeroPoints.vue'
import CharacterPortrait from '@/components/CharacterPortrait.vue'
import CharacterSelector from '@/components/CharacterSelector.vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits(['sidebarActivated', 'chatActivated'])

const chatStore = useChatStore()
const { showUnreadOnPortrait } = storeToRefs(useSettingsStore())
const showUnreadBadge = computed(() => showUnreadOnPortrait.value && chatStore.unreadCount > 0)
const unreadBadge = computed(() =>
  chatStore.unreadCount > 99 ? '99+' : String(chatStore.unreadCount)
)
</script>

<template>
  <div class="border-divider flex cursor-pointer items-center gap-2 border-t p-4">
    <div class="xs:block relative hidden">
      <CharacterPortrait @click="() => emit('chatActivated')" />
      <span
        v-if="showUnreadBadge"
        data-part="chat-unread-badge"
        class="absolute right-2 bottom-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white shadow"
        :aria-label="$t('chat.unreadMessages', { count: chatStore.unreadCount })"
      >
        {{ unreadBadge }}
      </span>
    </div>
    <div class="min-w-36 flex-1">
      <CharacterSelector />
      <div class="flex justify-start gap-8 align-middle">
        <HitPoints />
        <HeroPoints />
      </div>
    </div>
    <Bars3Icon
      data-part="sidebar-toggle"
      class="border-divider my-auto h-10 w-10 cursor-pointer rounded-md p-1 md:hidden"
      @click="() => emit('sidebarActivated')"
    />
  </div>
</template>
