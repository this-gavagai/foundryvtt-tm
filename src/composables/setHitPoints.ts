import type { TablemateActorRef } from '@/types/character-types'
import { setHitPoints as setHitPointsRpc } from '@/api/actionRpc'
import { updateActor } from '@/api/documents'
import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { logger } from '@/utils/utilities'

export interface HitPointTarget {
  /** Absolute hit points to end up at. Omit to leave hit points alone. */
  value?: number
  /** Absolute temporary hit points. Omit to leave them alone. */
  temp?: number
}

// Local optimistic write, so the sheet moves on tap rather than after a
// round-trip. The GM can still land elsewhere (PF2e clamps at 0 and at max, and
// module automation may react), but the resulting modifyDocument broadcast
// reconciles the sheet a moment later — serverEventWiring's Actor branch.
function writeLocally(actor: TablemateActorRef, target: HitPointTarget) {
  const hp = actor.value?.system?.attributes?.hp
  if (!hp) return
  if (typeof target.value === 'number') hp.value = target.value
  if (typeof target.temp === 'number') hp.temp = target.temp
}

// The one place hit points are written, shared by the character, NPC and
// familiar models (they all expose it through the Actor interface's `hp`).
//
// Unlike every other actor field, this does NOT go straight at the server. The
// write itself is the same plain field write PF2e's own sheet performs — what
// matters is WHERE it runs. Foundry runs `Actor#_preUpdate` / the
// `preUpdateActor` hook only on the client that calls `actor.update()`, and a
// raw modifyDocument emit calls it on none — so the module automation that
// reacts to HP (Workbench's auto-Dying, and its auto-removal of
// Dying/Unconscious on healing) never fired for an edit made from the app.
// Handing the change to the GM's client puts it back on the normal document
// lifecycle.
//
// With no GM listening there is no client to run any of that, so fall back to
// the direct write: an HP edit that lands without automation still beats one
// that can't be made at all, which is the property the direct path exists for.
export function setHitPoints(actor: TablemateActorRef, target: HitPointTarget) {
  if (target.value === undefined && target.temp === undefined) return Promise.resolve()
  writeLocally(actor, target)

  // Two ways there is no client to run the lifecycle on: nobody is listening, or
  // the module that is listening predates the handler (its request would go
  // unanswered and sit out the full 30s ack timeout before failing silently).
  // Both fall back to the direct write — automation-free, exactly what every HP
  // edit did before, but it lands.
  const listening = useListenersStore().isListening
  const supported = useVersionCompatStore().supportsSetHitPoints
  if (!listening || !supported) {
    logger.debug('TM-SET-HP: writing hit points directly (no automation)', {
      listening,
      supported
    })
    return updateActor(actor, { system: { attributes: { hp: target } } })
  }
  return setHitPointsRpc(actor, target)
}
