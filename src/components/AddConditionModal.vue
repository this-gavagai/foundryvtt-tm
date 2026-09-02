<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/ModalBox.vue'
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { useInjectedActor } from '@/composables/injectKeys'
import { getCompendiumIndex } from '@/api/compendium'
import { addCompendiumItem } from '@/api/actionRpc'
import { PF2E_CONDITIONS_PACK } from '@/utils/constants'
import { getPath, logger } from '@/utils/utilities'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import type { CompendiumIndexEntry } from '@/types/api-types'

// A one-tap picker, deliberately NOT the compendium browser. Browsing is for
// reading an item before deciding — pick a pack, open an entry, read it, add it,
// then dismiss two overlays. Applying a condition is the opposite: you already
// know which one you want, so the name is the whole interaction. Tap it, it's
// applied, the modal is gone.
//
// The list is the conditions pack itself, so a system update or a homebrew
// condition shows up here without anything to maintain.

const modal = ref<InstanceType<typeof Modal>>()
const { _id: characterId } = useInjectedActor()

const entries = ref<CompendiumIndexEntry[]>([])
const loading = ref(false)
const failed = ref(false)
// uuid of the row being applied, so only that row shows a spinner.
const adding = ref<string | undefined>()

async function loadConditions() {
  loading.value = true
  failed.value = false
  try {
    const result = await getCompendiumIndex(PF2E_CONDITIONS_PACK)
    entries.value = result.compendiumIndex ?? []
  } catch (error) {
    // Reading a pack goes over the app's own socket, so this is a dropped
    // connection rather than an absent GM. Say so instead of showing an empty
    // list, which would read as "this world has no conditions".
    logger.warn('TM-ADD-CONDITION: could not read the conditions pack', error)
    failed.value = true
  } finally {
    loading.value = false
  }
}

function open() {
  modal.value?.open()
  // Cached across opens: the pack is static, and re-reading it on every tap
  // would put a visible pause in front of a list the player already saw.
  if (!entries.value.length && !loading.value) loadConditions()
}

async function applyCondition(entry: CompendiumIndexEntry) {
  if (!characterId.value || adding.value) return
  adding.value = entry.uuid
  try {
    await addCompendiumItem(characterId.value, entry.uuid)
    modal.value?.close()
  } catch (error) {
    // Adding an item is an RPC through the GM's client, so this is most often
    // "no GM online". Keep the modal up — closing it would look like the
    // condition had been applied.
    logger.warn('TM-ADD-CONDITION: could not apply', entry.name, error)
    failed.value = true
  } finally {
    adding.value = undefined
  }
}

defineExpose({ open })
</script>

<template>
  <Modal ref="modal" :title="$t('effects.addCondition')">
    <div data-component="AddConditionModal" class="max-h-[60vh] overflow-y-auto py-2">
      <div v-if="loading" class="flex justify-center py-8"><Spinner class="h-8 w-8" /></div>
      <p v-else-if="failed" class="py-8 text-center text-sm text-red-500" data-part="failed">
        {{ $t('effects.addConditionFailed') }}
      </p>
      <ul v-else class="flex flex-col gap-1">
        <li v-for="entry in entries" :key="entry.uuid">
          <button
            type="button"
            data-part="condition"
            class="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors active:opacity-60"
            :disabled="!!adding"
            @pointerdown="triggerLightHapticFeedback()"
            @click="applyCondition(entry)"
          >
            <img
              v-if="entry.img"
              :src="getPath(entry.img)"
              class="h-7 w-7 flex-none rounded-full"
              alt=""
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
            <Spinner v-if="adding === entry.uuid" class="h-4 w-4 flex-none" />
          </button>
        </li>
      </ul>
    </div>
  </Modal>
</template>
