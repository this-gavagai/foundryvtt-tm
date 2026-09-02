<script setup lang="ts">
import { computed, provide, ref, toRef } from 'vue'
import { useNpc } from '@/composables/npc'
import type { TablemateNpc } from '@/types/character-types'
import { actorKey, npcKey } from '@/composables/injectKeys'
import { formatTraitLabel } from '@/utils/traitLabels'

import ArmorClass from '@/components/ArmorClass.vue'
import AttributeScores from '@/components/AttributeScores.vue'
import CharacterHeader from '@/components/CharacterHeader.vue'
import CombatInitiative from '@/components/CombatInitiative.vue'
import EffectsAndConditions from '@/components/EffectsAndConditions.vue'
import IWR from '@/components/IWR.vue'
import LanguagesKnown from '@/components/LanguagesKnown.vue'
import MovementSpeed from '@/components/MovementSpeed.vue'
import NpcAbilitiesList from '@/components/NpcAbilitiesList.vue'
import NpcSpellList from '@/components/NpcSpellList.vue'
import NpcStrikeList from '@/components/NpcStrikeList.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'
import PerceptionDetails from '@/components/PerceptionDetails.vue'
import SavingThrows from '@/components/SavingThrows.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import SideMenu from '@/components/SideMenu.vue'
import SkillList from '@/components/SkillList.vue'
import StatBox from '@/components/widgets/StatBox.vue'
import TraitList from '@/components/TraitList.vue'

// A GM-facing stat block rather than a play surface: one scrolling page (like
// the familiar sheet) in roughly the order a printed PF2e creature entry reads —
// identity, defenses, movement, skills, attacks, abilities. Everything that
// isn't NPC-specific comes from the shared sheet components via the injected
// actor surface.

const props = defineProps<{
  actor: TablemateNpc | undefined
}>()

const actorRef = toRef(props, 'actor')
const { npc } = useNpc(actorRef)
const sideMenu = ref()

provide(npcKey, npc)
provide(actorKey, npc)

// PF2e stores size as a slug ('med', 'grg') outside the trait dictionaries the
// world localizes, so it's the one label this sheet resolves client-side.
const SIZES = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg']
const sizeKey = computed(() =>
  npc.size.value && SIZES.includes(npc.size.value) ? `npc.sizes.${npc.size.value}` : undefined
)

// Rarity leads the pill row when it isn't the default 'common', matching the
// stat block; size renders on its own so it can use the locale label above.
const traitPills = computed(() => {
  const rarity = npc.rarity.value
  return [...(rarity && rarity !== 'common' ? [rarity] : []), ...(npc.traits.value ?? [])]
})

// Free-text clarifications a stat block prints next to a statistic. Collected
// into one block so the sheet shows nothing at all for the (common) NPC that
// has none of them.
const statNotes = computed(() =>
  [
    { labelKey: 'ac.heading', text: npc.acDetails.value },
    { labelKey: 'hp.heading', text: npc.hpDetails.value },
    { labelKey: 'npc.allSaves', text: npc.allSavesDetails.value },
    { labelKey: 'saves.perception', text: npc.perceptionDetails.value },
    { labelKey: 'movement.heading', text: npc.speedDetails.value }
  ].filter((note) => !!note.text)
)

const senseLabel = (sense: { type?: string; label?: string; range?: number }) =>
  sense.label ?? formatTraitLabel(sense.type ?? '', npc.traitLabels.value ?? {})
</script>
<template>
  <!-- Width matches the character sheet's left sidebar (see sheet-left): a stat
       block is a narrow column, and without a width the sheet is a shrink-to-fit
       flex item whose width drifts with its content. -->
  <div data-component="NpcSheet" class="flex h-full min-h-0 w-full flex-none flex-col md:w-80">
    <CharacterHeader
      class="sticky top-0 z-10 flex-none"
      sidebar-toggle-class=""
      @sidebar-activated="sideMenu.sidebarOpen = true"
      @chat-activated="sideMenu.openChat()"
    >
      <template #secondary-stat>
        <StatBox v-if="npc.level.value !== undefined" :heading="$t('common.level')">
          {{ npc.level.value }}
        </StatBox>
      </template>
    </CharacterHeader>

    <div
      v-if="npc.blurb.value || sizeKey || traitPills.length || npc.adjustment.value"
      data-component="NpcStatusBanner"
      data-section="identity"
      data-status="special"
      role="status"
      class="flex-none px-4 py-2 text-sm"
    >
      <div v-if="npc.blurb.value" data-part="npc-blurb" class="pb-1">{{ npc.blurb.value }}</div>
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span v-if="npc.adjustment.value" data-part="npc-adjustment" class="uppercase">
          {{ $t(`npc.adjustments.${npc.adjustment.value}`) }}
        </span>
        <span v-if="sizeKey" data-part="npc-size">{{ $t(sizeKey) }}</span>
        <TraitList :traits="traitPills" />
      </div>
    </div>

    <main class="app-scroll min-h-0 flex-1">
      <div
        data-component="FrontPage"
        class="*:border-divider border-divider border-collapse border-t *:border-b *:px-6 *:py-4"
      >
        <EffectsAndConditions />

        <AttributeScores data-section="attributes" />

        <section data-section="defenses" class="grid grid-cols-5 place-items-center gap-4">
          <ArmorClass />
          <SavingThrows />
          <PerceptionDetails />
        </section>

        <CombatInitiative />

        <MovementSpeed />

        <div v-if="npc.senses.value?.length" data-section="senses">
          <div data-part="heading" class="text-[0.8rem] font-normal uppercase">
            {{ $t('npc.senses') }}
          </div>
          <ul>
            <li
              v-for="sense in npc.senses.value"
              :key="sense.type ?? ''"
              class="inline text-sm not-last:after:content-['._']"
            >
              {{ senseLabel(sense)
              }}<template v-if="sense.range">
                ({{ sense.range }} {{ $t('strikes.rangeUnit') }})</template
              >
            </li>
          </ul>
        </div>

        <IWR />

        <LanguagesKnown />

        <div v-if="statNotes.length" data-section="notes">
          <div data-part="heading" class="text-[0.8rem] font-normal uppercase">
            {{ $t('npc.statNotes') }}
          </div>
          <div v-for="note in statNotes" :key="note.labelKey" class="text-sm">
            <span data-part="npc-note-label">{{ $t(note.labelKey) }}</span>
            <span data-part="npc-note-value" class="ml-2">{{ note.text }}</span>
          </div>
        </div>
      </div>

      <SkillList :show-proficiencies="false" />

      <NpcStrikeList />

      <NpcSpellList />

      <NpcAbilitiesList />

      <div v-if="npc.publicNotes.value" data-component="NpcNotes">
        <SheetSection section="description" :title="$t('npc.publicNotes')">
          <ParsedDescription :text="npc.publicNotes.value" :labels="npc.rollOptionLabels.value" />
        </SheetSection>
      </div>
    </main>
    <SideMenu ref="sideMenu" />
  </div>
</template>
