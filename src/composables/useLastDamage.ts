import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { applyDamage } from '@/api/actionRpc'
import { useChatStore } from '@/stores/chat'
import { useListenersStore } from '@/stores/listenersOnline'
import { rollSummary } from '@/utils/chatRollSummary'
import type { TablemateActorRef } from '@/types/character-types'

// The shortcut behind the hit-point modal: take the hit you just took without
// leaving the sheet to find its card in chat. The chat roll card
// (components/ChatRollCard) is the full surface — damage, half, double, block,
// heal — and this is deliberately the one-tap subset of it, so everything it
// decides has to agree with what that card would do to the same roll.

// How far back up the log to look. The offer is "the hit you just took", so it
// has to survive a couple of lines of table chatter landing on top of the roll:
// this used to read only the single newest message, and anyone typing "ouch"
// between the GM's roll and the player's tap made the button disappear. It must
// not reach back to the previous session's combat either, so the window is
// short rather than a full scan.
const LOOKBACK_MESSAGES = 20

export interface LastDamageOffer {
  messageId: string
  // The rolled total, which is what the button is labelled with. NOT what the
  // actor will lose: applying it runs PF2e's IWR pass on the GM's client, so a
  // resistance or weakness moves the real number. That gap is the reason there
  // is no "+N to undo it" counterpart any more — it healed the pre-IWR total
  // and quietly over-healed by exactly the resistance. The field beside these
  // buttons is the exact-number path, and it still works with no GM at all.
  total: number
  // PF2e healing is a DamageRoll too — a Heal spell's roll carries
  // `kinds: ["healing"]` and is otherwise the same class — so this has to be
  // asked rather than assumed. Applied with mode 'damage' a heal lands as
  // damage: applyIWR reads its positive total and takes the hit points off.
  isHealing: boolean
}

// `actor` is the actor the damage would be applied TO — the sheet's own, not
// the roll's speaker (the message is the damage SOURCE; see the note in
// foundry/handlers/applyDamage).
export function useLastDamage(actor: TablemateActorRef) {
  const chatStore = useChatStore()
  const { visibleMessages } = storeToRefs(chatStore)
  const listeners = useListenersStore()

  const offer = computed<LastDamageOffer | undefined>(() => {
    const messages = visibleMessages.value
    const floor = Math.max(0, messages.length - LOOKBACK_MESSAGES)
    for (let i = messages.length - 1; i >= floor; i--) {
      const message = messages[i]
      if (!message._id) continue
      // Index 0 to match what applying it passes as `rollIndex` — one roll, one
      // decision, so the label can never describe a different roll from the one
      // the tap resolves.
      const roll = rollSummary(message.rolls?.[0])
      if (roll?.className !== 'DamageRoll' || roll.total === undefined) continue

      // Damage this client ROLLED is damage it dealt, and offering to apply a
      // greataxe crit to the person who swung it is a destructive tap that
      // cannot be undone from here. Stop rather than keep searching: an older
      // roll further up the log is one they have almost certainly already
      // applied, so "nothing to offer" is the honest answer.
      //
      // Healing is exempt — rolling your own heal and drinking it is the normal
      // case, and it is the direction that can't hurt if the guess is wrong.
      if (!roll.isHealing && chatStore.messageIsFromCurrentUser(message)) return undefined

      return { messageId: message._id, total: roll.total, isHealing: roll.isHealing }
    }
    return undefined
  })

  // Applying a card's damage is PF2e's own IWR pass on the GM's client, so
  // unlike typing a number into the field beside it (composables/setHitPoints)
  // this RPC has no direct-write half to fall back on. Withheld rather than
  // offered when nothing is listening — an ungated tap did nothing at all and
  // said nothing about it.
  const canApply = computed(() => !!offer.value && !!actor.value?._id && listeners.isListening)

  // One button, its direction chosen by the roll — the same choice
  // ChatRollCard makes when it shows Heal instead of the damage row.
  const label = computed(() =>
    offer.value ? `${offer.value.isHealing ? '+' : '-'}${Math.abs(offer.value.total)}` : ''
  )

  const color = computed(() => (offer.value?.isHealing ? 'green' : 'red'))

  // Rejects on a failed RPC so the caller's widget can flash and stay put; the
  // modal must not close over a tap that didn't land.
  async function applyLastDamage(): Promise<void> {
    const current = offer.value
    if (!current || !canApply.value) return
    await applyDamage(actor, current.messageId, current.isHealing ? 'heal' : 'damage', 0)
  }

  return { offer, canApply, label, color, applyLastDamage }
}
