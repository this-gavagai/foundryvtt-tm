import { ref } from 'vue'
import type { SkillActionRegistry } from '@/types/character-types'
import { defineStore } from 'pinia'
import { debounce } from 'lodash-es'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import {
  catalogsFromPayload,
  coerceLabelCatalogs,
  emptyLabelCatalogs,
  loadLabelCatalogs,
  mergeLabelCatalogs,
  saveLabelCatalogs,
  type LabelCatalogs
} from '@/utils/labelCache'
import { getLabelCatalogs } from '@/api/actionRpc'
import { expectedLabelStamp, readPublishedCatalogs, type StampSource } from '@/utils/labelStamp'
import { useWorldStore } from '@/stores/world'
import { useServerAddressStore } from '@/stores/serverAddress'
import { logger } from '@/utils/utilities'

// The connected world's display labels, held once for every sheet.
//
// The sheet reads every label from here rather than off the actor, which is what
// makes a label independent of whether any particular actor has been serialized.
// A sheet rendering from the world dump alone — no GM has ever answered for that
// character — still shows real trait, proficiency, IWR and language names.
//
// The catalog is fetched at most once per stamp. After that first fetch the
// world can go GM-less indefinitely and nothing here degrades.
const PERSIST_DEBOUNCE_MS = 1000

