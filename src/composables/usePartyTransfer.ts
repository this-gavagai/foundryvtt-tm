import { computed, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import type { InventoryItem } from '@/composables/character'
import type { Field } from '@/composables/character/helpers'
import type { TablemateCharacter, TablemateActor } from '@/types/character-types'
import { useCharacterItems } from '@/composables/character/characterItems'
import { useWorldStore } from '@/stores/world'
import { setupSocketListenersForActor } from '@/composables/serverEventWiring'
import { sendCharacterRequest, fireRefresh } from '@/api/characterSync'
import { modifyDocument, processChanges } from '@/api/documents'
import { asDocumentArray } from '@/api/internal'
import { logger } from '@/utils/utilities'

// The party-inventory transfer protocol, lifted out of EquipmentList.vue: find
// the party actor this character belongs to, keep its inventory synced over the
// socket, and move an item between the character and the party stash. The move
// is confirmation-driven, not ack-driven — in relay (GM-listener) setups the
// originating modifyDocument emit isn't reliably acked, so a transfer is only
// finalized once the *target* inventory actually reflects the addition. That
// direct socket/document machinery is this composable's whole reason to exist;
// EquipmentList stays a view.
//
// `characterId`/`characterActor`/`individualInventory` come from the injected
// character model. Returns the party actor id (null when the character is in no
// party), the party's inventory, and transferItem().
export function usePartyTransfer(opts: {
  characterId: Field<string>
  characterActor: Ref<TablemateActor | undefined>
  individualInventory: Field<InventoryItem[]>
}) {
  const { characterId, characterActor, individualInventory } = opts
  const worldStore = useWorldStore()
  const { world } = storeToRefs(worldStore)

  // The party actor whose members include this character. Matched by scanning
  // for a 'party'-type actor listing this character in its members (not an
  // id lookup), so it stays a scan — but only over party actors, of which a
  // world has very few.
  const partyActorId = computed<string | null>(
    () =>
      world.value?.actors?.find(
        (a: ActorPF2e) =>
          a.type === 'party' &&
          !!(a.system as { details?: { members?: { uuid: string }[] } })?.details?.members?.some(
            (m) => m.uuid === `Actor.${characterId.value}`
          )
      )?._id ?? null
  )

  // Live party-actor snapshot, kept in sync over the socket for as long as a
  // party is in view. Registration is synchronous so onCleanup holds the
  // unsubscriber before a rapid party change can re-fire the watcher.
  const partyActorRef = ref<TablemateCharacter | undefined>()
  watch(
    partyActorId,
    (id, _prev, onCleanup) => {
      partyActorRef.value = undefined
      if (!id) return
      const stopListeners = setupSocketListenersForActor(id, partyActorRef, () =>
        Promise.resolve(sendCharacterRequest(id))
      )
      sendCharacterRequest(id)
      onCleanup(stopListeners)
    },
    { immediate: true }
  )

  const partyActorForItems = computed<TablemateCharacter | undefined>(() => {
    if (!partyActorId.value) return undefined
    return (
      partyActorRef.value ??
      (worldStore.actorById(partyActorId.value) as unknown as TablemateCharacter)
    )
  })

  const { inventory: partyInventory } = useCharacterItems(partyActorForItems)

  // Total quantity of items matching the given one (by name + type) across an
  // inventory. Used to confirm a transfer landed: both a fresh create and a
  // quantity bump on an existing stack raise this total by one.
  function matchingQty(inv: InventoryItem[] | undefined, item: InventoryItem) {
    return (
      inv
        ?.filter((i) => i.name === item.name && i.type === item.type)
        .reduce((sum, i) => sum + (i.system?.quantity ?? 0), 0) ?? 0
    )
  }

  // Resolve once `check()` becomes true (watching its reactive deps), or false
  // after `timeoutMs`.
  function waitForCondition(check: () => boolean, timeoutMs = 10_000): Promise<boolean> {
    if (check()) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        stop()
        resolve(false)
      }, timeoutMs)
      const stop = watch(check, (ok) => {
        if (!ok) return
        clearTimeout(timer)
        stop()
        resolve(true)
      })
    })
  }

  // Move one of `item` between the character and the party stash. Resolves with
  // `{ removed }` — true when the source copy was deleted (single-quantity
  // transfer), false when only decremented or the transfer was aborted — so the
  // caller can close the detail modal on removal. Never removes the source until
  // the target reflects the addition, so a dropped write can't vanish the item.
  async function transferItem(
    item: InventoryItem,
    targetMode: 'individual' | 'party'
  ): Promise<{ removed: boolean }> {
    if (!partyActorId.value) return { removed: false }

    const currentQty = item.system?.quantity ?? 1
    const targetActorId = targetMode === 'party' ? partyActorId.value : characterId.value
    const targetInventoryRef = targetMode === 'party' ? partyInventory : individualInventory

    const existing = targetInventoryRef.value?.find(
      (i: InventoryItem) => i.name === item.name && i.type === item.type
    )

    // Snapshot the target's matching total before the write so we can detect the
    // +1 it produces, regardless of whether it created a new stack or bumped one.
    const beforeQty = matchingQty(targetInventoryRef.value, item)

    let write: Promise<unknown>
    if (existing) {
      write = Promise.resolve(existing.changeQty?.((existing.system?.quantity ?? 0) + 1))
    } else {
      const raw = JSON.parse(JSON.stringify(item)) as Record<string, unknown>
      delete raw._id
      ;(raw.system as Record<string, unknown>).quantity = 1
      // The backpack the item was stowed in doesn't exist in the target
      // inventory, so drop the reference rather than carry a dangling containerId.
      delete (raw.system as Record<string, unknown>).containerId
      write = modifyDocument(
        {
          action: 'create',
          type: 'Item',
          operation: { parentUuid: `Actor.${targetActorId}`, data: [raw] }
        },
        (r) => {
          // Echo the created item into the local items array the target
          // inventory reads from. Foundry answers only the emitting socket via
          // this ack (the broadcast goes to *other* clients), so without the
          // echo the confirmation below would hinge on a GM-answered refresh
          // that never comes when no listener client is online.
          processChanges(
            r,
            targetMode === 'party'
              ? asDocumentArray(partyActorForItems.value?.items)
              : asDocumentArray(characterActor.value?.items)
          )
          fireRefresh(targetActorId)
        }
      )
    }

    // An explicit write failure (permission denial, socket timeout) ends the
    // transfer as soon as it's known instead of spinning out the full
    // confirmation timeout.
    const writeFailed = new Promise<false>((resolve) =>
      write.catch((err: unknown) => {
        logger.error('item transfer write failed', err)
        resolve(false)
      })
    )

    const confirmed = await Promise.race([
      waitForCondition(() => matchingQty(targetInventoryRef.value, item) >= beforeQty + 1),
      writeFailed
    ])
    if (!confirmed) return { removed: false }

    if (currentQty <= 1) {
      item.delete?.()
      return { removed: true }
    }
    item.changeQty?.(currentQty - 1)
    return { removed: false }
  }

  return { partyActorId, partyInventory, transferItem }
}
