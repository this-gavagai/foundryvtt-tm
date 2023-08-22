<script setup lang="ts">
import Character from '@/components/Character.vue'
</script>
<template>
  <Suspense>
    <template #default>
      <Character characterId="N7bBdCCXOANneraT" />
    </template>
    <template #fallback>
      <div class="p-6 text-center w-full">Loading....</div>
    </template>
  </Suspense>
</template>

<style scoped></style>
