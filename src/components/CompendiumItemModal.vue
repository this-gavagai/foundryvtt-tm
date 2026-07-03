<script setup lang="ts">
import { ref, computed } from 'vue'
import InfoModal from './InfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'
import Button from './widgets/ButtonWidget.vue'
import SpellcastingEntryPickerModal from './SpellcastingEntryPickerModal.vue'
import { BookOpenIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { getCompendiumItem, addCompendiumItem } from '@/api/actionRpc'
import { logger } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useTraitLabels } from '@/composables/useTraitLabels'
import { useListenersStore } from '@/stores/listenersOnline'
import { isStrictPrepared, isFlexiblePrepared } from '@/utils/spellcasting'
import { storeToRefs } from 'pinia'
import type { CompendiumItemData } from '@/types/api-types'

const { _id: characterId, spellcastingEntries } = useInjectedCharacter()
const { labelFor: rarityLabel } = useTraitLabels()
const { isListening } = storeToRefs(useListenersStore())

const modal = ref()
const entryPicker = ref<InstanceType<typeof SpellcastingEntryPickerModal>>()
const item = ref<CompendiumItemData | null>(null)
const loading = ref(false)
const adding = ref(false)
const added = ref(false)
const currentUuid = ref('')
const description = ref()
const rolls = useRollsFromActiveRoll(computed(() => description.value?.activeRoll))

const preparedEntries = computed(() =>
  (spellcastingEntries.value ?? []).filter((e) => isStrictPrepared(e) || isFlexiblePrepared(e))
)

const ADDABLE_TYPES = new Set(['action', 'effect', 'condition', 'equipment', 'consumable', 'backpack', 'weapon', 'armor', 'shield', 'treasure'])
const canAdd = computed(() => {
  if (!item.value) return false
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

async function addToCharacter() {
  if (!characterId.value || !currentUuid.value || adding.value) return

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

  adding.value = true
  try {
    await addCompendiumItem(characterId.value, currentUuid.value, spellcastingEntryId)
    added.value = true
  } finally {
    adding.value = false
  }
}

defineExpose({ open })
</script>
<template>
  <InfoModal ref="modal" :imageUrl="item?.img" :itemUuid="currentUuid || undefined" :traits="item?.system?.traits?.value" :rolls="rolls">
    <template #banner="{ close }">
      <div
        data-part="compendium-banner"
        class="-mx-6 -mt-6 mb-4 flex items-center gap-2 px-4 py-2 text-sm"
      >
        <BookOpenIcon class="h-4 w-4 shrink-0" />
        <span class="font-medium">Compendium</span>
        <span v-if="item?.source" class="opacity-60">· {{ item.source }}</span>
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
        :text="item.system?.description?.value"
      />
      <div v-else class="py-4 text-center text-gray-400">Item not found.</div>
    </template>
    <template #actionButtons>
      <Button
        v-if="canAdd && characterId && isListening"
        :color="added ? 'green' : 'blue'"
        :disabled="adding || added"
        :clicked="addToCharacter"
      >
        {{ added ? $t('common.added') : $t('compendium.addToCharacter') }}
      </Button>
    </template>
  </InfoModal>
  <SpellcastingEntryPickerModal ref="entryPicker" />
</template>
