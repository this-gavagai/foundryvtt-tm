<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useResizeObserver } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import TokenArt from '@/components/TokenArt.vue'
import { useCombatStore } from '@/stores/combat'
import { useListenersStore } from '@/stores/listenersOnline'
import { useSettingsStore } from '@/stores/settings'
import { useAsyncClick } from '@/composables/useAsyncClick'
import Spinner from '@/components/widgets/SpinnerWidget.vue'

// Encounter awareness in the header, so a player who is not looking at the
// Foundry canvas can still see the round, where they sit in the turn order, and
// whether they are up — and hand the turn on without asking the GM to click for
// them.
//
// Renders nothing outside an encounter, which is what keeps the header at its
// usual height for the rest of the session.

const combatStore = useCombatStore()
const {
  activeCombat,
  round,
  started,
  turnIndex,
  turnOrder,
  currentCombatant,
  isMyTurn,
  canEndTurn
} = storeToRefs(combatStore)
const { isListening } = storeToRefs(useListenersStore())
// Opt-in per device (Settings → "Show encounter turn bar"). Off by default: this
// is the only header chrome that grows the header, and a table that runs combat
// on the canvas doesn't need it.
const { showTurnBar } = storeToRefs(useSettingsStore())

// The encounter exists but nobody is up yet: the GM has added combatants and is
// still rolling initiative ("Begin Encounter" not pressed). Worth saying — the
// alternative is a bar showing "Round 0" and no current turn.
const notStarted = computed(() => !started.value)

// Ending a turn needs a GM client to run the update, the same as every roll
// button in the app (see CombatInitiative).
const endTurnDisabled = computed(() => !canEndTurn.value || !isListening.value)

// A refused End Turn has to SAY something. The module legitimately declines
// this request — the turn moved on while the tap was queued, the encounter was
// ended, someone else is up — and the only feedback used to be the shared
// widget seam's red border for 1.2s, on fixed chrome, which is indistinguishable
// from the button doing nothing at all. The reason lands in the console via
// useAsyncClick; this puts the fact on screen, where the player is looking.
const FAILURE_VISIBLE_MS = 5_000
const { t } = useI18n()
const failure = ref('')
let failureTimer: ReturnType<typeof setTimeout> | undefined

function reportFailure() {
  failure.value = t('combat.endTurnFailed')
  clearTimeout(failureTimer)
  failureTimer = setTimeout(() => (failure.value = ''), FAILURE_VISIBLE_MS)
}

onScopeDispose(() => clearTimeout(failureTimer))

async function requestEndTurn() {
  failure.value = ''
  clearTimeout(failureTimer)
  try {
    await combatStore.endTurn()
  } catch (error) {
    reportFailure()
    // Rethrown so the button still flashes and the cause still reaches the log.
    throw error
  }
}

const { waiting, failed, handleClick, handlePointerDown } = useAsyncClick(
  requestEndTurn,
  () => endTurnDisabled.value
)

// The End Turn button floats over the right end of the strip, so the last few
// chips sit under it. Reserve that much scrollable room at the END of the strip
// and they can be scrolled clear of it.
//
// Padding rather than a spacer element: it extends the scrollable area without
// adding a child that TransitionGroup would animate and that `role="list"`
// would have to explain. And padding on the END side leaves where the chips
// START alone, so the queue still does not reflow when the button appears —
// which was the point of floating it in the first place.
//
// Measured, not a constant: the label is translated ("Zug beenden",
// "Закончить ход") and sized in rem, so its width is a runtime fact. A
// hard-coded inset would strand the last chip under a longer label.
const END_TURN_CLEARANCE_PX = 8
const endTurnRef = ref<HTMLElement | null>(null)
const endTurnWidth = ref(0)
useResizeObserver(endTurnRef, ([entry]) => {
  endTurnWidth.value = (entry?.target as HTMLElement | undefined)?.offsetWidth ?? 0
})
const orderStyle = computed(() =>
  canEndTurn.value ? { paddingRight: `${endTurnWidth.value + END_TURN_CLEARANCE_PX}px` } : undefined
)

