<script setup lang="ts">
import type { SpellcastingEntry, Spell, Consumable } from '@/composables/character'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Roll } from '@/types/roll-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import {
  buildSpellbook,
  buildPrepList,
  slotKey,
  isStrictPrepared,
  type SpellInfo
} from '@/utils/spellcasting'
import { useTraitLabels } from '@/composables/useTraitLabels'

import Button from '@/components/widgets/ButtonWidget.vue'
import CounterWidget from '@/components/widgets/CounterWidget.vue'
import InfoModal from '@/components/InfoModal.vue'
import ActionIcons from '@/components/widgets/ActionIcons.vue'
import SpellSourceSection from '@/components/SpellSourceSection.vue'
import SpellDetails from '@/components/SpellDetails.vue'
import SpellRollModal from '@/components/SpellRollModal.vue'
import SpellSelectionDialog from '@/components/SpellSelectionDialog.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import KebabMenu from '@/components/widgets/KebabMenu.vue'

const { t } = useI18n()
const character = useInjectedCharacter()
const {
  spellcastingEntries,
  spells,
  spellConsumables,
  spellDC,
  staff,
  inventory,
  rollOptionLabels,
  level: characterLevel
} = character
const { max: focusMax, current: focusCurrent } = character.focusPoints
const { labelFor: rarityLabel } = useTraitLabels()

const entryById = (id?: string | null) => spellcastingEntries.value?.find((e) => e._id === id)

const { isListening } = storeToRefs(useListenersStore())

const infoModal = ref<InstanceType<typeof InfoModal>>()
const spellRollModal = ref<InstanceType<typeof SpellRollModal>>()
const spellSelectionDialog = ref<InstanceType<typeof SpellSelectionDialog>>()
const description = ref<InstanceType<typeof SpellDetails>>()

type ViewedModal =
  | { kind: 'spell'; spell: Spell; info: SpellInfo }
  | { kind: 'consumable'; consumable: Consumable; info: SpellInfo }
  | { kind: 'entry'; entry: SpellcastingEntry }

const viewed = ref<ViewedModal>()
const viewedSpell = computed(() =>
  viewed.value?.kind === 'spell' ? viewed.value.spell : undefined
)
const viewedConsumable = computed(() =>
  viewed.value?.kind === 'consumable' ? viewed.value.consumable : undefined
)
const viewedEntry = computed(() =>
  viewed.value?.kind === 'entry' ? viewed.value.entry : undefined
)
const viewedItem = computed(() => viewedSpell.value ?? viewedConsumable.value)
const viewedModalItem = computed(() => viewedItem.value ?? viewedEntry.value)
const viewedSpellInfo = computed(() =>
  viewed.value?.kind === 'spell' || viewed.value?.kind === 'consumable'
    ? viewed.value.info
    : undefined
)
const viewedInfoEntry = computed(() => entryById(viewedSpellInfo.value?.entryId))

// Attack/damage roll modal lives in SpellRollModal; opened imperatively when a
// spell's attack or damage chip is picked (SpellSourceSection @pick).
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

