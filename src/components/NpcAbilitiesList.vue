<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Action } from '@/composables/character'
import { useInjectedNpc } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import UsesWidget from '@/components/widgets/UsesWidget.vue'
import DetailInfoModal from '@/components/DetailInfoModal.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'

// The stat block's ability entries, split the way PF2e's own NPC sheet splits
// them: anything with an action cost under "Actions", the rest under
// "Passive". Tapping one opens the shared detail sheet, which offers a Use
// button for the limited-use ones — the same button, on the same `usable`
// test, that PF2e's NPC sheet puts on the row.
const { activeAbilities, passiveAbilities, rollOptionLabels } = useInjectedNpc()

const { isListening } = storeToRefs(useListenersStore())

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

// Spend one of the ability's Frequency uses and post its card, via PF2e's own
// use path. Only reachable for the abilities `usable` covers.
function useViewedAbility() {
  return abilityViewed.value?.doUse?.()
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
        <li
          v-for="ability in group.abilities"
          :key="ability._id ?? ability.name ?? ''"
          class="flex items-baseline justify-between gap-2"
        >
          <ViewableItem scale="firm" class="inline-block" @click="viewAbility(ability)">
            {{ ability.name }}
            <ActionIcons
              v-if="ability.actionType !== 'passive'"
              class="relative -mt-2 pl-1 text-2xl leading-4"
              :actions="glyphFor(ability)"
            />
          </ViewableItem>
          <!-- Stat-block abilities lean on Frequency far harder than a PC's do
               ("Frequency once per day"), and a passive one can be limited too,
               so this hangs off every row rather than the active ones. -->
          <UsesWidget
            class="shrink-0 text-gray-600"
            :value="ability.system?.frequency?.value"
            :max="ability.system?.frequency?.max"
            :per="ability.system?.frequency?.perLabel"
          />
        </li>
      </ul>
    </SheetSection>
    <DetailInfoModal
      ref="detailModal"
      :item="abilityViewed"
      :labels="rollOptionLabels"
      :uses="abilityViewed?.system?.frequency"
      :setUses="abilityViewed?.setUses"
    >
      <template #actionButtons v-if="isListening">
        <Button
          color="blue"
          class="capitalize"
          v-if="abilityViewed?.usable"
          :clicked="useViewedAbility"
        >
          {{ $t('actions.use') }}
        </Button>
      </template>
    </DetailInfoModal>
  </div>
</template>
