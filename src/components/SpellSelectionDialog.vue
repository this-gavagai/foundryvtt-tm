<script setup lang="ts">
import type { Spell, SpellcastingEntry } from '@/composables/character'
import type { SpellInfo } from '@/utils/spellcasting'
import { computed, ref } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

import Modal from '@/components/ModalBox.vue'
import Spinner from '@/components/widgets/SpinnerWidget.vue'

// The "select a spell" dialog, lifted out of SpellList. Serves two modes, told
// apart by the SpellInfo it's opened with:
//   slot mode   (castingRank set — opened from an empty slot): shows only the
//               spells castable at that rank; picking prepares into the slot.
//   browse mode (no castingRank — opened from the entry modal's "Known Spells"):
//               shows the entry's whole known list; picking emits open-spell so
//               the parent shows the spell's info card, and rows offer removal.
const props = defineProps<{
  spells: Spell[] | undefined
  entries: SpellcastingEntry[] | undefined
}>()
const emit = defineEmits<{
  'open-spell': [id: string | undefined, info: SpellInfo]
}>()

const modal = ref<InstanceType<typeof Modal>>()
const options = computed<SpellInfo | undefined>(() => modal.value?.options)

const entryById = (id?: string | null) => props.entries?.find((e) => e._id === id)

const browsing = computed(() => options.value?.castingRank == null)

// Free-text filter, reset each time the dialog opens.
const filter = ref('')

// Two-step inline removal state for the known-spell (browse) list.
const preparingSpellId = ref<string | null>(null)
const removingSpellId = ref<string | null>(null)
const confirmingRemoveId = ref<string | null>(null)

function open(info: SpellInfo) {
  filter.value = ''
  confirmingRemoveId.value = null
  modal.value?.open(info)
}

defineExpose({ open })

const selectableSpells = computed(() => {
  const opts = options.value
  if (!opts?.entryId) return []
  const isCantrip = (i: Spell) => !!i.system.traits?.value?.includes('cantrip')
  return props.spells?.filter((i) => {
    if (i.system.location?.value !== opts.entryId) return false
    if (opts.castingRank == null) return true
    return opts.castingRank === 0
      ? isCantrip(i)
      : !isCantrip(i) && (i.system.level?.value ?? 0) <= opts.castingRank
  })
})

const selectableSpellsByRank = computed(() => {
  const grouped = new Map<number, Spell[]>()
  for (const spell of selectableSpells.value ?? []) {
    const rank = spell.system.traits?.value?.includes('cantrip')
      ? 0
      : (spell.system.level?.value ?? 0)
    ;(grouped.get(rank) ?? grouped.set(rank, []).get(rank)!).push(spell)
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, spells]) => ({
      rank,
      spells: [...spells].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    }))
})

const filteredSpellsByRank = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  if (!needle) return selectableSpellsByRank.value
  return selectableSpellsByRank.value
    .map((group) => ({
      rank: group.rank,
      spells: group.spells.filter((s) => (s.name ?? '').toLowerCase().includes(needle))
    }))
    .filter((group) => group.spells.length)
})

function setPreparedSpell(spell: Spell) {
  if (preparingSpellId.value || removingSpellId.value) return
  confirmingRemoveId.value = null
  preparingSpellId.value = spell._id ?? null
  return Promise.resolve(
    entryById(options.value?.entryId)?.setPrepared?.(
      options.value?.castingRank,
      options.value?.castingSlot,
      spell._id ?? null
    )
  )
    .then(() => modal.value?.close())
    .finally(() => (preparingSpellId.value = null))
}

// Row tap: prepare into the slot (slot mode) or show the spell's info card
// (browse mode — the parent owns that modal).
function pickSpell(spell: Spell) {
  if (browsing.value) {
    emit('open-spell', spell._id, { entry: options.value?.entry, entryId: options.value?.entryId })
  } else {
    setPreparedSpell(spell)
  }
}

function removeKnownSpell(spell: Spell) {
  if (removingSpellId.value) return
  removingSpellId.value = spell._id ?? null
  return Promise.resolve(spell.delete?.()).finally(() => {
    removingSpellId.value = null
    confirmingRemoveId.value = null
  })
}
</script>
<template>
  <Modal ref="modal" :title="$t(browsing ? 'spells.knownSpells' : 'spells.selectSpell')">
    <input
      v-model="filter"
      data-part="filter"
      type="search"
      class="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
      :placeholder="$t('spells.filterSpells')"
    />
    <!-- Fixed-height scroll area so the panel height stays constant as the
         filtered list shrinks, keeping the filter box in a steady position. -->
    <div class="mt-1 h-[min(70vh,100dvh-11rem)] overflow-y-auto">
      <div v-for="group in filteredSpellsByRank" :key="group.rank" class="mt-3 first:mt-2">
        <h4 class="mb-1 pb-1 text-[0.7rem] font-semibold tracking-[0.07em] text-gray-400 uppercase">
          {{ group.rank === 0 ? $t('spells.cantrips') : $t('spells.rank', { n: group.rank }) }}
        </h4>
        <ul>
          <li
            data-part="spell-option"
            class="flex items-center justify-between rounded px-2 py-1 transition-opacity"
            :class="
              preparingSpellId || removingSpellId
                ? 'pointer-events-none cursor-default opacity-50'
                : 'cursor-pointer hover:bg-gray-100'
            "
            v-for="spell in group.spells"
            @click="pickSpell(spell)"
            :key="spell._id"
          >
            <span class="min-w-0 truncate">{{ spell.name }}</span>
            <Spinner
              v-if="preparingSpellId === spell._id || removingSpellId === spell._id"
              class="ml-2 h-4 w-4 shrink-0"
            />
            <!-- Removal is a spellbook edit, offered only when browsing the
                 known list from the entry modal — not when filling a slot. -->
            <span v-else-if="browsing" class="flex shrink-0 items-center" @click.stop>
              <button
                v-if="confirmingRemoveId === spell._id"
                type="button"
                data-part="remove-spell-confirm"
                class="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600 transition duration-180 ease-out active:scale-[0.90] active:opacity-50 active:duration-60"
                @pointerdown="triggerLightHapticFeedback()"
                @click="removeKnownSpell(spell)"
              >
                {{ $t('spells.confirmRemove') }}
              </button>
              <button
                v-else
                type="button"
                data-part="remove-spell"
                class="ml-2 cursor-pointer rounded text-gray-400 transition duration-180 ease-out active:scale-[0.90] active:opacity-50 active:duration-60"
                :aria-label="$t('common.remove')"
                @pointerdown="triggerLightHapticFeedback()"
                @click="confirmingRemoveId = spell._id ?? null"
              >
                <XMarkIcon class="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          </li>
        </ul>
      </div>
      <div v-if="!filteredSpellsByRank.length" class="mt-3 px-2 py-1 text-sm text-gray-400 italic">
        {{ $t('common.noResults') }}
      </div>
    </div>
  </Modal>
</template>