// When the spellcasting-entry modal is open and the entry has a spell attack,
// the entry contributes a Roll. Otherwise the modal shows inline rolls only.
const spellRolls = computed<Roll[]>(() => {
  const entry = viewedEntry.value
  if (entry && !viewedItem.value && entry.doSpellAttack && isListening.value) {
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

function openSpellModal(id: string | undefined, info: SpellInfo) {
  if (info.isConsumable) {
    const consumable = spellConsumables.value?.find((i) => i._id === id)
    if (!consumable) return
    viewed.value = { kind: 'consumable', consumable, info }
  } else {
    const spell = spells.value?.find((i) => i._id === id)
    if (!spell) return
    viewed.value = { kind: 'spell', spell, info }
  }
  infoModal.value?.open()
}

function openEntryModal(entry: SpellcastingEntry) {
  viewed.value = { kind: 'entry', entry }
  infoModal.value?.open()
}

function clearPreparedSpell() {
  return viewedInfoEntry.value
    ?.setPrepared?.(viewedSpellInfo.value?.castingRank, viewedSpellInfo.value?.castingSlot, null)
    ?.then(() => infoModal.value?.close())
}

// Roll-data context for the currently viewed spell, used by ParsedDescription
// to resolve inline @item.level / @actor.level refs in @Damage formulas
// client-side before the click handler ships them to Foundry.
const viewedSpellRollData = computed<Record<string, unknown>>(() => {
  const rawRank = viewedSpellInfo.value?.castingRank ?? viewedSpell.value?.system?.level?.value ?? 1
  // Cantrips are stored at rank 0; their effective rank scales with character level.
  const rank = rawRank === 0 ? Math.ceil((characterLevel.value ?? 1) / 2) : rawRank
  return { item: { level: rank, rank }, actor: { level: characterLevel.value } }
})
const viewedConsumableSpellRollData = computed<Record<string, unknown>>(() => {
  const rank = viewedConsumable.value?.system?.spell?.system?.level?.value ?? 1
  return { item: { level: rank, rank }, actor: { level: characterLevel.value } }
})

function castViewedSpell() {
  return viewedSpell.value
    ?.doSpell?.(viewedSpellInfo.value?.castingRank, viewedSpellInfo.value?.castingSlot)
    ?.then(() => infoModal.value?.close())
}

function consumeViewedSpellItem() {
  return viewedConsumable.value?.consumeItem?.()?.then(() => infoModal.value?.close())
}

const castDisabled = computed(() => {
  const info = viewedSpellInfo.value
  if (!info) return false

  if (info.fromStaff) {
    if ((info.castingRank ?? 0) === 0) return false
    return !!staff.value?.expended || (staff.value?.charges?.value ?? 0) <= 0
  }

  const entry = viewedInfoEntry.value
  if (!entry) return false

  const prepType = entry.system.prepared?.value
  const rank = info.castingRank ?? 0

  if (rank === 0) return false
  if (prepType === 'innate') return false

  if (prepType === 'focus') {
    return (focusCurrent.value ?? 0) <= 0
  }

  if (isStrictPrepared(entry)) {
    const slot = info.castingSlot
    if (slot == null) return false
    return entry.system.slots?.[slotKey(rank)]?.prepared?.[slot]?.expended === true
  }

  return (entry.system.slots?.[slotKey(rank)]?.value ?? 0) <= 0
})

const sortedConsumables = computed(() =>
  [...(spellConsumables.value ?? [])].sort(
    (a, b) =>
      (a.system.spell?.system?.level?.value ?? 0) - (b.system.spell?.system?.level?.value ?? 0)
  )
)

const staffItem = computed(() => inventory.value?.find((i) => i._id === staff.value?.staffId))

const staffSpellsByRank = computed(() =>
  (staff.value?.spells ?? []).reduce<Record<string, Spell[]>>((acc, s) => {
    const rank = s.system.traits?.value?.includes('cantrip') ? 0 : (s.system.level?.value ?? 0)
    ;(acc[rank] ??= []).push(s)
    return acc
  }, {})
)

// The dual-mode "select a spell" dialog lives in SpellSelectionDialog. Opened
// from an empty slot (slot mode — prepares into it) or from the entry modal's
// "Known Spells" (browse mode — picking opens the spell's info card here).
function openSpellSelection(info: SpellInfo) {
  spellSelectionDialog.value?.open(info)
}

const spellbook = computed(() => buildSpellbook(spellcastingEntries.value, spells.value))
const prepList = computed(() => buildPrepList(spellcastingEntries.value, spells.value))

// ⋮ menu action on the spellcasting-entry modal: browse the entry's full known
// spell list. Opens the same dialog the (empty) slots use, but with no slot
// coordinates — that absence puts it in browse mode (see below).
function openKnownSpells() {
  const entry = viewedEntry.value
  if (!entry) return
  infoModal.value?.close()
  openSpellSelection({ entry, entryId: entry._id })
}
</script>
<template>
  <div data-component="SpellList">
    <div v-if="spellcastingEntries?.length === 0" class="px-6 pt-4 pb-8 italic">
      {{ $t('spells.noSpells') }}
    </div>
    <div v-else class="px-6 pt-4 pb-8 xl:columns-2">
      <!-- Spell Sources -->
      <SpellSourceSection
        v-for="location in spellcastingEntries"
        :key="location._id"
        class="pt-4"
        :data-section="
          location.system.prepared?.value === 'focus'
            ? 'focus'
            : location.system.tradition?.value || 'arcane'
        "
        :title="location.name ?? ''"
        :dc="location.system.spelldc?.dc || spellDC"
        :ranks="spellbook[location._id ?? '']"
        :prepList="prepList[location._id ?? '']"
        :entry="location"
        title-clickable
        @open-entry="openEntryModal(location)"
        @open-spell="openSpellModal"
        @open-slot="openSpellSelection"
        @pick="pickSpellRoll"
      >
        <template #headerCounter>
          <span class="pl-1">
            <CounterWidget
              v-if="location.system.prepared?.value === 'focus'"
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
      <!-- Staff from PF2e-Dailies -->
      <SpellSourceSection
        v-if="staff?.staffId"
        class="pt-4 [&:not(:has(li))]:hidden"
        data-section="staff"
        :title="staffItem?.name ?? ''"
        :dc="spellDC"
        :ranks="staffSpellsByRank"
        @open-spell="openSpellModal"
        @pick="pickSpellRoll"
      >
        <template #headerCounter>
          <CounterWidget
            class="relative -bottom-0.5 mt-px mr-2 h-4 text-sm"
            :value="staff?.charges?.value"
            :max="staff?.charges?.max"
            :title="staffItem?.name + ' charges'"
            editable
            @change-count="(newTotal) => staff?.setStaffCharges?.(newTotal)"
          />
        </template>
      </SpellSourceSection>
      <!-- Wands and Scrolls -->
      <SheetSection
        section="consumables"
        class="break-inside-avoid-column pt-4 [&:not(:has(li))]:hidden"
      >
        <template #header>
          <h3
            class="mb-1.5 flex justify-between align-bottom text-[1.1rem] font-normal tracking-[0.01em]"
          >
            <span>
              <span class="text-xl underline"> {{ $t('spells.wandsAndScrolls') }} </span>
              <span v-if="spellDC" class="text-xs"> (DC {{ spellDC }}) </span>
            </span>
          </h3>
        </template>
        <ul class="mb-1 empty:hidden">
          <li v-for="item in sortedConsumables" class="flex justify-between" :key="item._id">
            <div>
              <ViewableItem
                v-if="item"
                @click="openSpellModal(item?._id, { isConsumable: true })"
                class="inline-block text-left"
              >
                {{ item.name }}
              </ViewableItem>
            </div>
            <CounterWidget
              class="mt-1 mr-2 h-3 text-sm"
              :value="item.system.uses?.value"
              :max="item.system.uses?.max"
              :title="item.name"
              editable
              @change-count="(newTotal) => item?.changeUses?.(newTotal)"
            />
          </li>
        </ul>
      </SheetSection>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :itemId="viewedModalItem?._id"
        :imageUrl="viewedModalItem?.img"
        :traits="viewedEntry && !viewedItem ? [] : viewedItem?.system?.traits?.value"
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
          <template v-if="viewedEntry && !viewedItem">
            <span v-if="viewedEntry.spellAttackModifier != null">
              {{ $t('spells.spellAttack') }}
              {{ viewedEntry.spellAttackModifier >= 0 ? '+' : ''
              }}{{ viewedEntry.spellAttackModifier }}
            </span>
          </template>
          <template v-else>
            {{
              viewedItem?.system.traits?.value?.includes('cantrip')
                ? $t('spells.cantrips')
                : $t('spells.rank', { n: viewedItem?.system.level?.value })
            }}
            <span class="text-sm">{{ rarityLabel(viewedItem?.system.traits?.rarity) }}</span>
          </template>
        </template>
        <template #body>
          <SpellDetails
            ref="description"
            :entry="viewedEntry"
            :item="viewedItem"
            :spell="viewedSpell"
            :consumable="viewedConsumable"
            :spellInfo="viewedSpellInfo"
            :labels="rollOptionLabels"
            :spellRollData="viewedSpellRollData"
            :consumableSpellRollData="viewedConsumableSpellRollData"
          />
        </template>
        <template #headerActions>
          <KebabMenu
            v-if="
              isListening &&
              viewedSpellInfo?.entry?.system.prepared?.value === 'prepared' &&
              viewedSpellInfo?.castingRank != null
            "
            :items="[{ id: 'remove', label: $t('common.remove'), danger: true }]"
            :label="$t('common.actions')"
            @select="clearPreparedSpell"
          />
          <KebabMenu
            v-else-if="viewedEntry && !viewedItem && isStrictPrepared(viewedEntry)"
            :items="[{ id: 'known', label: $t('spells.knownSpells') }]"
            :label="$t('common.actions')"
            @select="openKnownSpells"
          />
        </template>
        <template #actionButtons v-if="isListening">
          <Button
            :label="$t('spells.cast')"
            color="blue"
            v-if="!viewedSpellInfo?.isConsumable && viewedItem"
            :disabled="castDisabled"
            :clicked="castViewedSpell"
          />
          <Button
            :label="$t('common.use')"
            color="green"
            v-if="viewedSpellInfo?.isConsumable"
            :clicked="consumeViewedSpellItem"
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
