<script setup lang="ts">
import StrikeList from '@/components/StrikeList.vue'
import ActionsList from '@/components/ActionsList.vue'
import ExplorationList from '@/components/ExplorationList.vue'
import DowntimeList from '@/components/DowntimeList.vue'
</script>
<template>
  <!-- The tab's own padding lives here rather than on each list, so a card
       boundary costs the same whether the two cards come from one list or
       two — the lists are just where the sections are built. Same arrangement
       FeatsList uses for its own multi-section column flow. -->
  <div data-component="ActionsPanel" class="px-6 pt-4 pb-8 lg:columns-2">
    <StrikeList />
    <ActionsList />
    <!-- The out-of-encounter modes last and in play order: what you do by the
         minute while exploring, then what you do by the day between adventures. -->
    <ExplorationList />
    <DowntimeList />
  </div>
</template>