// Rotation puts whoever is up at the left edge, which is only useful if the
// strip is actually looking at its left edge. Someone who scrolled the queue to
// peek at the back would otherwise stay there while the turn moved on, watching
// the wrong end of the encounter. Reset on a turn change only — never mid-read.
const orderRef = ref<{ $el?: HTMLElement } | null>(null)
watch([round, turnIndex], () => {
  // Guarded: scrollTo is absent in jsdom and on older WebViews, where landing
  // at the left edge is simply what the next render does anyway.
  orderRef.value?.$el?.scrollTo?.({ left: 0, behavior: 'smooth' })
})
</script>

<template>
  <div
    v-if="showTurnBar && activeCombat"
    data-component="CombatTurnBar"
    :data-status="isMyTurn ? 'my-turn' : 'waiting'"
    class="border-divider relative flex items-center gap-3 border-t px-4 py-2"
    :class="isMyTurn ? 'bg-amber-400/25' : ''"
  >
    <div data-part="round" class="flex w-10 flex-none flex-col items-center leading-none">
      <span class="text-[0.6rem] uppercase opacity-70">{{ $t('combat.round') }}</span>
      <span class="text-lg font-semibold">{{ notStarted ? '–' : round }}</span>
    </div>

    <div data-part="turn" class="flex min-w-0 flex-1 flex-col gap-0.5">
      <!-- Always rendered, in every state. A line that comes and goes changes
           the bar's height, and the bar is sticky chrome — so the sheet under it
           would jump 15px each time the turn passed to or from this player.
           Occupying the slot unconditionally is what keeps it still.
           
           Just the name, with no "up next" framing: the strip beside it already
           shows position, so the only thing the words add is whose turn it is.
           Bold, the same as "Your turn", so moving between characters is a text
           swap rather than a restyle. -->
      <div data-part="status" class="truncate text-[0.7rem] uppercase">
        <span v-if="failure" data-part="failure" class="font-semibold text-red-600">{{
          failure
        }}</span>
        <span v-else-if="notStarted" class="opacity-70">{{ $t('combat.notStarted') }}</span>
        <span v-else-if="isMyTurn" class="font-bold">{{ $t('combat.yourTurn') }}</span>
        <!-- The fallback covers two cases at once: a combatant this user is not
             allowed to see, and a `turn` index pointing past the end of the
             order. Both must still render something, or the row collapses and
             takes the bar's height with it. -->
        <span v-else class="font-bold">{{
          currentCombatant?.name || $t('combat.hiddenCombatant')
        }}</span>
      </div>

      <!-- The turn order: scrollable, because a twelve-combatant encounter must
           not push the sheet down or run off the edge unreachably.
           
           Scrolling and un-clipped chips look like a contradiction — CSS forces
           `overflow-y` to clip as soon as `overflow-x` scrolls, so there is no
           "scroll sideways, overflow visible" — but overflow clips at the
           PADDING box, not the content box. So the room the chips need is bought
           with padding rather than by disabling the clip: every part a chip
           draws outside its 32px box (the current-turn ring, the initiative
           badge) reaches 2px, and p-1 leaves 4px on every side. That is what was
           actually wrong before — the inset was 2px, exactly the overhang, so
           subpixel rounding shaved the edges.
           
           The y axis is named explicitly: `overflow-x: auto` on its own coerces
           `overflow-y` from visible to auto, which handed the strip a vertical
           scroll axis it has no use for. `hidden` keeps the horizontal scroll
           and forbids the vertical one, and a non-scrollable axis lets a
           vertical swipe fall through to the sheet behind.

           A chip mid-flight in the rotation below is clipped, and should be: it
           travels to the far end of the queue, so past the edge is exactly where
           it is going.

           TransitionGroup animates the rotation. Each combatant keeps a stable
           key, so on a turn change Vue FLIPs every chip from where it was to
           where it now is: the queue slides left as the turn advances and right
           as it rewinds, and the combatant who just acted travels to the back of
           the line rather than teleporting there. Direction needs no code — it
           falls out of the before/after positions, which is also why a rewind
           animates correctly without a special case. -->
      <TransitionGroup
        ref="orderRef"
        tag="div"
        data-part="order"
        class="no-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain p-1"
        :style="orderStyle"
        role="list"
        :aria-label="$t('combat.turnOrder')"
        move-class="transition-transform duration-300 ease-out motion-reduce:transition-none"
      >
        <!-- One keyed element per combatant, so the round divider rides along
             inside the chip that starts the next round instead of being a
             sibling. A bare `template v-for` emitting two elements would leave
             the divider unkeyed, and TransitionGroup needs a key on every child
             to track what moved where. -->
        <div
          v-for="entry in turnOrder"
          :key="entry.id"
          role="listitem"
          class="flex flex-none items-center gap-1"
        >
          <!-- Where this round ends. The strip is rotated so the acting
               combatant is leftmost, which puts the top of the initiative order
               mid-strip; without a mark there is nothing to say that everything
               past it happens next round. aria-hidden because the screen-reader
               equivalent is the sr-only label on the chip beside it. -->
          <div
            v-if="entry.startsNewRound"
            data-part="round-break"
            class="mx-1 w-px flex-none self-stretch bg-current opacity-25"
            aria-hidden="true"
          ></div>
          <div
            data-part="combatant"
            :data-current="entry.isCurrent ? '' : undefined"
            :title="entry.name"
            class="relative h-8 w-8 flex-none rounded-full transition-opacity"
            :class="[
              entry.isCurrent ? 'ring-2 ring-amber-500' : 'opacity-70',
              entry.defeated ? 'opacity-30 grayscale' : ''
            ]"
          >
            <span v-if="entry.startsNewRound" class="sr-only">{{ $t('combat.nextRound') }}</span>
            <!-- Clipped to the circle ONLY when this token draws no ring.
                 That is tokenPortrait's contract, and TokenArt already sets
                 `overflow-visible` on itself for a ring token: ring art is
                 authored oversized with transparent padding, so the ring's
                 outline — not a clip — is its boundary, and it is meant to
                 spill past the chip into the gutter. Clipping it anyway (which
                 an unconditional overflow-hidden here did) shaved the subject.

                 Plain art keeps the clip, because for art with no ring the clip
                 is also what makes the avatar round; dropping it would turn
                 every ringless token into a square. -->
            <TokenArt
              v-if="entry.portraitUrl"
              :url="entry.portraitUrl"
              :scaleX="entry.portraitScaleX"
              :scaleY="entry.portraitScaleY"
              :ring="entry.portraitRing"
              :px="32"
              objectFit="cover"
              :alt="entry.name"
              :class="entry.portraitRing ? '' : 'overflow-hidden rounded-full'"
            />
            <div v-else class="h-full w-full rounded-full bg-gray-400/40" aria-hidden="true"></div>
            <!-- Initiative, or a dash for a combatant who hasn't rolled. Small
               enough to read as a badge; it is the number players actually call
               out to each other. -->
            <span
              data-part="initiative"
              class="absolute -right-0.5 -bottom-0.5 min-w-4 rounded-full bg-black/75 px-0.5 text-center text-[0.6rem] leading-tight font-semibold text-white"
            >
              {{ entry.initiative ?? '–' }}
            </span>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <!-- Hidden rather than disabled when the turn isn't yours: a permanently
         greyed button on fixed chrome is just noise, and canEndTurn already
         answers "may this user end this turn at all". Disabled (not hidden) is
         reserved for the case where it IS your turn but no GM client is online
         to run the update, which is temporary and worth showing.
         
         Positioned OVER the row rather than beside it. As a flex item it took
         width the moment it appeared, which narrowed the token strip and moved
         every chip in it — so the queue visibly reflowed at the exact moment the
         player's attention was on it. Out of flow, the strip keeps one width for
         the whole encounter and the tail of a long queue simply scrolls beneath
         the button. The shadow is what says "on top" rather than "collided
         with". -->
    <button
      v-if="canEndTurn"
      ref="endTurnRef"
      type="button"
      data-part="end-turn"
      :disabled="endTurnDisabled"
      class="absolute top-1/2 right-4 z-10 min-h-10 -translate-y-1/2 cursor-pointer rounded-md border px-3 text-[0.7rem] font-semibold uppercase shadow-md transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      :class="[
        failed ? 'border-red-500' : 'border-transparent',
        isMyTurn ? 'bg-amber-600 text-white' : 'bg-gray-500 text-white'
      ]"
      @click="handleClick"
      @pointerdown="handlePointerDown"
    >
      <span :class="{ invisible: waiting }">{{ $t('combat.endTurn') }}</span>
      <span v-if="waiting" class="absolute inset-0 flex items-center justify-center">
        <Spinner class="h-5" />
      </span>
    </button>
  </div>
</template>
