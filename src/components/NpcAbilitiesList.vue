<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Action } from '@/composables/character'
import { useInjectedNpc } from '@/composables/injectKeys'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import DetailInfoModal from '@/components/DetailInfoModal.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'

// The stat block's ability entries, split the way PF2e's own NPC sheet splits
// them: anything with an action cost under "Actions", the rest under
// "Passive". Tapping one opens the shared detail sheet — NPC abilities aren't
// "used" from here (they have no roll of their own), so there's no Use button.
const { activeAbilities, passiveAbilities, rollOptionLabels } = useInjectedNpc()

const groups = computed(() => [
  { section: 'action', titleKey: 'npc.activeAbilities', abilities: activeAbilities.value ?? [] },
  { section: 'passive', titleKey: 'npc.passiveAbilities', abilities: passiveAbilities.value ?? [] }
])

const detailModal = ref<InstanceType<typeof DetailInfoModal>>()
const abilityViewedId = ref<string | undefined>()
const abilityViewed = computed(() =>
  [...(activeAbilities.value ?? []), ...(passiveAbilities.value ?? [])].find(
    (a) => a._id === abilityViewedId.value
  )
)

function viewAbility(ability: Action) {
  abilityViewedId.value = ability._id
  detailModal.value?.open()
}

// The action-cost glyph: reactions and free actions have their own symbol,
// everything else renders its numeric cost.
function glyphFor(ability: Action): string {
  if (ability.actionType === 'reaction') return 'r'
  if (ability.actionType === 'free') return 'f'
  return ability.system?.actions?.value?.toString() ?? ''
}
</script>
<template>
  <div data-component="NpcAbilitiesList">
    <SheetSection
      v-for="group in groups"
      :key="group.section"
      :section="group.section"
      :title="$t(group.titleKey)"
      class="[&:not(:has(li))]:hidden"
    >
      <ul>
        <li v-for="ability in group.abilities" :key="ability._id ?? ability.name ?? ''">
          <ViewableItem scale="firm" class="inline-block" @click="viewAbility(ability)">
            {{ ability.name }}
            <ActionIcons
              v-if="ability.actionType !== 'passive'"
              class="relative -mt-2 pl-1 text-2xl leading-4"
              :actions="glyphFor(ability)"
            />
          </ViewableItem>
        </li>
      </ul>
    </SheetSection>
    <DetailInfoModal ref="detailModal" :item="abilityViewed" :labels="rollOptionLabels" />
  </div>
</template>
