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
import { sourceFromEmbedded, type StoredItem } from '@/utils/itemSource'
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
    // useCharacterItems is typed for a character because most of what it derives
    // is character-specific; only its `inventory` is read here, and that reads
    // physical items, which PF2e's party actor (where a shared stash lives) has
    // like any other.
    //
    // Through `unknown` because the comparability check a single `as` performs
    // cannot be completed: TablemateCharacter intersects TablemateActorExtras,
    // which reaches back into CharacterPF2e['inventory'], and relating that to
    // ActorPF2e exhausts TypeScript's instantiation depth (TS2589). Same limit
    // as itemsOfType in character/helpers.ts, and the same non-claim about the
    // values.
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
      // Built from the STORED document, not from `item`.
      //
      // `item` is an InventoryItem — the sheet's projection
      // (composables/character/defs/*), which keeps only the fields the sheet
      // renders. It resembles a document closely enough that cloning it used to
      // typecheck and silently drop everything else: system.rules, every flag
      // (ChoiceSet answers included), material, grade, baseItem, category,
      // group, the damage dice, and all but two fields of the `system.spell`
      // that makes a wand or scroll cast anything. Foundry then filled the gaps
      // with schema defaults, so the create succeeded and produced a plausible
      // item that had lost what mattered — a 1d8 longsword arriving as the
      // schema's default 1d6, and a martial weapon as a simple one.
      // utils/itemSource.ts refuses the projection at the type level now; this
      // reads the real thing to hand it.
      const sourceActor = targetMode === 'party' ? characterActor.value : partyActorForItems.value
      const stored = ((asDocumentArray(sourceActor?.items) ?? []) as StoredItem[]).find(
        (d) => d._id === item._id
      )
      // No stored document means the source inventory is mid-load or the item
      // has just gone. Abort rather than fall back to a lossy copy: a transfer
      // that didn't happen is recoverable, and a gutted item is not.
      if (!stored) {
        logger.warn('TM-TRANSFER: no stored document for item, refusing transfer', item._id)
        return { removed: false }
      }
      const raw = sourceFromEmbedded(stored, { quantity: 1, toActor: true })
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

  // partyActor rides along so a second view of the same stash (the coin panel)
  // can write to it without standing up another socket listener on the actor.
  return { partyActorId, partyActor: partyActorForItems, partyInventory, transferItem }
}
