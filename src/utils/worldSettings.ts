// Reading a world-scope Foundry setting straight out of the world payload.
//
// The app already has these. `world` is answered by the Foundry SERVER, not by
// the module on a GM client — core's unfiltered dump of every collection — and
// `settings` is one of the collections it dumps (see the note in stores/world.ts
// on why that payload is as large as it is). A world-scope setting is therefore
// readable by any connected client with no round-trip and, crucially, with no GM
// online.
//
// Why that matters: the module's three opt-in features (reactions, comments,
// roll details) are world settings that the app used to learn only from the
// LISTENER_ONLINE handshake, as advertised capabilities. That was right while
// every one of those features needed a GM to perform the write — the capability
// and the ability to act were the same fact. Now that reactions and comments are
// written directly by their author (utils/chatReactions.ts), gating the
// affordance on a handshake would hide a feature that works: a table whose GM
// has closed their laptop could react and comment perfectly well, and wouldn't
// be offered the buttons.
//
// So the SETTING is read here and the CAPABILITY is left to mean what it says —
// "a module new enough to have the handler is listening" — which the two
// features that still need the proxy continue to check.
//
// Reads fail CLOSED, matching foundry/featureToggles.ts: an absent or
// unparseable setting is off. That also handles version skew for free, since
// the setting only exists once a module that registers it has run in the world.

import { MODULE_ID } from '@/api/protocol'
import { logger } from '@/utils/utilities'

// One Setting document as core dumps it: `key` is "{scope}.{field}", `value` is
// a JSON-encoded string (Foundry's JSONField), and `user` is null for a
// world-scope setting and a user id for a client-scope one.
interface SettingDocument {
  key?: string | null
  value?: string | null
  user?: string | null
}

// Foundry hands collections over as plain arrays or as `{ contents: [...] }`
// depending on the path they took; the world dump is the former, but this is
// read from a loosely-typed payload either way.
function asArray(collection: unknown): SettingDocument[] {
  if (Array.isArray(collection)) return collection as SettingDocument[]
  if (
    collection &&
    typeof collection === 'object' &&
    Array.isArray((collection as { contents?: unknown }).contents)
  ) {
    return (collection as { contents: SettingDocument[] }).contents
  }
  return []
}

/**
 * The value of a world-scope setting, or `fallback` when it isn't there.
 *
 * `settings` is the world payload's settings collection. `key` is the full
 * "{scope}.{field}" spelling Foundry stores.
 */
export function readWorldSetting<T>(settings: unknown, key: string, fallback: T): T {
  // A world setting is stored with no `user`. Prefer that entry explicitly
  // rather than taking the first key match: the same key can also exist
  // per-user, and picking up someone else's client-scope copy would answer a
  // world question with one player's preference.
  const entries = asArray(settings).filter((setting) => setting?.key === key)
  const worldEntry = entries.find((setting) => !setting.user) ?? entries[0]
  if (!worldEntry || typeof worldEntry.value !== 'string') return fallback
  try {
    const parsed = JSON.parse(worldEntry.value) as T
    return parsed === undefined || parsed === null ? fallback : parsed
  } catch {
    // A value core wrote is always valid JSON, so this means a hand-edited
    // world or a schema that has moved. Fail closed and say so.
    logger.warn('TM-SETTINGS: could not parse world setting', key, worldEntry.value)
    return fallback
  }
}

/**
 * A boolean setting registered by this module, defaulting off.
 *
 * Read as `unknown` and compared, rather than as `boolean`: the stored value is
 * whatever JSON is in the world, so anything other than a literal `true` — a
 * string "true", a missing entry, a value from a schema that has since changed —
 * is off rather than truthy.
 */
export function readModuleFlag(settings: unknown, field: string): boolean {
  return readWorldSetting<unknown>(settings, `${MODULE_ID}.${field}`, false) === true
}
