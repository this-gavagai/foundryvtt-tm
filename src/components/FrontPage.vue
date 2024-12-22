<script setup lang="ts">
import ArmorClass from '@/components/ArmorClass.vue'
import AttributeScores from '@/components/AttributeScores.vue'
import BackgroundExperience from '@/components/BackgroundExperience.vue'
import EffectsAndConditions from '@/components/EffectsAndConditions.vue'
import SavingThrows from '@/components/SavingThrows.vue'
import CombatInitiative from '@/components/CombatInitiative.vue'
import IWR from '@/components/IWR.vue'
import MovementSpeed from '@/components/MovementSpeed.vue'
import LanguagesKnown from '@/components/LanguagesKnown.vue'
</script>
<template>
  <div>
    <BackgroundExperience />
    <EffectsAndConditions />
    <AttributeScores />
    <SavingThrows />
    <CombatInitiative />
    <ArmorClass />
    <MovementSpeed />
    <IWR />
    <LanguagesKnown />
  </div>
</template>
