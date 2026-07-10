import type { DiceResults } from '@/types/api-types'

// Parse a Foundry/PF2e damage formula into an ordered list of die-face labels,
// one entry per physical die.
//
//   "1d8+5"            → ['d8']
//   "2d6+1d4[fire]"    → ['d6', 'd6', 'd4']
//   "(1d6+2)[fire]"    → ['d6']
//   "{2d6}[persistent,fire] + 1d4[acid]" → ['d6', 'd6', 'd4']
//
// Only NdM terms count. Bracketed [type] annotations and {grouping} braces
// contain no XdY patterns, so they're naturally ignored.
export function parseDamageFormulaDice(formula: string | undefined): string[] {
  if (!formula) return []
  const out: string[] = []
  const re = /(\d+)d(\d+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(formula)) !== null) {
    const count = Number(match[1])
    const faces = match[2]
    for (let i = 0; i < count; i++) out.push('d' + faces)
  }
  return out
}

// Substitute Foundry-style @path.to.value references in a roll formula against
// a flat rollData object — e.g. @item.level / @actor.level / @actor.abilities.str.mod.
//
// Only simple dotted-path lookups are handled (no expressions, no `floor()`,
// no `lookup()`). Refs that don't resolve to a primitive are left intact so
// the eventual DamageRoll evaluation surfaces a clear error rather than a
// silently-wrong roll.
//
//   "(@item.level)d6[fire]", { item: { level: 3 } } → "(3)d6[fire]"
export function resolveFormula(formula: string, rollData?: Record<string, unknown> | null): string {
  if (!rollData) return formula
  return formula.replace(/@([a-zA-Z_$][\w.$]*)/g, (match, path: string) => {
    const value = path
      .split('.')
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
        rollData as unknown
      )
    if (value == null || typeof value === 'object') return match
    return String(value)
  })
}

// Safely evaluate a pure math expression containing only numbers, arithmetic
// operators, and the specific functions PF2e uses in inline formulas.
// Returns null if the expression contains anything outside this strict set.
const SAFE_MATH_FNS = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  max: Math.max,
  min: Math.min
}
function tryEvalMath(expr: string): number | null {
  // Strip known function names, then verify only safe chars remain.
  const stripped = expr.replace(/\b(floor|ceil|round|abs|max|min)\b/g, '')
  if (!/^[\d\s+\-*/.(),]+$/.test(stripped)) return null
  try {
    const result = new Function(...Object.keys(SAFE_MATH_FNS), `"use strict"; return (${expr})`)(
      ...Object.values(SAFE_MATH_FNS)
    )
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  } catch {
    return null
  }
}

// Shared simplification logic parameterised by how to format a computed value.
// `wrap` receives the evaluated number string and returns the replacement text.
function simplifyWith(
  formula: string,
  rollData: Record<string, unknown> | null | undefined,
  wrap: (v: string) => string
): string {
  let result = resolveFormula(formula, rollData)

  // Alternate pass 1 (math functions) and pass 2 (bare parens) until stable.
  // They must interleave because pass 2 may expose new innermost function args
  // for pass 1 — e.g. floor((@item.rank-1)/2): pass 2 collapses (@item.rank-1)
  // first, then pass 1 can evaluate floor(result/2), then pass 2 collapses
  // the outer (1+floor(...)) — none of which would resolve in a single pass.
  const fnRe = /\b(floor|ceil|round|abs|min|max)\(([^()]*)\)/g
  let outer: string
  do {
    outer = result

    // Pass 1: evaluate math function calls whose args contain no nested parens.
    let prev: string
    do {
      prev = result
      result = result.replace(fnRe, (match, fn: string, args: string) => {
        const plainArgs = args.replace(/<[^>]*>/g, '')
        const val = tryEvalMath(`${fn}(${plainArgs})`)
        return val !== null ? wrap(String(val)) : match
      })
    } while (result !== prev)

    // Pass 2: collapse innermost parenthesised groups.
    result = result.replace(/\(([^()]*)\)/g, (match, inner: string) => {
      const plainInner = inner.replace(/<[^>]*>/g, '')
      if (/[a-zA-Z@]/.test(plainInner)) return match // unresolved ref — leave alone
      const val = tryEvalMath(plainInner.trim())
      return val !== null ? wrap(String(val)) : match
    })
  } while (result !== outer)

  return result
}

// Resolve @path references then evaluate remaining math so that e.g.
// "(floor(@item.rank/2))d6[persistent,acid]" with rank=5 renders as
// "2d6[persistent,acid]" rather than the raw expression.
export function simplifyFormula(
  formula: string,
  rollData?: Record<string, unknown> | null
): string {
  return simplifyWith(formula, rollData, (v) => v)
}

// Like simplifyFormula but wraps each computed value in a green <span> so the
// caller can distinguish calculated results from static formula text.
// Only use this for HTML display — the Foundry payload needs the plain version.
export function simplifyFormulaHtml(
  formula: string,
  rollData?: Record<string, unknown> | null
): string {
  return simplifyWith(formula, rollData, (v) => `<span class="text-green-400">${v}</span>`)
}

// Convert an ordered face array, aligned to a dice declaration list, into a
// DiceResults payload grouped by face count.
//
//   dice=['d6','d6','d4'], faces=[3,5,2] → { d6: [3, 5], d4: [2] }
export function makeDiceResults(dice: string[], faces: number[]): DiceResults {
  const out: DiceResults = {}
  dice.forEach((d, i) => {
    const key = d as keyof DiceResults
    if (!out[key]) out[key] = []
    out[key]!.push(faces[i])
  })
  return out
}
