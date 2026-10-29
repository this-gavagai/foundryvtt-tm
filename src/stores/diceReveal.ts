import { computed, ref, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { DICE_REVEAL_MAX_MS } from '@/api/protocol'

// The longest a card is held, whatever the module says or fails to say — the
// elected GM's client went away mid-throw, or the release was lost.
const HOLD_CEILING_MS = DICE_REVEAL_MAX_MS

// How long a release that arrived ahead of its card is remembered. The card is
// on the wire first in practice, so this only has to cover reordering.
const EARLY_RELEASE_TTL_MS = 30_000

// Roll cards held out of the chat log until their dice have landed on the
// table's screen.
//
// Dice So Nice hides a new roll card on every Foundry screen until its 3D dice
// settle. The app hears about the card the moment it is created, so without
// this it would show the result while the table is still watching the throw.
// The module's elected GM client says when its own DSN has revealed each card
// (TM.DICE_REVEALED; see foundry/diceReveal.ts), and the requesting app is also
// told on its ack — which is how a roll made with physical dice shows at once
// for its roller.
//
// Only held while the module advertises CAPABILITY_DICE_REVEAL and is listening:
// with nobody to release a card, holding it would only delay it.
export const useDiceRevealStore = defineStore('diceReveal', () => {
  const { isListening } = storeToRefs(useListenersStore())
  const { supportsDiceReveal } = storeToRefs(useVersionCompatStore())

  // Whether new roll cards are being held right now.
  const active = computed(() => isListening.value && supportsDiceReveal.value)

  const held = ref(new Set<string>())
  const ceilings = new Map<string, ReturnType<typeof setTimeout>>()
  const earlyReleases = new Map<string, number>()

  // A new roll card has arrived.
  function hold(messageId: string): void {
    if (!active.value || held.value.has(messageId)) return
    if (earlyReleases.delete(messageId)) return
    held.value.add(messageId)
    ceilings.set(
      messageId,
      setTimeout(() => release(messageId), HOLD_CEILING_MS)
    )
  }

  // Its dice have landed (or its roller already knows the result).
  function release(messageId: string): void {
    if (held.value.delete(messageId)) {
      clearTimeout(ceilings.get(messageId))
      ceilings.delete(messageId)
      return
    }
    const now = Date.now()
    earlyReleases.forEach((at, id) => {
      if (now - at > EARLY_RELEASE_TTL_MS) earlyReleases.delete(id)
    })
    earlyReleases.set(messageId, now)
  }

  function isHeld(messageId: string | null | undefined): boolean {
    return !!messageId && held.value.has(messageId)
  }

  function reset(): void {
    ceilings.forEach((timer) => clearTimeout(timer))
    ceilings.clear()
    earlyReleases.clear()
    held.value = new Set()
  }

  // The GM went away, or the world stopped holding cards: nobody is going to
  // release what is held, so release it now.
  watch(active, (isActive) => {
    if (!isActive) reset()
  })

  return { active, hold, release, isHeld, reset }
})
