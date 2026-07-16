<script setup lang="ts">
import StrikeList from '@/components/StrikeList.vue'
import ActionsList from '@/components/ActionsList.vue'
</script>
<template>
  <div data-component="ActionsPanel" class="px-6 lg:columns-2">
    <StrikeList />
    <ActionsList />
  </div>
</template>
