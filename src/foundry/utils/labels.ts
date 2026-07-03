// Label localizers used by getCharacterDetails to translate slugs Foundry
// stores in raw form (skills, saves, item rules, weapon/armor proficiencies,
// IWR entries) into display-ready strings for the client.

import type { CharacterPF2e, ItemPF2e, RawModifier } from '@7h3laughingman/pf2e-types'

// Narrowed shadow over the ambient CONFIG. pf2e-types' ConfigPF2e is wider
// but doesn't expose the field shapes we read here.
declare const CONFIG: { PF2E: Record<string, unknown> }

export function localizeProficiencyLabels(
  system: CharacterPF2e['system']
): Record<string, string> {
  const WEAPON_CATEGORIES = ['unarmed', 'simple', 'martial', 'advanced']
  const cfg = CONFIG.PF2E as {
    weaponCategories: Record<string, string>
    weaponGroups: Record<string, string>
    baseWeaponTypes: Record<string, string>
    baseShieldTypes: Record<string, string>
    armorCategories: Record<string, string>
  }
  const toPascal = (slug: string) =>
    slug.replace(/(?:^|-)(\w)/g, (_m, c: string) => c.toUpperCase())
  const labels: Record<string, string> = {}

  const attacks = (system?.proficiencies?.attacks ?? {}) as Record<
    string,
    { label?: string }
  >
  for (const [key, data] of Object.entries(attacks)) {
    const group = /^weapon-group-([-\w]+)$/.exec(key)
    const base = /^weapon-base-([-\w]+)$/.exec(key)
    let label: string | undefined
    if (key in cfg.weaponCategories) {
      label = WEAPON_CATEGORIES.includes(key)
        ? game.i18n.localize('PF2E.Actor.Character.Proficiency.Attack.' + toPascal(key))
        : game.i18n.localize(cfg.weaponCategories[key])
    } else if (group) {
      label = game.i18n.localize(cfg.weaponGroups[group[1]] ?? group[1])
    } else if (base) {
      const bt = base[1]
      label = game.i18n.localize(cfg.baseWeaponTypes[bt] ?? cfg.baseShieldTypes[bt] ?? bt)
    } else if (data.label) {
      label = game.i18n.localize(data.label)
    }
    if (label) labels[key] = label
  }

  const defenses = (system?.proficiencies?.defenses ?? {}) as Record<
    string,
    { label?: string }
  >
  for (const [key, data] of Object.entries(defenses)) {
    if (key in cfg.armorCategories) {
      labels[key] = game.i18n.localize(
        'PF2E.Actor.Character.Proficiency.Defense.' + toPascal(key)
      )
    } else if (data.label) {
      labels[key] = game.i18n.localize(data.label)
    }
  }

  const classDCs = (system?.proficiencies?.classDCs ?? {}) as Record<
    string,
    { label?: string }
  >
  for (const [key, data] of Object.entries(classDCs)) {
    if (data.label) labels[key] = game.i18n.localize(data.label)
  }

  return labels
}

// PF2e stores item/creature traits as bare slugs (e.g. "concentrate",
// "manipulate") and keeps a separate slug→i18n-key dictionary per family
// (actionTraits, spellTraits, weaponTraits, …). Merge the dictionaries whose
// traits surface in the app and localize each, so the client can turn the raw
// slugs it renders (item.system.traits.value) into display-ready labels.
// Dynamic/parametrized traits (e.g. "deadly-d8", "versatile-s") aren't literal
// dictionary keys, so they fall through to the raw slug — same as before.
export function localizeTraitLabels(): Record<string, string> {
  const cfg = CONFIG.PF2E as Record<string, unknown>
  const DICTIONARIES = [
    'actionTraits',
    'spellTraits',
    'featTraits',
    'weaponTraits',
    'armorTraits',
    'shieldTraits',
    'equipmentTraits',
    'consumableTraits',
    'ancestryTraits',
    'backgroundTraits',
    'classTraits',
    'creatureTraits',
    'effectTraits',
    'damageTraits',
    'elementTraits',
    'rarityTraits',
    'npcAttackTraits',
    'vehicleTraits',
    'hazardTraits'
  ]
  const labels: Record<string, string> = {}
  for (const name of DICTIONARIES) {
    const dict = cfg[name]
    if (!dict || typeof dict !== 'object') continue
    for (const [slug, key] of Object.entries(dict as Record<string, unknown>)) {
      if (typeof key !== 'string' || slug in labels) continue
      labels[slug] = game.i18n.localize(key)
    }
  }
  return labels
}

export function localizeRollOptionLabels(actor: CharacterPF2e): Record<string, string> {
  type StatWithLabel = { label?: string }
  type RuleWithLabel = { key?: string; label?: string; suboptions?: { label?: string }[] }
  const labels: Record<string, string> = {}
  for (const [slug, skill] of Object.entries(actor.system?.skills ?? {}))
    if ((skill as StatWithLabel).label)
      labels[slug] = game.i18n.localize((skill as StatWithLabel).label!)
  for (const [slug, save] of Object.entries(actor.system?.saves ?? {}))
    if ((save as StatWithLabel).label)
      labels[slug] = game.i18n.localize((save as StatWithLabel).label!)
  const percLabel = (actor.system?.perception as StatWithLabel | undefined)?.label
  if (percLabel) labels['perception'] = game.i18n.localize(percLabel)
  for (const item of actor.items) {
    if (item.slug && item.name) labels[item.slug] = item.name
    for (const rule of (item.system.rules as RuleWithLabel[]) ?? []) {
      if (rule.key === 'RollOption') {
        if (rule.label) labels[rule.label] = game.i18n.localize(rule.label)
        for (const sub of rule.suboptions ?? [])
          if (sub.label) labels[sub.label] = game.i18n.localize(sub.label)
      }
    }
  }
  return labels
}

export function localizeIWRLabels(actor: CharacterPF2e): Record<string, string> {
  type IWREntry = { type?: string; label?: string }
  const attrs = actor.system?.attributes as {
    immunities?: IWREntry[]
    weaknesses?: IWREntry[]
    resistances?: IWREntry[]
  }
  const labels: Record<string, string> = {}
  for (const e of [
    ...(attrs?.immunities ?? []),
    ...(attrs?.weaknesses ?? []),
    ...(attrs?.resistances ?? [])
  ]) {
    if (e.type && e.label) labels[e.type] = e.label
  }
  return labels
}

// Build the per-spellcasting-entry modifier snapshot the client uses to render
// the spell-attack modifier breakdown. Lives here with the other actor-side
// serialization helpers since it's a sibling of the label localizers.
export function buildSpellcastingModifiers(
  actor: CharacterPF2e
): Record<string, object> {
  type SpellcastingStatistic = {
    mod?: number
    check?: { modifiers?: RawModifier[] }
  }
  const result: Record<string, object> = {}
  for (const item of actor.items) {
    if (item.type !== 'spellcastingEntry') continue
    const stat = (item as ItemPF2e<CharacterPF2e> & { statistic?: SpellcastingStatistic })
      .statistic
    result[item._id ?? ''] = {
      mod: stat?.mod ?? 0,
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