export const useLabelCatalogsStore = defineStore('labelCatalogs', () => {
  const catalogs = ref<LabelCatalogs>(emptyLabelCatalogs())

  // The world-static half of every skill action, keyed by slug. Same stamp and
  // same lifetime as the catalogs; kept beside them because they are flat
  // string maps and this is structured.
  const skillActions = ref<SkillActionRegistry>({})

  // The stamp `catalogs` was built for — system version, world locale and module
  // version, as the module announces it. Undefined means "never fetched", which
  // is also what reset() returns to.
  const stamp = ref<string | undefined>(undefined)

  // The origin `catalogs` currently holds, so hydrate() is idempotent per server
  // and a switch re-reads rather than serving the previous world's labels.
  const hydratedOrigin = ref<string | undefined>(undefined)

  // One fetch at a time. Every listener announcement carries the stamp, and they
  // arrive on a 30s heartbeat from every GM at the table, so without this a slow
  // first answer would be raced by a second and third request for the same data.
  let inFlight: Promise<void> | null = null

  // Trailing-edge, so a burst of merges collapses into one write. Captures the
  // origin at queue time for the same reason the actor snapshot debouncer does:
  // a server switch inside the window must not file this world's labels under
  // the next one.
  const persist = debounce((next: LabelCatalogs, forStamp: string | undefined, origin: string) => {
    void saveLabelCatalogs(
      { stamp: forStamp, catalogs: next, skillActions: skillActions.value },
      origin
    )
  }, PERSIST_DEBOUNCE_MS)

  // Load this server's row from disk. Safe to call repeatedly — it returns
  // immediately once the active origin is already loaded.
  //
  // Whatever has been merged in memory since the app started WINS over the
  // stored row: a payload or a fetch that landed before the read completed is
  // fresher than anything on disk, so the disk row goes underneath it.
  async function hydrate(): Promise<void> {
    const origin = useServerAddressStore().serverUrl?.origin
    if (!origin || hydratedOrigin.value === origin) return
    const stored = await loadLabelCatalogs(origin)
    // Re-read the origin after the await: a switch during the read makes this
    // result the previous world's, and applying it would be exactly the bug
    // hydratedOrigin exists to prevent.
    if (useServerAddressStore().serverUrl?.origin !== origin) return
    hydratedOrigin.value = origin
    if (!stored) return
    catalogs.value = mergeLabelCatalogs(stored.catalogs, catalogs.value)
    // Memory wins, as with the catalogs: a fetch that landed during the read is
    // fresher than the row.
    if (!Object.keys(skillActions.value).length && stored.skillActions) {
      skillActions.value = stored.skillActions
    }
    stamp.value ??= stored.stamp
  }

  // Ask for the catalog on the strength of the world handshake alone, without
  // waiting for a module to announce a stamp.
  //
  // The announcement path below is the authority and stays exactly as it was.
  // This exists because that path needs a GM's client to be open, and until one
  // is the app cannot tell whether the catalog it cached last session is still
  // current — a system upgrade between sessions serves last version's labels,
  // silently. The handshake carries the same three components the module
  // stamps, so the app can work out for itself that it should ask.
  //
  // Whatever comes back overwrites `stamp` with the ANSWERING client's stamp,
  // never with this guess (see utils/labelStamp.ts), so a guess that is subtly
  // wrong costs a redundant fetch and can never mislabel a sheet.
  async function ensureFromWorld(): Promise<void> {
    const world = useWorldStore().world as StampSource | undefined
    const expected = expectedLabelStamp(world)
    if (!expected) return

    // The world may be carrying the catalog itself: a GM's client publishes it
    // into a world setting, and world settings arrive in the same handshake this
    // stamp came from. When one is there and current, the app is done — no
    // request, no client online, nothing to wait for.
    //
    // The stamp check is what makes adopting it safe, and it is the PUBLISHER'S
    // stamp that gets stored, not the app's guess. So this keeps the invariant
    // the guess was built around: what the app records is always a real client's
    // account of its own CONFIG and i18n. Here that client simply wrote it down
    // last session instead of answering just now.
    const published = readPublishedCatalogs(world)
    if (published && published.stamp === expected) {
      if (stamp.value === expected) return
      const origin = useServerAddressStore().serverUrl?.origin
      if (!origin) return
      await hydrate()
      if (useServerAddressStore().serverUrl?.origin !== origin) return
      // Re-checked after the await: a fetch or an announcement could have
      // landed the same catalog while the disk read was in flight.
      if (stamp.value === expected) return
      catalogs.value = coerceLabelCatalogs(published.catalogs)
      stamp.value = published.stamp
      hydratedOrigin.value = origin
      persist(catalogs.value, published.stamp, origin)
      return
    }

    // Nothing published, or published under a stamp this world has moved past —
    // a system upgrade since the last GM logged in. Ask a live client, which now
    // means any client running the module rather than a GM specifically.
    await ensureCatalog(expected)
  }

  // Make sure the catalog matches what the world is announcing, fetching it if
  // not. Called on every module announcement; the common case is that the stamp
  // matches and this does nothing at all.
  //
  // A mismatch means the system version, the world locale or the module moved,
  // so everything gathered under the old stamp is stale — including the
  // per-actor rule labels accumulated from payloads. The catalog is therefore
  // REPLACED rather than merged; the rule labels re-accumulate on the next
  // refresh of each open sheet.
  async function ensureCatalog(announced: string | undefined): Promise<void> {
    // A module too old to announce a stamp has no catalog to serve either.
    // Whatever is cached stays: stale wording beats raw slugs.
    if (!announced) return
    // Pinned BEFORE the first await, not after: this call belongs to the world
    // that announced `announced`, and a switch during the disk read must make
    // the whole operation a no-op rather than silently re-target it at whatever
    // server is active by the time the fetch returns.
    const origin = useServerAddressStore().serverUrl?.origin
    if (!origin) return
    await hydrate()
    if (useServerAddressStore().serverUrl?.origin !== origin) return
    if (stamp.value === announced) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const response = await getLabelCatalogs()
        if (useServerAddressStore().serverUrl?.origin !== origin) return
        catalogs.value = response.catalogs
        // Absent from a module predating the split — leave whatever is held
        // rather than blanking it, since the payload's own copy is the
        // fallback in that case.
        if (response.skillActions) skillActions.value = response.skillActions
        stamp.value = response.stamp
        hydratedOrigin.value = origin
        persist(response.catalogs, response.stamp, origin)
      } catch (error) {
        // Not fatal and not worth retrying here: the next announcement — 30s
        // away — calls this again, and until then the sheet shows whatever it
        // already had. Slugs are ugly, not broken.
        logger.debug('TM: label catalog fetch failed', error)
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  // Fold one character payload's RollOption rule labels in. Called for every
  // UPDATE_CHARACTER, so the common case is "contributes nothing new" —
  // mergeLabelCatalogs returns the same reference then, and this becomes a no-op
  // rather than invalidating every computed that reads a label.
  function remember(args: UpdateCharacterDetailsArgs): void {
    const origin = useServerAddressStore().serverUrl?.origin
    if (!origin) return
    const next = mergeLabelCatalogs(catalogs.value, catalogsFromPayload(args))
    if (next === catalogs.value) return
    catalogs.value = next
    // Deliberately NOT marking the origin hydrated. A payload is fresher than
    // the disk row but not a SUPERSET of it — it carries one actor's rule labels
    // against a catalog covering the whole world. Claiming hydration here would
    // skip the read and lose everything this actor does not mention. Freshness
    // is handled by the merge order in hydrate(): stored underneath, memory on
    // top.
    persist(next, stamp.value, origin)
  }

  // Labels belong to one world's locale, system version and item names. Carried
  // across a server or user switch they would put the previous world's names on
  // this one's sheets — the same reason the rest of resetWorldScopedStores
  // exists. The pending write is cancelled rather than flushed: its origin is
  // captured, so it is not wrong, but there is nothing left to save that the
  // next announcement will not re-establish.
  function reset() {
    persist.cancel()
    inFlight = null
    catalogs.value = emptyLabelCatalogs()
    skillActions.value = {}
    stamp.value = undefined
    hydratedOrigin.value = undefined
  }

  return { catalogs, skillActions, stamp, hydrate, ensureCatalog, ensureFromWorld, remember, reset }
})
