<script setup lang="ts">
import { storeToRefs } from 'pinia'

import ConnectedApp from '@/components/ConnectedApp.vue'
import ServerUrlGate from '@/components/ServerUrlGate.vue'
import { useServerAddressStore } from '@/stores/serverAddress'

// Native-only: the gate stands in while no server is active. Every route to it
// — cancelling a stuck connection, "join a new server", removing the active
// server — goes through clearActiveServer, which is what makes this the whole
// condition.
const { needsServerUrl } = storeToRefs(useServerAddressStore())
</script>

<template>
  <ServerUrlGate v-if="needsServerUrl" />
  <ConnectedApp v-else />
</template>
