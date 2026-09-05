import type { UpdateCharacterDetailsArgs, WorldLabelCatalogs } from '@/types/api-types'
import { idbGet, idbPut, idbDelete } from '@/utils/idb'
import { useServerAddressStore } from '@/stores/serverAddress'
import { logger } from '@/utils/utilities'

// The world's display labels, fetched once and kept.
//
// None of this is rules content: it is PF2e's CONFIG dictionaries and the item
// names in this world, run through Foundry's localizer because only a Foundry
// client has the system's lang files loaded. Localization, not derivation —
// which is why it can be cached at all, and why a cached label is never *wrong*
// the way a cached derived figure would be.
//
// Two sources feed it, and the split is the whole design:
//
//   * THE WORLD CATALOG (TM.GET_LABEL_CATALOGS) — traits, proficiencies, IWR
//     types, languages, statistic names. A pure function of CONFIG.PF2E and the
//     world's locale, identical for every actor, and identified by a STAMP
//     (system version | locale | module version). Asked for once per stamp, then
//     never again — so after a single successful fetch the sheet can name
//     everything it renders with no GM online, indefinitely.
//
//   * PER-ACTOR RULE LABELS (on the character payload) — the i18n keys one
//     actor's RollOption rules declare. Arbitrary strings chosen by whatever
//     item declares them, so they cannot be enumerated from CONFIG and cannot
//     ride the world catalog. Small, and merged into the same maps.
//
// A stamp change means the locale or the system moved, so everything gathered
// under the old stamp is stale: the catalog is REPLACED rather than merged, and
// the per-actor labels re-accumulate from subsequent payloads. Within one stamp
// the merge is a union, so what the store holds only ever grows.

export type LabelCatalogs = WorldLabelCatalogs

export function emptyLabelCatalogs(): LabelCatalogs {
  return { traits: {}, proficiencies: {}, rollOptions: {}, iwr: {}, languages: {}, frequencies: {} }
}

// What one character payload contributes: its RollOption rule labels, and
// nothing else. Everything else the payload used to carry is world-scoped and
// arrives through the catalog instead.
export function catalogsFromPayload(args: UpdateCharacterDetailsArgs): LabelCatalogs {
  return { ...emptyLabelCatalogs(), rollOptions: args.rollOptionLabels ?? {} }
}

// Union `incoming` into `base`, incoming winning on conflict.
//
// Returns `base` ITSELF — same reference — when incoming contributes nothing
// new, and a fresh object otherwise. That identity is the store's change
// detection: every character refresh re-sends the same rule labels, so without
// it each refresh would invalidate every computed reading a label and queue a
// database write that changes nothing.
export function mergeLabelCatalogs(base: LabelCatalogs, incoming: LabelCatalogs): LabelCatalogs {
  const adds = (a: Record<string, string>, b: Record<string, string>) =>
    Object.entries(b).some(([key, value]) => a[key] !== value)

  const names = Object.keys(base) as (keyof LabelCatalogs)[]
  if (!names.some((name) => adds(base[name], incoming[name]))) return base

  const next = emptyLabelCatalogs()
  for (const name of names) next[name] = { ...base[name], ...incoming[name] }
  return next
}

// What goes on disk: the catalogs plus the stamp they were built for, so a row
// read back can be checked against what the world currently announces rather
// than trusted blindly.
export interface StoredLabelCatalogs {
  stamp?: string
  catalogs: LabelCatalogs
}

// Persisted under the bare server origin — one row per server, unlike the actor
// and chat caches which hold many rows and so key as `${origin}|${id}`. Deleting
// therefore takes idbDelete rather than a prefix sweep; see the note there for
// why a prefix would be wrong for an undelimited key.
function keyFor(origin = useServerAddressStore().serverUrl?.origin): string | undefined {
  return origin || undefined
}

// Reject anything that is not the shape we wrote — a hand-edited database, or a
// row from a future build with a different layout. Missing catalogs fill in
// empty, so adding a sixth catalog later reads old rows without a migration.
function coerce(stored: unknown): StoredLabelCatalogs | undefined {
  if (!stored || typeof stored !== 'object') return undefined
  const row = stored as { stamp?: unknown; catalogs?: unknown }
  const raw = (row.catalogs ?? {}) as Partial<Record<keyof LabelCatalogs, unknown>>
  const pick = (key: keyof LabelCatalogs): Record<string, string> => {
    const map = raw[key]
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {}
    return Object.fromEntries(
      Object.entries(map as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  }
  // Driven by the key list rather than spelled out, so a catalog added later is
  // picked up here without a second edit — and an old row missing it reads as
  // empty rather than failing to coerce.
  const catalogs = emptyLabelCatalogs()
  for (const name of Object.keys(catalogs) as (keyof LabelCatalogs)[]) catalogs[name] = pick(name)
  return { stamp: typeof row.stamp === 'string' ? row.stamp : undefined, catalogs }
}

export async function loadLabelCatalogs(origin?: string): Promise<StoredLabelCatalogs | undefined> {
  const key = keyFor(origin)
  if (!key) return undefined
  return coerce(await idbGet<unknown>('labels', key))
}

export async function saveLabelCatalogs(row: StoredLabelCatalogs, origin?: string): Promise<void> {
  const key = keyFor(origin)
  if (!key) return
  logger.debug('labelCache: persisting catalogs for', key)
  return idbPut('labels', key, row)
}

// Drop a server's catalog. Called from clearCachedCharacterData, alongside the
// actor snapshots and chat tail: a label map is the world's item names, so it is
// the previous user's data in exactly the way a cached sheet is.
export function clearLabelCatalogsForServer(origin: string): Promise<void> {
  return idbDelete('labels', origin)
}
