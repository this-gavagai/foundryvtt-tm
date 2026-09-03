<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import type { ExplorationActivity } from '@/composables/character'
import { useInjectedCharacter } from '@/composables/injectKeys'

import SheetSection from '@/components/widgets/SheetSection.vue'
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import DetailInfoModal from '@/components/DetailInfoModal.vue'

// The activities the character is currently doing in exploration mode.
//
// A panel of its own rather than a fifth group in ActionsList, because these
// rows answer a different question. Every other action row asks "can I do this
// now?"; these ask "what am I doing?" — a standing choice that persists between
// scenes, which is exactly why PF2e gives it a tab and a mark of its own.
//
// The mark is all there is: PF2e derives nothing from it (see the exploration
// block in useCharacterActions), so a row toggles and nothing else moves.

const character = useInjectedCharacter()
const { explorationActivities, rollOptionLabels } = character

const detailModal = ref<InstanceType<typeof DetailInfoModal>>()

// Held by id, not by object: the list re-sorts the moment a toggle lands (an
// activated row jumps to the top), so the object identity a row was rendered
// from is gone by the time the modal reads it.
const viewedId = ref<string | undefined>()
const viewed = computed(() => explorationActivities.value?.find((a) => a._id === viewedId.value))

// One in-flight toggle per row. The write is a full-array replacement, so two
// racing rows would each send a list built before the other landed and the
// slower ack would win — disabling the row that's mid-flight keeps the array
// the actor's, not the last packet's.
const pendingIds = reactive(new Set<string>())

function isPending(activity: ExplorationActivity) {
  return !!activity._id && pendingIds.has(activity._id)
}

async function toggle(activity: ExplorationActivity) {
  if (!activity._id || pendingIds.has(activity._id)) return
  pendingIds.add(activity._id)
  try {
    await activity.toggleActive()
  } finally {
    pendingIds.delete(activity._id)
  }
}

function view(activity: ExplorationActivity) {
  viewedId.value = activity._id
  detailModal.value?.open()
}
</script>

<template>
  <div data-component="ExplorationList">
    <!-- Hidden outright when the character has no exploration activities on
           the sheet, the way every other action group hides: an empty panel
           here would read as "you can't do this", which isn't true — the
           activities just haven't been added to the sheet. -->
    <SheetSection
      section="exploration"
      :title="$t('actionTypes.exploration')"
      class="break-inside-avoid-column pt-4 [&:not(:has(li))]:hidden"
    >
      <ul>
        <!-- Name left, state right — the same split every other row on this
               tab uses for its name and its uses indicator. The mark has to be
               on the right rather than leading the row: a marker in front of
               the name would indent all of them past the Actions cards stacked
               directly above in the same column. -->
        <li
          v-for="activity in explorationActivities"
          :key="activity._id"
          :data-active="activity.active ? 'true' : 'false'"
          class="flex items-baseline justify-between gap-2"
        >
          <ViewableItem scale="firm" class="inline-block" @click="view(activity)">
            {{ activity.name }}
          </ViewableItem>
          <!-- The word names the state outright rather than leaving a single
                 label to be read as lit-or-dim: "Active" and "Inactive" are
                 unambiguous read alone, on a row, or by a screen reader. The
                 dimming stays on top of it so the active rows still carry the
                 glance, but nothing depends on catching it. -->
          <button
            type="button"
            data-part="active-toggle"
            class="shrink-0 cursor-pointer text-sm whitespace-nowrap text-gray-600 active:text-gray-500 disabled:cursor-wait"
            :class="activity.active ? 'opacity-100' : 'opacity-50'"
            :disabled="isPending(activity)"
            :aria-pressed="activity.active"
            :aria-label="`${activity.name}: ${
              activity.active ? $t('actions.explorationActive') : $t('actions.explorationInactive')
            }`"
            @click="toggle(activity)"
          >
            <Spinner v-if="isPending(activity)" class="inline-block h-3 w-3" />
            <template v-else>
              {{
                activity.active
                  ? $t('actions.explorationActive')
                  : $t('actions.explorationInactive')
              }}
            </template>
          </button>
        </li>
      </ul>
    </SheetSection>
    <DetailInfoModal ref="detailModal" :item="viewed" :labels="rollOptionLabels">
      <!-- The same toggle the row carries, offered where a player has just
           finished reading what the activity does — which is when they decide
           to start doing it. -->
      <template #actionButtons v-if="viewed">
        <!-- Labelled with the state rather than with the verb, because that is
             what the button is for: it says what you're doing, and tapping it
             changes that. `aria-pressed` falls through to the underlying
             <button>, so the toggle reads as one to a screen reader too. -->
        <Button
          :color="viewed.active ? 'teal' : 'gray'"
          :label="
            viewed.active ? $t('actions.explorationActive') : $t('actions.explorationInactive')
          "
          :aria-pressed="viewed.active"
          :clicked="() => viewed && toggle(viewed)"
        />
      </template>
    </DetailInfoModal>
  </div>
</template>
