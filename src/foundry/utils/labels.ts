// Label localizers used by getCharacterDetails to translate slugs Foundry
// stores in raw form (skills, saves, item rules, weapon/armor proficiencies,
// IWR entries) into display-ready strings for the client.

import type { ActorPF2e, ItemPF2e, RawModifier } from '@7h3laughingman/pf2e-types'
import {
  configPF2E,
  getGame,
  localize,
  localizeOr,
  moduleVersion,
  translations,
  type ConfigPF2E
} from '../globals'
import type { SpellcastingModifierData } from '@/types/character-types'
import type { WorldLabelCatalogs } from '@/types/api-types'

// One of PF2e's slug → i18n-key dictionaries, read by a slug that is not one of
// the keys pf2e-types enumerates. Proficiency and trait slugs come out of actor
// data, and homebrew adds its own, so the lookup genuinely is by arbitrary
// string. Widening is a plain assignment, not a cast: the dictionaries stay
// checked against PF2e's config, and only the key type opens up.
type LabelDictionary = Record<string, string | undefined>

// Localize a single rarity slug (common/uncommon/rare/unique) via the
// rarityTraits dictionary. Used by the compendium index, which localizes just
// the one rarity per entry rather than building the full trait-label map.
// Falls back to the raw slug when the dictionary or key is missing.
export function localizeRarity(slug?: string): string | undefined {
  if (!slug) return slug
  const dict: LabelDictionary = configPF2E().rarityTraits
  const key = dict[slug]
  return typeof key === 'string' ? localize(key) : slug
}

// PF2e stores item/creature traits as bare slugs (e.g. "concentrate",
// "manipulate") and keeps a separate slug→i18n-key dictionary per family
// (actionTraits, spellTraits, weaponTraits, …). Merge the dictionaries whose
// traits surface in the app and localize each, so the client can turn the raw
// slugs it renders (item.system.traits.value) into display-ready labels.
// Dynamic/parametrized traits (e.g. "deadly-d8", "versatile-s") aren't literal
// dictionary keys, so they fall through to the raw slug — same as before.
export function localizeTraitLabels(): Record<string, string> {
  const cfg = configPF2E()
  const DICTIONARIES: Array<keyof ConfigPF2E> = [
    'actionTraits',
    'spellTraits',
    'featTraits',
    'weaponTraits',
    'armorTraits',
    'shieldTraits',
    'equipmentTraits',
    'consumableTraits',
    'ancestryTraits',
    'classTraits',
    'creatureTraits',
    'effectTraits',
    'damageTraits',
    'elementTraits',
    'rarityTraits',
    'npcAttackTraits',
    // Not traits, but the same slug→i18n-key shape: the rider effects an NPC
    // strike applies on a hit (Grab, Knockdown, …), which the NPC sheet lists
    // under each attack and looks up by tag.
    'attackEffects',
    'vehicleTraits',
    'hazardTraits'
  ]
  const labels: Record<string, string> = {}
  for (const name of DICTIONARIES) {
    const dict = cfg[name]
    if (!dict || typeof dict !== 'object') continue
    for (const [slug, key] of Object.entries(dict as Record<string, unknown>)) {
      if (typeof key !== 'string' || slug in labels) continue
      labels[slug] = localize(key)
    }
  }
  // Base labels for the parameterized weapon-trait families. The common
  // enumerated variants (thrown-20, deadly-d8, versatile-s, …) are already
  // localized above from weaponTraits; these base words let the client format
  // arbitrary/homebrew values outside the enumeration (e.g. "thrown-25",
  // "deadly-2d6") via formatTraitLabel(). Base slugs aren't real dictionary
  // keys, so they don't collide with anything merged above.
  const BASE_TRAIT_KEYS: Record<string, string> = {
    thrown: 'PF2E.TraitThrown',
    range: 'PF2E.TraitRange',
    volley: 'PF2E.TraitVolley',
    scatter: 'PF2E.TraitScatter',
    reload: 'PF2E.TraitReload',
    capacity: 'PF2E.TraitCapacity',
    deadly: 'PF2E.TraitDeadly',
    fatal: 'PF2E.TraitFatal',
    'fatal-aim': 'PF2E.TraitFatalAim',
    'two-hand': 'PF2E.TraitTwoHand',
    jousting: 'PF2E.TraitJousting',
    versatile: 'PF2E.TraitVersatile'
  }
  for (const [slug, key] of Object.entries(BASE_TRAIT_KEYS)) {
    if (slug in labels) continue
    const label = localize(key)
    if (label !== key) labels[slug] = label
  }
  return labels
}

