<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import ConnectedApp from '@/components/ConnectedApp.vue'
import ServerUrlGate from '@/components/ServerUrlGate.vue'
import { useServerStore } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'

const { isNativeMobile, needsServerUrl } = storeToRefs(useServerAddressStore())
const { connectionError } = storeToRefs(useServerStore())
const showServerUrlGate = computed(
  () => needsServerUrl.value || (isNativeMobile.value && Boolean(connectionError.value))
)
</script>

<template>
  <ServerUrlGate v-if="showServerUrlGate" />
  <ConnectedApp v-else />
</template>
