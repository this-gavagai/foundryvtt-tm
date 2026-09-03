<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import InfoModal from './InfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'
import Button from './widgets/ButtonWidget.vue'
import SpellcastingEntryPickerModal from './SpellcastingEntryPickerModal.vue'
import ItemChoicePickerModal from './ItemChoicePickerModal.vue'
import { BookOpenIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { addCompendiumItem, getItemChoices } from '@/api/actionRpc'
import { createActorItem } from '@/api/documents'
import { getCompendiumItem, getCompendiumSource } from '@/api/compendium'
import { checkDirectAdd, normalizeDirectItemSource } from '@/utils/directItemCreate'

import { parseEmbeddedItemUuid } from '@/utils/compendiumData'
import { logger } from '@/utils/utilities'
import { useInjectedActor } from '@/composables/injectKeys'
import { useTraitLabels } from '@/composables/useTraitLabels'
import { useListenersStore } from '@/stores/listenersOnline'
import { isStrictPrepared, isFlexiblePrepared } from '@/utils/spellcasting'
import { storeToRefs } from 'pinia'
import type { CompendiumItemData, ItemChoiceSelection } from '@/types/api-types'

const { _id: characterId, _actor, spellcastingEntries } = useInjectedActor()
const { labelFor: rarityLabel } = useTraitLabels()
const { isListening } = storeToRefs(useListenersStore())

const modal = ref()
const entryPicker = ref<InstanceType<typeof SpellcastingEntryPickerModal>>()
const choicePicker = ref<InstanceType<typeof ItemChoicePickerModal>>()
// Set when the add was refused, so the row says why instead of just not
// happening. Cleared when the next attempt starts.
const addError = ref<string | null>(null)
// Set while the GM is away and this item can be added anyway, so the row can
// say what will and will not happen before the player taps.
const directNotice = ref<string | null>(null)
// Set while the GM is away and this item CANNOT be added, naming which
// limitation applies rather than just withholding the button.
const blockedReason = ref<string | null>(null)
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
    assessDirectAdd()
  } finally {
    loading.value = false
  }
}

// With a GM listening nothing here matters — the RPC runs PF2e's whole creation
// pipeline and is strictly better. This decides what to SAY, and whether to
// offer the button at all, for the case where there is no GM: some items can be
// created straight over the socket, and the rest cannot, and a player is owed
// the difference rather than a button that silently is or is not there.
//
// The reasons are enumerated (utils/directItemCreate) so the message can name
// the actual limitation instead of "not right now".
const REFUSAL_MESSAGE = {
  'has-rules': 'compendium.needsGmRules',
  'is-kit': 'compendium.needsGmKit',
  'character-building': 'compendium.needsGmBuilding',
  'needs-system': 'compendium.needsGmOther'
} as const

function assessDirectAdd() {
  directNotice.value = null
  blockedReason.value = null
  if (isListening.value) return
  // Assessed from the item already loaded, not a second pack read: the display
  // payload spreads the whole `system` (see shapeCompendiumItem), so it carries
  // the `rules` and `type` this check reads. getCompendiumSource is still what
  // the CREATE builds from — that needs the untouched source, and this one has
  // had its description rewritten for rendering.
  if (!item.value) return
  {
    const check = checkDirectAdd(item.value)
    if (check.eligible) {
      // Says what will happen AND what will not: the item lands, the derived
      // totals do not move until a GM answers the refresh. Those figures carry
      // their own marker meanwhile (composables/useDerivedStale).
      directNotice.value = 'compendium.addWithoutGm'
    } else {
      blockedReason.value = REFUSAL_MESSAGE[check.reason]
    }
  }
}

// Create the item straight over the socket, as this app's own Foundry user.
// Only reached for an item PF2e's pipeline would do nothing for — see the
// verified list in utils/directItemCreate — with the two `_preCreate`
// normalisations that apply replicated there.
async function addDirectly(uuid: string): Promise<boolean> {
  const source = await getCompendiumSource(uuid)
  if (!source) return false
  const check = checkDirectAdd(source)
  // Re-checked here rather than trusting the assessment: the modal may have
  // been open across a reconnect, and creating an ineligible item directly is
  // exactly the silent half-add this whole path is meant to avoid.
  if (!check.eligible) {
    blockedReason.value = REFUSAL_MESSAGE[check.reason]
    return false
  }
  await createActorItem(_actor, [normalizeDirectItemSource(source)])
  return true
}

// Re-assessed when the GM comes or goes, not only when the modal opens: a sheet
// left open across a disconnect would otherwise keep offering the RPC path and
// spend the full ack timeout discovering there is no one to answer it. And in
// the other direction, a returning GM should restore the full add rather than
// leave the reduced one on offer.
watch(isListening, () => {
  if (currentUuid.value) assessDirectAdd()
})

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
    // The RPC whenever a GM is listening: it runs the system's pipeline, which
    // is always the better add. The direct path is the no-GM fallback only.
    if (isListening.value) {
      await addCompendiumItem(characterId.value, currentUuid.value, spellcastingEntryId, selections)
      added.value = true
    } else {
      added.value = await addDirectly(currentUuid.value)
    }
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
          <!-- No GM, and this item is one the system would have to build. Name
               the limitation rather than withhold the button silently. -->
          <p
            v-else-if="blockedReason && canAdd && characterId"
            data-part="blocked-reason"
            class="text-sm text-gray-500 italic"
          >
            {{ $t(blockedReason) }}
          </p>
          <!-- No GM, but this one can be added anyway. Says what will happen
               and what will not, before the tap. -->
          <p
            v-else-if="directNotice && canAdd && characterId"
            data-part="direct-notice"
            class="text-sm text-gray-500 italic"
          >
            {{ $t(directNotice) }}
          </p>
          <Button
            v-if="canAdd && characterId && (isListening || directNotice)"
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
