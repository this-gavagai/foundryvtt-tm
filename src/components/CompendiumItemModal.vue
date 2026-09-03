<script setup lang="ts">
import { ref, computed } from 'vue'
import InfoModal from './InfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'
import Button from './widgets/ButtonWidget.vue'
import SpellcastingEntryPickerModal from './SpellcastingEntryPickerModal.vue'
import ItemChoicePickerModal from './ItemChoicePickerModal.vue'
import { BookOpenIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { addCompendiumItem, getItemChoices } from '@/api/actionRpc'
import { getCompendiumItem } from '@/api/compendium'
import { parseEmbeddedItemUuid } from '@/utils/compendiumData'
import { logger } from '@/utils/utilities'
import { useInjectedActor } from '@/composables/injectKeys'
import { useTraitLabels } from '@/composables/useTraitLabels'
import { useListenersStore } from '@/stores/listenersOnline'
import { isStrictPrepared, isFlexiblePrepared } from '@/utils/spellcasting'
import { storeToRefs } from 'pinia'
import type { CompendiumItemData, ItemChoiceSelection } from '@/types/api-types'

const { _id: characterId, spellcastingEntries } = useInjectedActor()
const { labelFor: rarityLabel } = useTraitLabels()
const { isListening } = storeToRefs(useListenersStore())

const modal = ref()
const entryPicker = ref<InstanceType<typeof SpellcastingEntryPickerModal>>()
const choicePicker = ref<InstanceType<typeof ItemChoicePickerModal>>()
// Set when the add was refused, so the row says why instead of just not
// happening. Cleared when the next attempt starts.
const addError = ref<string | null>(null)
const item = ref<CompendiumItemData | null>(null)
const loading = ref(false)
const adding = ref(false)
const added = ref(false)
const currentUuid = ref('')
const description = ref()
const rolls = useRollsFromActiveRoll(computed(() => description.value?.activeRoll))

const preparedEntries = computed(() =>
  (spellcastingEntries?.value ?? []).filter((e) => isStrictPrepared(e) || isFlexiblePrepared(e))
)

// An actor-embedded item (Actor.<id>.Item.<id>, e.g. a staff PF2e Dailies
// prepared on a character) resolves from the world payload rather than a pack —
// its banner names the owning actor instead of reading "Compendium".
const embeddedRef = computed(() => parseEmbeddedItemUuid(currentUuid.value))
const isEmbedded = computed(() => !!embeddedRef.value)
const sourceLabel = computed(() => (isEmbedded.value ? item.value?.source || '' : 'Compendium'))

// The compendium-scoped RPCs (add-to-character, send-to-chat) refuse a
// non-compendium uuid by design — a player must not be able to copy or
// broadcast an arbitrary world document. So an embedded item offers no add
// button, and only reaches "send to chat" via the native owned-item path, and
// only when it sits on the character whose sheet is open.
const ownItemId = computed(() =>
  embeddedRef.value && embeddedRef.value.actorId === characterId.value
    ? embeddedRef.value.itemId
    : undefined
)

// Journal UUIDs (whole entry or a single page) carry a JournalEntry segment;
// their body is prose HTML rather than an item stat block, so it gets the
// journal-content typography hook (see main.css).
const isJournal = computed(() => /JournalEntry/.test(currentUuid.value))

const ADDABLE_TYPES = new Set([
  'action',
  'effect',
  'condition',
  'equipment',
  'consumable',
  'backpack',
  'weapon',
  'armor',
  'shield',
  'treasure'
])
const canAdd = computed(() => {
  if (!item.value || isEmbedded.value) return false
  const type = item.value.type ?? ''
  if (type === 'spell') return preparedEntries.value.length > 0
  return ADDABLE_TYPES.has(type)
})

async function open(uuid: string) {
  currentUuid.value = uuid
  item.value = null
  added.value = false
  loading.value = true
  modal.value.open()
  try {
    const result = await getCompendiumItem(uuid)
    logger.debug('TM-COMPENDIUM-ITEM', result)
    item.value = result.compendiumItem ?? null
  } finally {
    loading.value = false
  }
}

// The choices this item would otherwise ask the GM to make.
//
// Asked one at a time and re-asked after each answer, because a ChoiceSet's
// options can be built from an earlier one's selection and can only be inflated
// once it is known (see foundry/handlers/itemChoices.ts). Resolves with the
// answers, or null if the player backed out or hit a question that cannot be
// answered here — in which case nothing is created.
async function gatherChoices(uuid: string): Promise<ItemChoiceSelection[] | null> {
  const selections: ItemChoiceSelection[] = []
  // A ceiling rather than `while (true)`: the module decides what is still
  // pending, and a version of it that kept answering the same question would
  // otherwise spin here forever. No real item carries anything like this many.
  for (let round = 0; round < 12; round++) {
    const { choices } = await getItemChoices(characterId.value!, uuid, selections)
    const next = choices[0]
    if (!next) return selections
    if (next.unanswerable) {
      addError.value = 'compendium.choiceRefused'
      return null
    }
    const value = await choicePicker.value?.open(next)
    if (value === null || value === undefined) return null
    selections.push({ ruleIndex: next.ruleIndex, value })
  }
  addError.value = 'compendium.choiceRefused'
  return null
}

async function addToCharacter() {
  if (!characterId.value || !currentUuid.value || adding.value) return
  addError.value = null

  let spellcastingEntryId: string | undefined
  if (item.value?.type === 'spell') {
    const entries = preparedEntries.value
    if (entries.length === 1) {
      spellcastingEntryId = entries[0]._id ?? undefined
    } else {
      const chosen = await entryPicker.value?.open(entries)
      if (!chosen) return
      spellcastingEntryId = chosen
    }
  }

  // Before the create, not after: an unanswered ChoiceSet would stop the
  // pipeline on the GM's client and put the dialog on their screen. The module
  // refuses such a create outright, so this is also what keeps the common case
  // from becoming a visible failure.
  const selections = await gatherChoices(currentUuid.value)
  if (!selections) return

  adding.value = true
  try {
    await addCompendiumItem(characterId.value, currentUuid.value, spellcastingEntryId, selections)
    added.value = true
  } catch (error) {
    logger.warn('TM-COMPENDIUM-ITEM: add failed', error)
    // The module names an unanswerable choice with its own sentinel; anything
    // else is an ordinary failure.
    addError.value = String(error).includes('TM_ITEM_CHOICE_UNANSWERABLE')
      ? 'compendium.choiceRefused'
      : 'compendium.addFailed'
  } finally {
    adding.value = false
  }
}

defineExpose({ open })
</script>
<template>
  <div data-component="CompendiumItemModalRoot">
    <InfoModal
      ref="modal"
      :imageUrl="item?.img"
      :itemId="ownItemId"
      :itemUuid="isEmbedded ? undefined : currentUuid || undefined"
      :traits="item?.system?.traits?.value"
      :rolls="rolls"
    >
      <template #banner="{ close }">
        <div
          data-part="compendium-banner"
          class="-mx-6 -mt-6 mb-4 flex items-center gap-2 px-4 py-2 text-sm"
        >
          <BookOpenIcon class="h-4 w-4 shrink-0" />
          <span class="font-medium">{{ sourceLabel }}</span>
          <span v-if="!isEmbedded && item?.source" class="opacity-60">· {{ item.source }}</span>
          <button type="button" data-part="close" class="ml-auto cursor-pointer" @click="close">
            <XMarkIcon class="h-5 w-5" />
          </button>
        </div>
      </template>
      <template #title>
        <span v-if="loading">…</span>
        <span v-else>{{ item?.name }}</span>
      </template>
      <template #description>
        <div class="flex flex-wrap gap-x-2 gap-y-0.5">
          <span v-if="item?.system?.level?.value"
            >{{ $t('common.level') }} {{ item.system.level.value }}</span
          >
          <span v-if="item?.system?.traits?.rarity"
            >({{ rarityLabel(item.system.traits.rarity) }})</span
          >
        </div>
      </template>
      <template #body>
        <div v-if="loading" class="py-4 text-center text-gray-400">Loading…</div>
        <ParsedDescription
          v-else-if="item"
          ref="description"
          :data-part="isJournal ? 'journal-content' : undefined"
          :text="item.system?.description?.value"
        />
        <div v-else class="py-4 text-center text-gray-400">Item not found.</div>
      </template>
      <template #actionButtons>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <!-- Why the add did not happen. Without it a refused item just fails
               to appear, which reads as the button doing nothing. -->
          <p v-if="addError" data-part="add-error" class="text-sm text-red-700 italic">
            {{ $t(addError) }}
          </p>
          <Button
            v-if="canAdd && characterId && isListening"
            :color="added ? 'green' : 'blue'"
            :disabled="adding || added"
            :clicked="addToCharacter"
          >
            {{ added ? $t('common.added') : $t('compendium.addToCharacter') }}
          </Button>
        </div>
      </template>
    </InfoModal>
    <SpellcastingEntryPickerModal ref="entryPicker" />
    <ItemChoicePickerModal ref="choicePicker" />
  </div>
</template>
