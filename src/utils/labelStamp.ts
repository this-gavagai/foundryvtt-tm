// The label-catalog stamp, computed from the world handshake instead of waiting
// for a module to announce it.
//
// `labelCatalogStamp()` (foundry/utils/labels.ts) builds it on a Foundry client
// from `game.system`, `game.i18n.lang` and the module's version. All three also
// arrive in the socket handshake every client gets on connect, GM or not — so
// the app can work out what stamp the world OUGHT to be announcing before
// anybody announces anything.
//
// What that buys: today the app cannot tell whether its cached catalog is
// current until a GM's client comes online and says so. A world whose system was
// upgraded between sessions therefore serves last version's labels — silently,
// and for as long as the table plays without a GM.
//
// THIS IS A STALENESS DETECTOR, NOT A SUBSTITUTE. The value it returns is only
// ever compared against the cached stamp to decide whether to ask; the stamp
// actually STORED is always the one the answering client sent back, because that
// client is the only thing that knows what its own CONFIG and i18n produced.
// So the two ways this can be wrong are both harmless:
//
//   too eager   — one redundant fetch per connect, of data that is cached after.
//   too relaxed — exactly today's behaviour, corrected by the next announcement.
//
// It can never put a wrong label on a sheet, which is why it is allowed to make
// an assumption (below) that the rest of this codebase would not tolerate.

const MODULE_ID = 'tablemate'

// The shape this needs out of the handshake. Deliberately structural and
// entirely optional: it is reading a payload from a server whose version it does
// not control, and every field missing must degrade to "cannot tell" rather
// than throw.
export interface StampSource {
  system?: { id?: string; version?: string }
  modules?: readonly { id?: string; version?: string }[]
  settings?: readonly { key?: string; value?: unknown }[]
}

// The world's locale, as `game.i18n.lang` would report it.
//
// THE ASSUMPTION. Foundry stores the choice in the `core.language` world
// setting, JSON-encoded like every other setting document, and an unset setting
// means the default. `game.i18n.lang` is that setting in every ordinary world,
// but it is the CLIENT's resolved language, and a setup that diverges the two
// would make this disagree. That is survivable here and nowhere else: a
// disagreement costs one extra fetch (see above), and the module's own answer
// still decides what gets stored.
function worldLocale(source: StampSource): string {
  const raw = source.settings?.find((setting) => setting.key === 'core.language')?.value
  if (typeof raw !== 'string') return 'en'
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' && parsed ? parsed : 'en'
  } catch {
    // Settings arrive JSON-encoded, but a plain string is the harmless reading
    // of one that is not — better than defaulting a world that really is de.
    return raw || 'en'
  }
}

// Mirrors labelCatalogStamp() field for field, INCLUDING its fallbacks: an
// unknown system reads `unknown@0`, and an absent module version interpolates as
// the literal "undefined" because the module side templates a `string |
// undefined` straight into the same slot. Reproducing the quirk is the point —
// a prettier stamp here would simply never match one from there.
export function expectedLabelStamp(source: StampSource | undefined): string | undefined {
  if (!source) return undefined
  const system = source.system
  // No system block means the handshake has not landed. Guessing `unknown@0`
  // would be a stamp that matches nothing and refetches on every connect.
  if (!system?.id && !system?.version) return undefined
  const moduleVersion = source.modules?.find((entry) => entry.id === MODULE_ID)?.version
  return `${system?.id ?? 'unknown'}@${system?.version ?? '0'}|${worldLocale(source)}|${moduleVersion}`
}
