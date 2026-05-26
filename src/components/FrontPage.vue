<script setup lang="ts">
import ArmorClass from '@/components/ArmorClass.vue'
import PerceptionDetails from '@/components/PerceptionDetails.vue'
import ShieldDisplay from '@/components/ShieldDisplay.vue'
import AttributeScores from '@/components/AttributeScores.vue'
import AncestryBackgroundClass from '@/components/AncestryBackgroundClass.vue'
import ExperiencePoints from '@/components/ExperiencePoints.vue'
import EffectsAndConditions from '@/components/EffectsAndConditions.vue'
import SavingThrows from '@/components/SavingThrows.vue'
import CombatInitiative from '@/components/CombatInitiative.vue'
import IWR from '@/components/IWR.vue'
import MovementSpeed from '@/components/MovementSpeed.vue'
import LanguagesKnown from '@/components/LanguagesKnown.vue'
</script>
<template>
  <div data-component="FrontPage" class="*:border-divider border-collapse *:border-b *:px-6 *:py-4">
    <div data-section="identity" class="flex justify-between gap-2 align-bottom">
      <AncestryBackgroundClass />
      <ExperiencePoints />
    </div>
    <EffectsAndConditions />
    <AttributeScores data-section="attributes" />
    <div data-section="defenses" class="flex gap-4">
      <ArmorClass />
      <SavingThrows />
      <PerceptionDetails />
    </div>
    <CombatInitiative />
    <ShieldDisplay />
    <MovementSpeed />
    <IWR />
    <LanguagesKnown />
  </div>
</template>
