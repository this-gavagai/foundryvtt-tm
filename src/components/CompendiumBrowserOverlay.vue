<script setup lang="ts">
import { computed, ref } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'
import { ArrowLeftIcon, BookOpenIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useOverlayStack } from '@/composables/useOverlayStack'
import { listCompendia, getCompendiumIndex } from '@/api/actionRpc'
import { getPath, logger } from '@/utils/utilities'
import type { CompendiumPackInfo, CompendiumIndexEntry } from '@/types/api-types'
import CompendiumItemModal from '@/components/CompendiumItemModal.vue'

// Cap rows rendered at once — some packs (equipment, spells) hold thousands of
// entries; the filter box below is the way to reach anything past the cap.
const RENDER_LIMIT = 200

const isOpen = ref(false)
const { zIndex, openLayer, closeLayer } = useOverlayStack()
const compendiumModal = ref<InstanceType<typeof CompendiumItemModal>>()

const compendia = ref<CompendiumPackInfo[]>([])
const selectedPack = ref<CompendiumPackInfo | null>(null)
const entries = ref<CompendiumIndexEntry[]>([])
const loadingPacks = ref(false)
const loadingEntries = ref(false)
const filter = ref('')

// Only item packs are browsable for now — the item modal renders/​adds items.
const itemPacks = computed(() =>
  compendia.value
    .filter((pack) => pack.documentType === 'Item')
    .sort((a, b) => a.label.localeCompare(b.label))
)

// Group packs by owning package so the list reads as "Pathfinder 2e" /
// "world" / module sections rather than one long flat list.
const groupedPacks = computed(() => {
  const matchesFilter = (pack: CompendiumPackInfo) =>
    !filter.value || pack.label.toLowerCase().includes(filter.value.toLowerCase())
  const groups = new Map<string, CompendiumPackInfo[]>()
  for (const pack of itemPacks.value) {
    if (!matchesFilter(pack)) continue
    const bucket = groups.get(pack.packageName) ?? []
    bucket.push(pack)
    groups.set(pack.packageName, bucket)
  }
  return Array.from(groups, ([packageName, packs]) => ({ packageName, packs })).sort((a, b) =>
    a.packageName.localeCompare(b.packageName)
  )
})

const filteredEntries = computed(() => {
  if (!filter.value) return entries.value
  const needle = filter.value.toLowerCase()
  return entries.value.filter((entry) => entry.name.toLowerCase().includes(needle))
})
const visibleEntries = computed(() => filteredEntries.value.slice(0, RENDER_LIMIT))
const truncatedCount = computed(() => filteredEntries.value.length - visibleEntries.value.length)

async function loadPacks() {
  loadingPacks.value = true
  try {
    const result = await listCompendia()
    logger.debug('TM-LIST-COMPENDIA', result)
    compendia.value = result.compendia ?? []
  } finally {
    loadingPacks.value = false
  }
}

async function openPack(pack: CompendiumPackInfo) {
  selectedPack.value = pack
  filter.value = ''
  entries.value = []
  loadingEntries.value = true
  try {
    const result = await getCompendiumIndex(pack.id)
    logger.debug('TM-COMPENDIUM-INDEX', pack.id, result.compendiumIndex?.length)
    entries.value = result.compendiumIndex ?? []
  } finally {
    loadingEntries.value = false
  }
}

function back() {
  selectedPack.value = null
  filter.value = ''
}

function openEntry(entry: CompendiumIndexEntry) {
  compendiumModal.value?.open(entry.uuid)
}

function open() {
  openLayer()
  isOpen.value = true
  if (!compendia.value.length && !loadingPacks.value) loadPacks()
}

function close() {
  isOpen.value = false
  closeLayer()
}

defineExpose({ open, close, isOpen })
</script>