// The RollOption labels that genuinely belong to ONE actor: the i18n keys its
// items' RollOption rules declare, resolved against the world's locale.
//
// Everything else that used to be gathered here has moved:
//
//   * skill / save / perception names → the world catalog below. They are the
//     same sixteen-odd strings for every creature in the world, so sending them
//     with each actor was the clearest case of the duplication this split
//     exists to remove.
//   * `item.slug → item.name` → derived app-side. Both halves are plain source
//     data the app already holds, so a round trip bought nothing.
//
// What is left cannot move: a rule's `label` is an arbitrary i18n key chosen by
// whatever item (or homebrew module) declares it, so it is not enumerable from
// CONFIG and only a Foundry client can resolve it. It is also small — a handful
// of entries for a typical character.
export function localizeActorRollOptionLabels(actor: ActorPF2e): Record<string, string> {
  type RuleWithLabel = { key?: string; label?: string; suboptions?: { label?: string }[] }
  const labels: Record<string, string> = {}
  for (const item of actor.items) {
    for (const rule of (item.system.rules as RuleWithLabel[]) ?? []) {
      if (rule.key !== 'RollOption') continue
      if (rule.label) labels[rule.label] = localize(rule.label)
      for (const sub of rule.suboptions ?? []) {
        if (sub.label) labels[sub.label] = localize(sub.label)
      }
    }
  }
  return labels
}

// Localize a whole CONFIG.PF2E dictionary (slug → i18n key) in one go, optionally
// re-keying each entry. Entries whose value is not a string are skipped: several
// dictionaries hold nested objects for a few of their keys.
function localizeDictionary(
  dict: unknown,
  rekey: (slug: string) => string = (slug) => slug
): Record<string, string> {
  if (!dict || typeof dict !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [slug, key] of Object.entries(dict as Record<string, unknown>)) {
    if (typeof key !== 'string') continue
    out[rekey(slug)] = localize(key)
  }
  return out
}

