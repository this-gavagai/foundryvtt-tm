<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type { Spell, SpellcastingEntry } from '@/composables/character'
import type { NpcSpell } from '@/composables/npc'
import { useInjectedNpc } from '@/composables/injectKeys'
import { useListenersStore } from '@/stores/listenersOnline'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { useTraitLabels } from '@/composables/useTraitLabels'
import type { SpellVariant } from '@/utils/spellVariants'
import { useSpellVariantMemory } from '@/composables/useSpellVariantMemory'
import {
  buildOrphanSpells,
  buildSpellbook,
  hasAnySpells,
  isInnate,
  isStrictPrepared,
  makeSpellRankResolver,
  slotKey,
  type SpellInfo
} from '@/utils/spellcasting'
import type { Roll } from '@/types/roll-types'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import CounterWidget from '@/components/widgets/CounterWidget.vue'
import InfoModal from '@/components/InfoModal.vue'
import SpellDetails from '@/components/SpellDetails.vue'
import SpellRollModal from '@/components/SpellRollModal.vue'
import SpellSelectionDialog from '@/components/SpellSelectionDialog.vue'
import SpellSourceSection from '@/components/SpellSourceSection.vue'

// NPC spellcasting runs on the same PF2e machinery as a character's, so this
// reuses the whole stack below the orchestrator: SpellSourceSection for the
// rank groups, SpellRollModal for attack/damage, SpellDetails + InfoModal for
// the card, and buildSpellbook for the grouping.
//
// What it deliberately drops is everything a bestiary caster never has: staves,
// wands and scrolls, and signature-spell toggles. Spellbook *editing* is left
// out too — the entry card offers no "known spells" browser — but an empty
// prepared slot still opens the selection dialog, since tracking a prepared NPC
// caster's slots across a fight is the case a GM actually hits.
//
// What it adds is the innate-uses counter: an innate entry has no slots and
// spends per spell instead (PF2e's SpellcastingEntry#consume).

const { t } = useI18n()
const { isListening } = storeToRefs(useListenersStore())
const { labelFor: rarityLabel } = useTraitLabels()

const npc = useInjectedNpc()
const { spellcastingEntries, spells, rollOptionLabels, level: npcLevel } = npc
const { current: focusCurrent, max: focusMax } = npc.focusPoints

const infoModal = ref<InstanceType<typeof InfoModal>>()
const spellRollModal = ref<InstanceType<typeof SpellRollModal>>()
const spellSelectionDialog = ref<InstanceType<typeof SpellSelectionDialog>>()
const description = ref<InstanceType<typeof SpellDetails>>()

type ViewedModal =
  | { kind: 'spell'; spell: NpcSpell; info: SpellInfo }
  | { kind: 'entry'; entry: SpellcastingEntry }

const viewed = ref<ViewedModal>()
const viewedSpell = computed(() =>
  viewed.value?.kind === 'spell' ? viewed.value.spell : undefined
)
const viewedEntry = computed(() =>
  viewed.value?.kind === 'entry' ? viewed.value.entry : undefined
)
const viewedModalItem = computed(() => viewedSpell.value ?? viewedEntry.value)
const viewedSpellInfo = computed(() =>
  viewed.value?.kind === 'spell' ? viewed.value.info : undefined
)
const entryById = (id?: string | null) => spellcastingEntries.value?.find((e) => e._id === id)
const viewedInfoEntry = computed(() => entryById(viewedSpellInfo.value?.entryId))

// Innate entries heighten heavily, and the heightened rank is the one the stat
// block lists and casts at — see makeSpellRankResolver.
const rankOf = computed(() => makeSpellRankResolver(npcLevel.value))
const spellbook = computed(() =>
  buildSpellbook(spellcastingEntries.value, spells.value, rankOf.value)
)

// Spells attached to no entry. PF2e's own sheet can't show these — it renders
// entry collections — but they're real stat-block content (rituals, one-off
// abilities), so they get their own read-only section.
const orphanRanks = computed(() =>
  buildOrphanSpells(spellcastingEntries.value, spells.value, rankOf.value)
)
const hasOrphans = computed(() => hasAnySpells(orphanRanks.value))

// The DC shown beside an entry: the prepared statistic first (an elite/weak
// adjustment moves it), then the entry's own stored value, then the NPC's
// best spell DC.
function dcFor(entry: SpellcastingEntry): number | undefined {
  return entry.preparedDc ?? entry.system.spelldc?.dc ?? npc.spellDC.value ?? undefined
}

function openSpellModal(id: string | undefined, info: SpellInfo) {
  const spell = spells.value?.find((s) => s._id === id)
  if (!spell) return
  viewed.value = { kind: 'spell', spell, info }
  variantChoice.value = undefined
  infoModal.value?.open()
}

function openEntryModal(entry: SpellcastingEntry) {
  viewed.value = { kind: 'entry', entry }
  infoModal.value?.open()
}

// Empty prepared slot tapped: the dialog is always in slot mode here (openSlot
// carries the rank), so it prepares into the slot and never enters the
// spellbook-browsing mode whose removal affordance NPCs don't offer.
function openSpellSelection(info: SpellInfo) {
  spellSelectionDialog.value?.open(info)
}

