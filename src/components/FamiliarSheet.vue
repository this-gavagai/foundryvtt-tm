<script setup lang="ts">
import { computed, provide, ref, toRef } from 'vue'
import type { Character } from '@/composables/character'
import { useFamiliar } from '@/composables/familiar'
import type { TablemateFamiliar } from '@/types/character-types'
import { characterKey, familiarKey } from '@/composables/injectKeys'
import { useWorldStore } from '@/stores/world'
import { storeToRefs } from 'pinia'

import CharacterHeader from '@/components/CharacterHeader.vue'
import EffectsAndConditions from '@/components/EffectsAndConditions.vue'
import FamiliarActionsList from '@/components/FamiliarActionsList.vue'
import SideMenu from '@/components/SideMenu.vue'
import ArmorClass from '@/components/ArmorClass.vue'
import SavingThrows from '@/components/SavingThrows.vue'
import PerceptionDetails from '@/components/PerceptionDetails.vue'
import MovementSpeed from '@/components/MovementSpeed.vue'
import SkillList from '@/components/SkillList.vue'
import StatBox from '@/components/widgets/StatBox.vue'
import { formatModifier } from '@/utils/formatters'

const props = defineProps<{
  actor: TablemateFamiliar | undefined
}>()

const actorRef = toRef(props, 'actor')
const { familiar } = useFamiliar(actorRef)
const sideMenu = ref()

provide(familiarKey, familiar)
// InfoModal and ParsedDescription are actor-generic in practice, but still
// consume the historical character injection key.
provide(characterKey, familiar as unknown as Character)

const { world } = storeToRefs(useWorldStore())
const masterName = computed(
  () => world.value?.actors?.find((a) => a._id === familiar.masterId.value)?.name
)
</script>
<template>
  <div data-component="FamiliarSheet" class="flex h-full min-h-0 flex-col">
    <CharacterHeader
      class="sticky top-0 z-10 h-32 flex-none"
      sidebar-toggle-class=""
      @sidebar-activated="sideMenu.sidebarOpen = true"
      @chat-activated="sideMenu.openChat()"
    >
      <template #secondary-stat>
        <StatBox
          v-if="familiar.attack.value"
          heading="Attack"
          modal-heading="Familiar Attack"
          :proficiency="familiar.attack.value?.rank"
          :modifiers="familiar.attack.value?.modifiers"
          :rollAction="familiar.attack.value?.roll"
        >
          {{ formatModifier(familiar.attack.value?.totalModifier) }}
        </StatBox>
      </template>
    </CharacterHeader>

    <div
      v-if="
        masterName ||
        familiar.masterId.value ||
        familiar.creature.value ||
        familiar.masterAbility.value
      "
      data-component="FamiliarStatusBanner"
      data-section="master"
      data-status="special"
      role="status"
      class="grid flex-none grid-cols-2 items-center gap-x-4 gap-y-1 px-4 py-2 text-sm"
    >
      <div v-if="familiar.creature.value">
        <span data-part="familiar-detail-label">Creature</span>
        <span data-part="familiar-detail-value" class="ml-2">{{ familiar.creature.value }}</span>
      </div>
      <div v-if="familiar.masterAbility.value">
        <span data-part="familiar-detail-label">Attribute</span>
        <span data-part="familiar-detail-value" class="ml-2 uppercase">{{
          familiar.masterAbility.value
        }}</span>
      </div>
      <div v-if="masterName || familiar.masterId.value" class="col-span-2">
        <span data-part="familiar-detail-label">Master</span>
        <span data-part="familiar-detail-value" class="ml-2">{{
          masterName ?? familiar.masterId.value
        }}</span>
      </div>
    </div>

    <main class="app-scroll min-h-0 flex-1">
      <div
        data-component="FrontPage"
        class="*:border-divider border-divider border-collapse border-t *:border-b *:px-6 *:py-4"
      >
        <EffectsAndConditions />

        <section data-section="defenses" class="grid grid-cols-5 place-items-center gap-4">
          <ArmorClass />
          <SavingThrows />
          <PerceptionDetails />
        </section>

        <MovementSpeed />
      </div>

      <SkillList :show-lore="false" :show-proficiencies="false" />

      <FamiliarActionsList />
    </main>
    <SideMenu ref="sideMenu" />
  </div>
</template>
