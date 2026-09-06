// A physical item's display name, composed the way PF2e composes it.
//
// `generateItemName` turns a plain "Longsword" into "+1 Striking Longsword" from
// the runes, material and grade on the item. The parts are all world-static
// strings and now ride the label catalog (see foundry/utils/labels), so the
// composition itself can happen here.
//
// THE GUARD IS MOST OF THE FUNCTION, and it is what makes this safe. PF2e only
// composes when the item's STORED name is still the plain base-type name — so a
// "Mentalist's Staff", a "Staff of Elemental Power" or any specific magic item
// is returned untouched however many runes it carries. Verified against a live
// table: of 46 weapons, armour and shields, PF2e renames 13, and the two most
// heavily runed items on the table are among the ones it leaves alone.
//
// The practical consequence is that the ~180-entry property-rune table, which
// looked like the blocker, is barely load-bearing: a property rune only reaches
// a name when the item is otherwise an unnamed base weapon. It is carried
// anyway, because that case is real — a plain longsword with a flaming rune.

export interface NameableItem {
  _id?: string | null
  name?: string
  type?: string
  system?: {
    baseItem?: string | null
    specific?: unknown
    grade?: string | null
    material?: { type?: string | null }
    runes?: {
      potency?: number
      striking?: number
      resilient?: number
      reinforcing?: number
      property?: unknown
    }
  }
}

const NAMED_TYPES = new Set(['weapon', 'armor', 'shield'])

// `property` is an array normally and an object with numeric keys on at least
// one live item, so it is read defensively in both shapes.
function propertyRunes(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw as Record<string, unknown>)
      : []
  return list.filter((entry): entry is string => typeof entry === 'string' && !!entry)
}

const COUNT_PARTS = ['', 'OneProperty', 'TwoProperties', 'ThreeProperties', 'FourProperties']

export function composeItemName(
  item: NameableItem | undefined,
  parts: Record<string, string> | undefined
): string | undefined {
  const stored = item?.name
  if (!item || !parts || !item.type || !NAMED_TYPES.has(item.type)) return stored

  const base = item.system?.baseItem
  if (!base) return stored
  const baseName =
    parts[`${item.type}-base-${base}`] ??
    parts[`weapon-base-${base}`] ??
    parts[`shield-base-${base}`]

  // The guard. A stored name that is not the plain base type is a name someone
  // or something already chose, and PF2e leaves it alone — as does this.
  if (!baseName || item.system?.specific || stored !== baseName) return stored

  const runes = item.system?.runes ?? {}
  const potency = runes.potency || null
  // Armour's second fundamental is resilient, a weapon's is striking; a shield
  // has reinforcing in its own slot with its own template.
  const secondKind = item.type === 'armor' ? 'resilient' : 'striking'
  const secondValue = item.type === 'armor' ? runes.resilient : runes.striking
  const fundamental2 = secondValue ? parts[`${secondKind}-${secondValue}`] : undefined
  const reinforcing = runes.reinforcing ? parts[`reinforcing-${runes.reinforcing}`] : undefined
  const material = item.system?.material?.type
    ? parts[`material-${item.system.material.type}`]
    : undefined
  const grade = item.system?.grade ? parts[`grade-${item.system.grade}`] : undefined

  // Grade takes its own pair of templates and excludes the rune arrangement,
  // matching PF2e's branch.
  if (grade) {
    const key = `format-Grade${material ? 'Material' : ''}`
    const template = parts[key]
    return template ? fill(template, { base: baseName, material, grade }) : stored
  }

  const named = propertyRunes(runes.property)
    .map((slug) => parts[`rune-${slug}`])
    .filter((name): name is string => !!name)
    .slice(0, 4)

  const key =
    [
      potency ? 'Potency' : '',
      reinforcing ? 'Reinforcing' : '',
      fundamental2 ? 'Fundamental2' : '',
      COUNT_PARTS[named.length] ?? '',
      material ? 'Material' : ''
    ].join('') || null
  if (!key) return stored

  const template = parts[`format-${key}`]
  // No template for this arrangement — an older module, or a combination this
  // system version does not name. The stored name is the honest fallback, and
  // it is also exactly what the sheet showed before any of this existed.
  if (!template) return stored

  return fill(template, {
    base: baseName,
    material,
    grade,
    potency: potency === null ? undefined : String(potency),
    reinforcing,
    fundamental2,
    property1: named[0],
    property2: named[1],
    property3: named[2],
    property4: named[3]
  })
}

// Foundry's `format()` is `{key}` substitution and nothing more.
function fill(template: string, values: Record<string, string | undefined>): string {
  return template
    .replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
    .replace(/\s+/g, ' ')
    .trim()
}