function pickSpellRoll(
  spell: Spell,
  entry: SpellcastingEntry | undefined,
  castingRank: number | undefined,
  phase: 'attack' | 'damage',
  map: 0 | 1 | 2
) {
  spellRollModal.value?.open(spell, entry, castingRank, phase, map)
}

const inlineRolls = useRollsFromActiveRoll(computed(() => description.value?.activeRoll))

// The entry card offers its own spell-attack roll; a spell card offers whatever
// inline rolls its description carries.
const spellRolls = computed<Roll[]>(() => {
  const entry = viewedEntry.value
  if (entry && entry.doSpellAttack && isListening.value) {
    return [
      {
        key: 'spell-attack',
        label: t('spells.rollSpellAttack'),
        color: 'blue',
        dice: ['d20'],
        armed: true,
        execute: (faces) => entry.doSpellAttack!(faces?.[0])
      }
    ]
  }
  return inlineRolls.value
})

// The rank the viewed spell is being cast at. The rank group the user tapped
// wins: for an innate entry that group IS the heightened rank (the spellbook
// files by it), and for a slot caster it's the slot's rank, which can be higher
// than the spell's own — a rank-3 signature spell cast from a rank-5 slot must
// go off at 5. The spell's `castRank` is only the fallback for a spell opened
// with no group context.
const viewedCastRank = computed(
  () => viewedSpellInfo.value?.castingRank ?? viewedSpell.value?.castRank
)

// Roll-data context for inline @Damage refs in the viewed spell's description.
const viewedSpellRollData = computed<Record<string, unknown>>(() => {
  const rawRank = viewedCastRank.value ?? viewedSpell.value?.system?.level?.value ?? 1
  // Cantrips are stored at rank 0; their effective rank scales with level.
  const rank = rawRank === 0 ? Math.ceil((npcLevel.value ?? 1) / 2) : rawRank
  return { item: { level: rank, rank }, actor: { level: npcLevel.value } }
})

function castViewedSpell() {
  return viewedSpell.value
    ?.doSpell?.(viewedCastRank.value, viewedSpellInfo.value?.castingSlot, chosenOverlayIds())
    ?.then(() => infoModal.value?.close())
}

// Variant selection — see SpellList, which offers the identical choice.
const spellVariantOptions = computed<SpellVariant[]>(
  () => viewedSpell.value?.system?.variants ?? []
)
const { rememberVariant, lastVariant } = useSpellVariantMemory()
const variantChoice = ref<string | undefined>()
// Seeded from whatever this spell was last cast or rolled as, so the common
// case needs no picking — but freely changeable, and never forced to match.
const selectedVariant = computed(
  () =>
    variantChoice.value ??
    lastVariant(viewedSpell.value?._id, spellVariantOptions.value) ??
    spellVariantOptions.value[0]?.overlayId ??
    ''
)
const spellVariantLabels = computed(() =>
  Object.fromEntries(spellVariantOptions.value.map((v) => [v.overlayId, v.label]))
)
const spellVariantGlyphs = computed(() =>
  Object.fromEntries(spellVariantOptions.value.map((v) => [v.overlayId, v.actionGlyph ?? '']))
)

function chosenOverlayIds(): string[] | undefined {
  if (spellVariantOptions.value.length <= 1 || !selectedVariant.value) return undefined
  // Remembered on the cast itself, not when the selector is touched.
  rememberVariant(viewedSpell.value?._id, selectedVariant.value)
  return [selectedVariant.value]
}

// Mirrors PF2e's SpellcastingEntry#consume: a cantrip is always available, an
// innate spell needs a remaining use, a focus spell needs a focus point, and a
// slot caster needs an unspent slot. Casting anyway would just earn a
// "spell slot expended" warning Foundry-side and no chat card.
const castDisabled = computed(() => {
  const spell = viewedSpell.value
  const info = viewedSpellInfo.value
  if (!spell || !info) return false
  const entry = viewedInfoEntry.value
  if (!entry) return false

  const rank = info.castingRank ?? 0
  if (rank === 0) return false

  if (isInnate(entry)) return (spell.uses?.value ?? 0) <= 0
  if (entry.system.prepared?.value === 'focus') return (focusCurrent.value ?? 0) <= 0
  if (isStrictPrepared(entry)) {
    const slot = info.castingSlot
    if (slot == null) return false
    return entry.system.slots?.[slotKey(rank)]?.prepared?.[slot]?.expended === true
  }
  return (entry.system.slots?.[slotKey(rank)]?.value ?? 0) <= 0
})

// The innate spell whose uses counter belongs in the modal header — only innate
// spells are spent per spell, and cantrips are unlimited.
const viewedInnateUses = computed(() => {
  const spell = viewedSpell.value
  if (!spell?.uses || !isInnate(viewedInfoEntry.value)) return undefined
  if (spell.system.traits?.value?.includes('cantrip')) return undefined
  return spell.uses
})