<template>
  <TransitionRoot appear :show="isOpen" as="template">
    <Dialog as="div" class="relative touch-manipulation" :style="{ zIndex }" @close="close">
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/35" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-hidden p-0 sm:p-4">
        <div class="flex h-full items-stretch justify-center text-left sm:items-center">
          <TransitionChild
            as="template"
            enter="duration-200 ease-out"
            enter-from="opacity-0 translate-y-4 sm:scale-95 sm:translate-y-0"
            enter-to="opacity-100 translate-y-0 sm:scale-100"
            leave="duration-150 ease-in"
            leave-from="opacity-100 translate-y-0 sm:scale-100"
            leave-to="opacity-0 translate-y-4 sm:scale-95 sm:translate-y-0"
          >
            <DialogPanel
              data-component="CompendiumBrowserOverlay"
              data-part="panel"
              class="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl transition-all sm:h-[calc(100dvh-2rem)] sm:rounded-lg"
            >
              <header class="border-divider flex h-14 flex-none items-center gap-3 border-b px-4">
                <button
                  v-if="selectedPack"
                  data-part="back"
                  type="button"
                  class="-ml-1 rounded-md p-1 text-gray-400 hover:text-gray-600"
                  @click="back"
                >
                  <span class="sr-only">{{ $t('compendiumBrowser.back') }}</span>
                  <ArrowLeftIcon class="h-5 w-5" aria-hidden="true" />
                </button>
                <BookOpenIcon v-else class="h-5 w-5 flex-none text-gray-500" aria-hidden="true" />
                <DialogTitle as="h3" class="truncate text-lg leading-6 font-medium text-gray-900">
                  {{ selectedPack ? selectedPack.label : $t('compendiumBrowser.title') }}
                </DialogTitle>
                <button
                  data-part="close"
                  class="ml-auto rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-hidden"
                  type="button"
                  @click="close"
                >
                  <span class="sr-only">{{ $t('common.close') }}</span>
                  <XMarkIcon class="h-6 w-6" aria-hidden="true" />
                </button>
              </header>

              <div class="border-divider flex-none border-b px-4 py-2">
                <input
                  v-model="filter"
                  data-part="filter"
                  type="search"
                  class="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                  :placeholder="
                    selectedPack
                      ? $t('compendiumBrowser.filterEntries')
                      : $t('compendiumBrowser.filterPacks')
                  "
                />
              </div>

              <div data-part="scroll" class="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
                <!-- Pack list -->
                <template v-if="!selectedPack">
                  <div v-if="loadingPacks" class="py-8 text-center text-gray-400">
                    {{ $t('common.loading') }}
                  </div>
                  <div
                    v-else-if="groupedPacks.length === 0"
                    class="py-8 text-center text-gray-500 italic"
                  >
                    {{ $t('compendiumBrowser.noPacks') }}
                  </div>
                  <div v-else class="flex flex-col gap-4">
                    <section v-for="group in groupedPacks" :key="group.packageName">
                      <h4
                        class="mb-1 px-1 text-xs font-semibold tracking-wide text-gray-500 uppercase"
                      >
                        {{ group.packageName }}
                      </h4>
                      <ul class="flex flex-col gap-1">
                        <li v-for="pack in group.packs" :key="pack.id">
                          <button
                            type="button"
                            data-part="pack"
                            class="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-900 transition-colors hover:bg-gray-100 active:bg-gray-200"
                            @click="openPack(pack)"
                          >
                            <BookOpenIcon class="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
                            <span class="truncate">{{ pack.label }}</span>
                          </button>
                        </li>
                      </ul>
                    </section>
                  </div>
                </template>

                <!-- Entry list for a selected pack -->
                <template v-else>
                  <div v-if="loadingEntries" class="py-8 text-center text-gray-400">
                    {{ $t('common.loading') }}
                  </div>
                  <div
                    v-else-if="filteredEntries.length === 0"
                    class="py-8 text-center text-gray-500 italic"
                  >
                    {{ $t('compendiumBrowser.noEntries') }}
                  </div>
                  <template v-else>
                    <ul class="flex flex-col gap-1">
                      <li v-for="entry in visibleEntries" :key="entry.uuid">
                        <button
                          type="button"
                          data-part="entry"
                          class="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-left text-sm text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100"
                          @click="openEntry(entry)"
                        >
                          <img
                            v-if="entry.img"
                            :src="getPath(entry.img)"
                            class="h-7 w-7 flex-none rounded object-cover"
                            alt=""
                            aria-hidden="true"
                          />
                          <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
                          <span
                            v-if="entry.rarity && entry.rarity !== 'common'"
                            data-part="rarity"
                            class="flex-none text-xs text-gray-400 capitalize"
                          >
                            {{ entry.rarity }}
                          </span>
                          <span
                            v-if="entry.level !== undefined"
                            data-part="level"
                            class="flex-none text-xs font-medium text-gray-500"
                          >
                            {{ $t('compendiumBrowser.levelShort', { level: entry.level }) }}
                          </span>
                        </button>
                      </li>
                    </ul>
                    <p
                      v-if="truncatedCount > 0"
                      data-part="truncated"
                      class="mt-3 px-1 text-center text-xs text-gray-400 italic"
                    >
                      {{ $t('compendiumBrowser.truncated', { count: truncatedCount }) }}
                    </p>
                  </template>
                </template>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
      <CompendiumItemModal ref="compendiumModal" />
    </Dialog>
  </TransitionRoot>
</template>
