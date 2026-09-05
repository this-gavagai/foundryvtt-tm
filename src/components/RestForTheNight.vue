<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useListenersStore } from '@/stores/listenersOnline'

import SheetSection from '@/components/widgets/SheetSection.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import ConfirmDialog from '@/components/widgets/ConfirmDialog.vue'

// The end of a session, as one button.
//
// Everything the rest DOES belongs to PF2e — hit points recovered, doomed and
// drained stepped down, fatigued cleared, spell slots and focus refilled, wands
// recharged, temporary items dropped, daily preparations reset — and the module
// calls the system's own `restForTheNight` rather than reproducing any of it
// (see foundry/handlers/restForTheNight.ts). What lives here is only the two
// things that have to happen on the tablet: asking, and saying when it can't.
//
// It confirms first because a rest is a large, irreversible write to a
// character — the one button on this tab that can't be undone by tapping it
// again — and because it is a fat target beneath the downtime list, where a
// scroll that lands wrong should not end the party's day.
//
// PF2e has its own confirmation, and the module deliberately skips it: that
// prompt is a dialog on whichever client runs the rest, which is a GM's. Left
// on, a player's tap would hang until a GM noticed a dialog on their screen
// asking a question the player had already answered. So the confirm moves here,
// to the device that tapped.

const { doRestForTheNight } = useInjectedCharacter()
const { isListening } = storeToRefs(useListenersStore())

const confirmDialog = ref<InstanceType<typeof ConfirmDialog>>()
const button = ref<InstanceType<typeof Button>>()

// The Button owns the pending spinner and the failure flash (useAsyncClick), so
// the promise has to reach it rather than being fired from the dialog. The
// dialog resolves the tap; this is what it resolves to.
const pending = ref<(() => void) | null>(null)

function ask() {
  return new Promise<void>((resolve) => {
    // Resolving the Button's promise is what ends its spinner, so a cancel has
    // to resolve too — a dropped resolver would leave it spinning for good.
    pending.value = resolve
    confirmDialog.value?.open()
  })
}

async function confirmed() {
  const done = pending.value
  pending.value = null
  try {
    await doRestForTheNight()
  } finally {
    done?.()
  }
}

function cancelled() {
  const done = pending.value
  pending.value = null
  done?.()
}
</script>

<template>
  <div data-component="RestForTheNight">
    <SheetSection section="rest" :title="$t('rest.title')" class="break-inside-avoid-column pt-4">
      <p class="pt-1 pb-2 text-sm italic opacity-80">{{ $t('rest.blurb') }}</p>
      <Button
        ref="button"
        class="w-full"
        color="violet"
        :label="$t('rest.button')"
        :disabled="!isListening"
        :clicked="ask"
      />
      <!-- Disabled and explained rather than hidden, as the side menu's roll
           builders are: the tab is where a player looks to find out what the
           app can do, and a button that vanishes overnight teaches nothing. -->
      <div v-if="!isListening" class="pt-2 text-sm text-amber-700 italic">
        {{ $t('rest.needsGm') }}
      </div>
    </SheetSection>
    <ConfirmDialog
      ref="confirmDialog"
      :title="$t('rest.title')"
      :message="$t('rest.confirm')"
      :confirmLabel="$t('rest.button')"
      :cancelLabel="$t('common.cancel')"
      @confirm="confirmed"
      @cancel="cancelled"
    />
  </div>
</template>
