import { MODULE_ID } from '@/api/protocol'
import { settingsApi } from './globals'
import { buildWorldLabelCatalogs, labelCatalogStamp } from './utils/labels'
import { logger } from '@/utils/utilities'

// The world's label catalogs, written into a world setting so the app can read
// them with nobody online.
//
// The catalogs are a pure function of CONFIG.PF2E and the world's locale, but
// building them needs a Foundry client — they are the product of a boot, not a
// file, and this world's Babele and language modules are part of that product.
// So the app has always had to ask a live client for them, which meant a table
// playing without a GM kept whatever it cached last session. Across a system
// upgrade that is silently last version's wording.
//
// A world setting is the right place rather than an uploaded file, for one
// reason that decides it: world settings already ride the socket handshake every
// client receives on connect, GM or not. The app does not fetch this — it is
// simply there. Measured on a real world, the catalog is 40KB against a
// handshake that is already 6.2MB, so it costs about half a percent of a
// download the app was doing anyway. An uploaded file would need the same GM
// permission (FILES_UPLOAD and SETTINGS_MODIFY are both [3,4]) and add a fetch,
// a cache-invalidation question and orphans to collect, to avoid that 0.6%.
//
// What this changes: "a GM must be online now" becomes "a GM opened Foundry once
// since the system last changed".

export const PUBLISHED_LABELS_SETTING = 'labelCatalogs'

// Registered `config: false` — it is a machine-written cache, not a preference,
// and Foundry's generic settings UI must not offer it as a field. Default is the
// empty string rather than an object so an unwritten setting is falsy and the
// app's reader can tell "never published" from "published empty".
export function registerPublishedLabelsSetting(): void {
  settingsApi().register(MODULE_ID, PUBLISHED_LABELS_SETTING, {
    name: 'Published label catalogs',
    scope: 'world',
    config: false,
    type: String,
    default: ''
  })
}

function storedStamp(): string | undefined {
  try {
    const raw = settingsApi().get(MODULE_ID, PUBLISHED_LABELS_SETTING)
    if (typeof raw !== 'string' || !raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    const stamp = (parsed as { stamp?: unknown } | null)?.stamp
    return typeof stamp === 'string' ? stamp : undefined
  } catch {
    // Unregistered, unparseable, or written by a version that shaped it
    // differently. Treated as "nothing published", which republishes it.
    return undefined
  }
}

// Write the catalogs if what is stored is not for this world as it stands now.
//
// MUST run at `ready`, never at `init`. The catalogs are read off CONFIG.PF2E
// and game.i18n after every module has had its turn at them — this world runs
// Babele and two language packs — and publishing at init would persist a
// half-localized catalog. That is worse than publishing nothing, because it
// looks correct: the app would adopt it, match the stamp, and never ask again.
//
// The caller decides WHO runs this (one elected client, see setupListener); this
// decides WHETHER there is anything to do. Both checks are cheap and the common
// case is that the stamp matches and nothing is written.
export async function publishLabelCatalogs(): Promise<void> {
  const stamp = labelCatalogStamp()
  if (storedStamp() === stamp) return
  try {
    const payload = JSON.stringify({ stamp, catalogs: buildWorldLabelCatalogs() })
    await settingsApi().set(MODULE_ID, PUBLISHED_LABELS_SETTING, payload)
    logger.info('TABLEMATE: published label catalogs', stamp, `${payload.length} bytes`)
  } catch (error) {
    // Not fatal and not retried: a client without SETTINGS_MODIFY should not
    // have been elected to do this, and if the write fails for any other reason
    // the app falls back to asking a live client exactly as it did before.
    logger.debug('TABLEMATE: could not publish label catalogs', error)
  }
}