// The strings PF2e composes a physical item's display name out of.
//
// `generateItemName` builds "+1 Striking Longsword" from the base type, the
// fundamental runes, up to four property runes, a precious material and a grade
// — every part an i18n string, and every part world-static. So it belongs in the
// catalog beside the trait names rather than being recomputed per item per
// refresh, and once it is there the app can compose the name itself.
//
// Two of the sources are CONFIG dictionaries and read like every other catalog
// family. The property runes are not: PF2e keeps those tables inside its own
// bundle, out of a module's reach. What is reachable is the KEY CONVENTION —
// weapons nest under `PF2E.WeaponPropertyRune.<slug>.Name`, armour is flat as
// `PF2E.ArmorPropertyRune<Slug>` — so the slugs come back out of the loaded
// translations, which is the one place they are enumerable.
function itemNameParts(): Record<string, string> {
  const cfg = configPF2E()
  const t = translations()
  const out: Record<string, string> = {}

  // Base types. Weapons and shields are already carried for proficiency labels;
  // armour was not, because nothing needed it until now.
  const dict = (source: unknown, prefix: string) => {
    for (const [slug, key] of Object.entries((source ?? {}) as Record<string, unknown>)) {
      if (typeof key === 'string') out[`${prefix}${slug}`] = localize(key)
    }
  }
  dict(cfg.baseWeaponTypes, 'weapon-base-')
  dict(cfg.baseArmorTypes, 'armor-base-')
  dict(cfg.baseShieldTypes, 'shield-base-')
  dict((cfg as unknown as Record<string, unknown>).preciousMaterials, 'material-')
  dict((cfg as unknown as Record<string, unknown>).grades, 'grade-')

  // Weapon property runes: a nested object whose keys ARE the slugs.
  const weaponRunes = t.WeaponPropertyRune
  if (weaponRunes && typeof weaponRunes === 'object') {
    for (const slug of Object.keys(weaponRunes as Record<string, unknown>)) {
      const name = localize(`PF2E.WeaponPropertyRune.${slug}.Name`)
      if (name && !name.startsWith('PF2E.')) out[`rune-${slug}`] = name
    }
  }
  // Armour property runes: flat keys, the slug with its first letter capitalised
  // — which inverts exactly, since that is the only transform applied.
  for (const key of Object.keys(t)) {
    if (!key.startsWith('ArmorPropertyRune') || key === 'ArmorPropertyRune') continue
    const tail = key.slice('ArmorPropertyRune'.length)
    if (!tail) continue
    const slug = tail.charAt(0).toLowerCase() + tail.slice(1)
    const name = localize(`PF2E.${key}`)
    if (name && !name.startsWith('PF2E.')) out[`rune-${slug}`] = name
  }

  // Fundamentals, by numeric value, matching what generateItemName reads.
  const fundamentals: [string, string][] = [
    ['striking-1', 'PF2E.Item.Weapon.Rune.Striking.Striking'],
    ['striking-2', 'PF2E.Item.Weapon.Rune.Striking.Greater'],
    ['striking-3', 'PF2E.Item.Weapon.Rune.Striking.Major'],
    ['striking-4', 'PF2E.Item.Weapon.Rune.Striking.Mythic'],
    ['resilient-1', 'PF2E.ArmorResilientRune'],
    ['resilient-2', 'PF2E.ArmorGreaterResilientRune'],
    ['resilient-3', 'PF2E.ArmorMajorResilientRune'],
    ['reinforcing-1', 'PF2E.Item.Shield.Rune.Reinforcing.Minor'],
    ['reinforcing-2', 'PF2E.Item.Shield.Rune.Reinforcing.Lesser'],
    ['reinforcing-3', 'PF2E.Item.Shield.Rune.Reinforcing.Moderate'],
    ['reinforcing-4', 'PF2E.Item.Shield.Rune.Reinforcing.Greater'],
    ['reinforcing-5', 'PF2E.Item.Shield.Rune.Reinforcing.Major'],
    ['reinforcing-6', 'PF2E.Item.Shield.Rune.Reinforcing.Supreme']
  ]
  for (const [slug, key] of fundamentals) {
    const name = localize(key)
    if (name && !name.startsWith('PF2E.')) out[slug] = name
  }

  // The composition templates themselves — "+{potency} {fundamental2} {base}"
  // and its 35 siblings. Enumerated rather than listed, so a new arrangement in
  // a later system version arrives without a code change here.
  const formats = (t.Item as Record<string, unknown> | undefined)?.Physical as
    Record<string, unknown> | undefined
  const generated = formats?.GeneratedName
  if (generated && typeof generated === 'object') {
    for (const key of Object.keys(generated as Record<string, unknown>)) {
      out[`format-${key}`] = localize(`PF2E.Item.Physical.GeneratedName.${key}`)
    }
  }
  return out
}

