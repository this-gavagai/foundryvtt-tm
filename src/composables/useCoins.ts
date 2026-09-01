import { computed, ref, watch, type Ref } from 'vue'
import { modifyDocument, processChanges } from '@/api/documents'
import { asDocumentArray } from '@/api/internal'
import { fireRefresh } from '@/api/characterSync'
import { getCompendiumSource } from '@/api/compendium'
import { logger } from '@/utils/utilities'
import {
  COIN_DENOMINATIONS,
  COIN_UUIDS,
  coinCounts,
  coinStacks,
  copperValue,
  fallbackCoinSource,
  type CoinCounts,
  type CoinStack,
  type Denomination
} from '@/utils/coins'

// How long a written count keeps standing in for the stored one before the
// panel gives up waiting and shows whatever the actor actually holds. Only
// reached when a write is lost outright — the usual settle is one round trip.
const SETTLE_TIMEOUT_MS = 15_000

// One actor's purse: the four coin counts, and the single write that moves them.
//
// Every edit arrives here as a set of deltas rather than as a target quantity,
// because that's what the interface produces — a player holds "+10 gp" down for
// a moment and releases with one intent, not with thirty. Applying the batch
// costs at most four writes no matter how the deltas were arrived at, and it
// keeps a transfer symmetrical: the same deltas, negated, are the other purse's
// write.
//
// Three cases per denomination, mirroring what PF2e's own
// ActorInventory#addCurrency / #removeCurrency do:
//   - a stack exists and survives  → bump its quantity
//   - a stack exists and hits zero → delete it (PF2e leaves no empty coin piles)
//   - no stack and coins are added → create one from PF2e's own coin item
export function useCoins(opts: {
  actorId: Ref<string | null | undefined>
  actor: Ref<{ items?: unknown } | undefined>
  inventory: Ref<CoinStack[] | undefined>
}) {
  const stored = computed<CoinCounts>(() => coinCounts(opts.inventory.value))

  // Counts already written and waiting for the actor snapshot to agree. None of
  // the document writes below land locally before their socket ack — a create
  // and a delete are only echoed in the ack callback, and even the quantity
  // bump that does write through is discarded the moment a refresh replaces the
  // snapshot it was made on. That is worst on the party stash, which is
  // re-fetched wholesale, and it showed as the count snapping back to its old
  // value for a beat after Apply. So the count the panel writes is the count it
  // shows, until the stored data catches up with it.
  const targets = ref<Partial<Record<Denomination, number>>>({})
  const timers = new Map<Denomination, ReturnType<typeof setTimeout>>()

  const counts = computed<CoinCounts>(() => {
    const merged = { ...stored.value }
    for (const denomination of COIN_DENOMINATIONS) {
      const target = targets.value[denomination]
      if (target !== undefined) merged[denomination] = target
    }
    return merged
  })
  const totalCopper = computed(() => copperValue(counts.value))

  function clearTarget(denomination: Denomination) {
    const timer = timers.get(denomination)
    if (timer) clearTimeout(timer)
    timers.delete(denomination)
    if (targets.value[denomination] === undefined) return
    const next = { ...targets.value }
    delete next[denomination]
    targets.value = next
  }

  function setTarget(denomination: Denomination, value: number) {
    const timer = timers.get(denomination)
    if (timer) clearTimeout(timer)
    timers.set(
      denomination,
      setTimeout(() => clearTarget(denomination), SETTLE_TIMEOUT_MS)
    )
    targets.value = { ...targets.value, [denomination]: value }
  }

  // The moment the stored count agrees, the overlay has nothing left to say —
  // drop it so later changes from anyone else show through immediately.
  watch(stored, (now) => {
    for (const denomination of COIN_DENOMINATIONS) {
      if (targets.value[denomination] === now[denomination]) clearTarget(denomination)
    }
  })

  // PF2e's coin items never change, so a resolved source is worth keeping for
  // the session — a purse that gains and loses its last silver piece would
  // otherwise re-fetch on every write.
  const sourceCache = new Map<Denomination, Record<string, unknown>>()

  async function coinSource(denomination: Denomination): Promise<Record<string, unknown>> {
    const cached = sourceCache.get(denomination)
    if (cached) return structuredClone(cached)
    let source: Record<string, unknown> | null = null
    try {
      source = await getCompendiumSource(COIN_UUIDS[denomination])
    } catch (err) {
      logger.warn('TM-COINS: coin item lookup failed, using a local stack', err)
    }
    // A world without pf2e's equipment compendium (or a player who can't reach
    // it) still gets a working coin stack rather than a failed write.
    if (!source) source = fallbackCoinSource(denomination, 1) as Record<string, unknown>
    sourceCache.set(denomination, source)
    return structuredClone(source)
  }

  async function createStack(denomination: Denomination, quantity: number) {
    const parent = opts.actorId.value
    if (!parent) return
    const source = await coinSource(denomination)
    const system = (source.system ?? {}) as Record<string, unknown>
    source.system = { ...system, quantity }
    await modifyDocument(
      {
        action: 'create',
        type: 'Item',
        operation: { parentUuid: `Actor.${parent}`, data: [source] }
      },
      (response) => {
        // Foundry answers only the emitting socket with this ack (the broadcast
        // goes to other clients), so the new stack is echoed into the local
        // items array the inventory reads from — same reason usePartyTransfer
        // does it, and without it a fresh denomination stays invisible until
        // some other change forces a refresh.
        processChanges(response, asDocumentArray(opts.actor.value?.items))
        fireRefresh(parent)
      }
    )
  }

  /**
   * Apply a set of coin deltas to this purse. The new counts show at once and
   * resolve when the writes are answered; a write that fails drops its count
   * back to what the actor holds and rejects, so the caller can hand the edit
   * back to the player rather than silently losing it.
   */
  async function applyDeltas(deltas: Partial<CoinCounts>) {
    const stacks = coinStacks(opts.inventory.value)
    const writes: Promise<unknown>[] = []
    for (const denomination of COIN_DENOMINATIONS) {
      const delta = deltas[denomination] ?? 0
      if (!delta) continue
      const stack = stacks[denomination]
      // Counted from what the panel is showing, not from the stored stack: an
      // edit made while an earlier one is still in flight has to build on the
      // number the player can see.
      const next = Math.max(0, counts.value[denomination] + delta)

      let write: Promise<unknown> | undefined
      if (!stack) {
        if (next > 0) write = createStack(denomination, next)
      } else if (next === 0) {
        write = Promise.resolve(stack.delete?.())
      } else {
        write = Promise.resolve(stack.changeQty?.(next))
      }
      if (!write) continue

      setTarget(denomination, next)
      writes.push(
        write.catch((error: unknown) => {
          clearTarget(denomination)
          throw error
        })
      )
    }
    await Promise.all(writes)
  }

  return { counts, totalCopper, applyDeltas }
}