// An unattached spell has no entry to cast from, so PF2e's cast path can't run
// for it — the model leaves doSpell off and the button hides rather than
// offering an action that would throw Foundry-side.
const canCastViewed = computed(() => !!viewedSpell.value?.doSpell)

const hasSpellcasting = computed(
  () => (spellcastingEntries.value?.length ?? 0) > 0 || hasOrphans.value
)
</script>
<template>
  <div v-if="hasSpellcasting" data-component="NpcSpellList">
    <!-- Single column: the sheet is pinned to the sidebar width, so a
         viewport-driven multi-column split here would shear the spell cards in
         half rather than using space the sheet doesn't have. -->
    <div>
      <SpellSourceSection
        v-for="entry in spellcastingEntries"
        :key="entry._id"
        class="pt-4"
        :data-section="
          entry.system.prepared?.value === 'focus'
            ? 'focus'
            : entry.system.tradition?.value || 'arcane'
        "
        :title="entry.name ?? ''"
        :dc="dcFor(entry)"
        :ranks="spellbook[entry._id ?? '']"
        :entry="entry"
        title-clickable
        @open-entry="openEntryModal(entry)"
        @open-spell="openSpellModal"
        @open-slot="openSpellSelection"
        @pick="pickSpellRoll"
      >
        <template #headerCounter>
          <span class="pl-1">
            <CounterWidget
              v-if="entry.system.prepared?.value === 'focus'"
              class="relative -bottom-0.5 mt-px mr-2 h-4 text-sm"
              :value="focusCurrent"
              :max="focusMax"
              :title="$t('spells.focusPool')"
              editable
              @change-count="(newTotal) => (focusCurrent = newTotal)"
            />
          </span>
        </template>
      </SpellSourceSection>
      <!-- Spells attached to no entry. No `entry` prop, so the slot counters,
           empty slots and prepared toggles all fall away — same as the character
           sheet's staff section does. -->
      <SpellSourceSection
        v-if="hasOrphans"
        class="pt-4"
        data-section="unassigned"
        entryless-kind="unattached"
        :title="$t('npc.unassignedSpells')"
        :ranks="orphanRanks"
        @open-spell="openSpellModal"
        @pick="pickSpellRoll"
      />
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :itemId="viewedModalItem?._id"
        :imageUrl="viewedModalItem?.img"
        :traits="viewedEntry ? [] : viewedSpell?.system?.traits?.value"
        :rolls="spellRolls"
      >
        <template #title>
          {{ viewedModalItem?.name }}
          <ActionIcons
            v-if="viewedSpell"
            class="relative -mt-2 pl-1 text-2xl leading-4"
            :actions="viewedSpell?.system?.time?.value"
          />
        </template>
        <template #description>
          <template v-if="viewedEntry">
            <span v-if="viewedEntry.spellAttackModifier != null">
              {{ $t('spells.spellAttack') }}
              {{ viewedEntry.spellAttackModifier >= 0 ? '+' : ''
              }}{{ viewedEntry.spellAttackModifier }}
            </span>
          </template>
          <template v-else>
            {{
              viewedSpell?.system.traits?.value?.includes('cantrip')
                ? $t('spells.cantrips')
                : $t('spells.rank', {
                    n: viewedCastRank ?? viewedSpell?.system.level?.value
                  })
            }}
            <span class="text-sm">{{ rarityLabel(viewedSpell?.system.traits?.rarity) }}</span>
          </template>
        </template>
        <template #headerActions>
          <CounterWidget
            v-if="viewedInnateUses"
            class="mr-2 h-4 text-sm"
            :value="viewedInnateUses.value"
            :max="viewedInnateUses.max"
            :title="`${viewedSpell?.name}: ${$t('npc.innateUses')}`"
            :editable="isListening"
            @change-count="(newTotal) => viewedSpell?.setUses?.(newTotal)"
          />
        </template>
        <template #body>
          <SpellDetails
            ref="description"
            :entry="viewedEntry"
            :item="viewedSpell"
            :spell="viewedSpell"
            :spellInfo="viewedSpellInfo"
            :labels="rollOptionLabels"
            :spellRollData="viewedSpellRollData"
            :consumableSpellRollData="{}"
          />
          <!-- Variant selection — see SpellList for the reasoning. -->
          <ChoiceWidget
            v-if="viewedSpell && isListening"
            class="mt-3 w-full"
            direction="column"
            :choiceSet="spellVariantOptions.map((v) => v.overlayId)"
            :labelSet="spellVariantLabels"
            :glyphSet="spellVariantGlyphs"
            :selected="selectedVariant"
            @changed="(id: string) => (variantChoice = id)"
          />
        </template>
        <template #actionButtons v-if="isListening">
          <Button
            v-if="viewedSpell && canCastViewed"
            :label="$t('spells.cast')"
            color="blue"
            :disabled="castDisabled"
            :clicked="castViewedSpell"
          />
        </template>
      </InfoModal>
      <SpellRollModal ref="spellRollModal" />
      <SpellSelectionDialog
        ref="spellSelectionDialog"
        :spells="spells"
        :entries="spellcastingEntries"
        @open-spell="openSpellModal"
      />
    </Teleport>
  </div>
</template>