// Everything the app needs to turn a slug into a display name, for the WHOLE
// world rather than one actor.
//
// This is the payload of GET_LABEL_CATALOGS, fetched once per label stamp (see
// labelCatalogStamp) instead of riding every character refresh. It is bigger
// than any single actor's slice — baseWeaponTypes alone runs to a couple of
// hundred entries — and that is the point: fetched once, it covers every actor
// in the world, including ones no GM has ever serialized.
//
// Everything here is a pure function of CONFIG.PF2E and the world's locale. No
// actor is consulted, which is what makes the result cacheable at all.
export function buildWorldLabelCatalogs(): WorldLabelCatalogs {
  const cfg = configPF2E()
  const toPascal = (slug: string) =>
    slug.replace(/(?:^|-)(\w)/g, (_m, c: string) => c.toUpperCase())

  // Weapon and armor CATEGORIES get PF2e's sheet-specific wording ("Simple",
  // "Unarmored") rather than the generic dictionary entry, matching what the
  // character sheet shows. The group/base keys carry the same `weapon-group-` /
  // `weapon-base-` prefixes the actor's proficiency object uses, so the app can
  // look them up by the key it already holds.
  const proficiencies: Record<string, string> = {
    ...localizeDictionary(cfg.weaponCategories),
    ...localizeDictionary(cfg.weaponGroups, (slug) => `weapon-group-${slug}`),
    ...localizeDictionary(cfg.baseWeaponTypes, (slug) => `weapon-base-${slug}`),
    ...localizeDictionary(cfg.baseShieldTypes, (slug) => `weapon-base-${slug}`),
    ...localizeDictionary(cfg.armorCategories)
  }
  for (const slug of ['unarmed', 'simple', 'martial', 'advanced']) {
    proficiencies[slug] = localize(`PF2E.Actor.Character.Proficiency.Attack.${toPascal(slug)}`)
  }
  for (const slug of Object.keys((cfg.armorCategories ?? {}) as Record<string, unknown>)) {
    proficiencies[slug] = localize(`PF2E.Actor.Character.Proficiency.Defense.${toPascal(slug)}`)
  }

  return {
    traits: localizeTraitLabels(),
    proficiencies,
    // Statistic slugs, as the roll-options panel and inline references key them.
    rollOptions: {
      ...localizeDictionary(cfg.skills),
      ...localizeDictionary(cfg.saves),
      ...localizeDictionary(cfg.abilities),
      perception: localize('PF2E.PerceptionLabel')
    },
    // One flat map across all three: an app looking up "fire" does not care
    // which of the three lists it came from, and PF2e uses the same wording.
    iwr: {
      ...localizeDictionary(cfg.immunityTypes),
      ...localizeDictionary(cfg.weaknessTypes),
      ...localizeDictionary(cfg.resistanceTypes)
    },
    languages: localizeDictionary(cfg.languages),
    // Every string generateItemName composes from. See itemNameParts.
    itemNames: itemNameParts(),
    // The composed phrase per interval, not the bare interval: `per` is an enum
    // key whose CONFIG entry is an i18n key, and the word order around it
    // belongs to the translation. Eight-odd entries, built once for the world
    // instead of once per limited-use ability on every character refresh.
    frequencies: Object.fromEntries(
      Object.entries((cfg.frequencies ?? {}) as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([per, key]) => [per, `${localizeOr('PF2E.Frequency.per', 'per')} ${localize(key)}`])
    )
  }
}

// What the catalog above depends on, as one comparable string.
//
// A catalog changes when the system changes (new traits), when the world's
// language changes (every value), or when this module changes (a dictionary
// added to the list). Nothing else can move it — it consults no actor and no
// world content — so an app holding a catalog for this stamp can keep it
// indefinitely and never ask again.
//
// Announced on every LISTENER_ONLINE so the app can compare without a round
// trip, and returned with the catalog so what it stores is self-describing.
export function labelCatalogStamp(): string {
  const source = getGame() as unknown as {
    system?: { id?: string; version?: string }
    i18n?: { lang?: string }
  }
  const system = `${source.system?.id ?? 'unknown'}@${source.system?.version ?? '0'}`
  return `${system}|${source.i18n?.lang ?? 'en'}|${moduleVersion()}`
}

// Build the per-spellcasting-entry modifier snapshot the client uses to render
// the spell-attack modifier breakdown. Lives here with the other actor-side
// serialization helpers since it's a sibling of the label localizers.
export function buildSpellcastingModifiers(
  actor: ActorPF2e
): Record<string, SpellcastingModifierData> {
  type SpellcastingStatistic = {
    mod?: number
    dc?: { value?: number }
    check?: { modifiers?: RawModifier[] }
  }
  const result: Record<string, SpellcastingModifierData> = {}
  for (const item of actor.items) {
    if (item.type !== 'spellcastingEntry') continue
    const stat = (item as ItemPF2e & { statistic?: SpellcastingStatistic }).statistic
    result[item._id ?? ''] = {
      mod: stat?.mod ?? 0,
      // The prepared save DC. A character's already matches the entry's stored
      // `spelldc.dc`, but an NPC's shifts with the elite/weak adjustment while
      // the stored number does not — so the client prefers this one.
      dc: stat?.dc?.value,
      modifiers: (stat?.check?.modifiers ?? []).map((m: RawModifier) => ({
        slug: m.slug,
        label: m.label,
        modifier: m.modifier,
        enabled: m.enabled,
        hideIfDisabled: m.hideIfDisabled
      }))
    }
  }
  return result
}
