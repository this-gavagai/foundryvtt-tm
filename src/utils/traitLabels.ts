// Turn a PF2e trait slug into a display label using the slug→label map that
// Foundry localizes into the world locale (see localizeTraitLabels).
//
// Most slugs — including the common parameterized weapon traits (thrown-20,
// deadly-d8, versatile-s, …) — are enumerated in CONFIG.PF2E and resolve by a
// direct map lookup. This helper adds a fallback for arbitrary/homebrew
// parameterized values outside that enumeration (e.g. "thrown-25", "deadly-2d6")
// by splitting the slug into a base family plus a parameter and formatting the
// parameter the way PF2e does for that family.

// Families whose numeric parameter is a distance, rendered as "N ft.".
const DISTANCE_FAMILIES = new Set(['thrown', 'range', 'range-increment', 'volley', 'scatter'])
// Families whose numeric parameter is a bare count (no unit).
const COUNT_FAMILIES = new Set(['reload', 'capacity'])
// Families whose parameter is a die size (d6, 2d8, …).
const DIE_FAMILIES = new Set(['deadly', 'fatal', 'fatal-aim', 'two-hand', 'jousting'])

function formatParam(base: string, param: string): string | undefined {
  if (DIE_FAMILIES.has(base) && /^\d*d\d+$/.test(param)) return param
  if (DISTANCE_FAMILIES.has(base) && /^\d+$/.test(param)) return `${param} ft.`
  if (COUNT_FAMILIES.has(base) && /^\d+$/.test(param)) return param
  // versatile-<damage-type> (e.g. versatile-acid, versatile-p): title-case the
  // parameter, keeping single-letter abbreviations (P, S, B) upper-cased.
  if (base === 'versatile')
    return param.length <= 2 ? param.toUpperCase() : param.charAt(0).toUpperCase() + param.slice(1)
  return undefined
}

export function formatTraitLabel(slug: string, labels: Record<string, string>): string {
  const direct = labels[slug]
  if (direct) return direct

  // Peel parameters off the end one hyphen-group at a time so multi-word bases
  // (e.g. "fatal-aim-d10", "range-increment-30") resolve to their base label.
  const parts = slug.split('-')
  for (let i = parts.length - 1; i >= 1; i--) {
    const base = parts.slice(0, i).join('-')
    const baseLabel = labels[base]
    if (!baseLabel) continue
    const param = formatParam(base, parts.slice(i).join('-'))
    if (param !== undefined) return `${baseLabel} ${param}`
  }
  return slug
}
