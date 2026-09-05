import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import { deriveFigure, type EngineInput } from './index'
import { AC_DOMAINS, PERCEPTION_DOMAINS, saveDomains, skillDomains, SAVE_ATTRIBUTES } from './domains'
import type { EngineItem } from './flatModifiers'

// Measure the engine against PF2e, on real characters, continuously.
//
// This is the whole reason the engine can be trusted rather than merely hoped
// for: every character payload carries PF2e's OWN answer for the same actor the
// engine can be run against. That makes each payload a labelled example, and the
// table a growing test set that no hand-written fixture suite could match for
// realism — real feats, real homebrew, real module interactions.
//
// So the engine is measured before it is displayed. Nothing here changes a
// number on screen; it reports how far the engine is from the truth, per
// statistic, so that "good enough to show" becomes an observation rather than a
// judgement call.
//
// Three outcomes, and they carry very different weight:
//
//   valueMismatch  same modifier, different number. An arithmetic or clamping
//                  bug — noisy but honest, and easy to chase.
//   engineOnly     the engine produced a modifier PF2e did not. It said a
//                  predicate was true that was false: an OVER-application, the
//                  kind that inflates a defence.
//   silentMiss     PF2e has a modifier from a FlatModifier rule on this actor
//                  that the engine neither produced NOR recorded as skipped.
//                  This is the only category that indicts the design rather than
//                  the implementation — the ledger was supposed to make it
//                  impossible, so any occurrence is a bug in the honesty
//                  machinery itself and outranks the other two.

export interface FigureDivergence {
  figure: string
  valueMismatch: { slug: string; engine: number; pf2e: number }[]
  engineOnly: string[]
  silentMiss: string[]
  skipped: number
}

export interface DifferentialReport {
  actorId: string
  figures: FigureDivergence[]
  // Convenience for a log line: whether anything at all diverged.
  clean: boolean
  silentMisses: number
}

interface WireModifier {
  slug?: string
  modifier?: number
  enabled?: boolean
}

// The modifier slugs PF2e reports for a statistic, as a slug → value map.
// Disabled modifiers are dropped: the engine only ever produces ones it believes
// apply, so including them would manufacture divergence.
function pf2eModifiers(list: WireModifier[] | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const modifier of list ?? []) {
    if (modifier.enabled === false) continue
    if (!modifier.slug) continue
    out.set(modifier.slug, modifier.modifier ?? 0)
  }
  return out
}

// Slugs that a FlatModifier rule on this actor could plausibly have produced for
// these domains. Used to tell a modifier the engine SHOULD have found from one
// PF2e derived some other way (base, proficiency, an attribute) — only the
// former counts as a miss.
function candidateSlugs(items: readonly EngineItem[], domains: readonly string[]): Set<string> {
  const wanted = new Set(domains)
  const slugs = new Set<string>()
  for (const item of items) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as { key?: string; selector?: string | string[]; slug?: string; label?: string }
      if (rule.key !== 'FlatModifier') continue
      const selectors = Array.isArray(rule.selector) ? rule.selector : [rule.selector]
      if (!selectors.some((selector) => typeof selector === 'string' && wanted.has(selector))) continue
      const slug =
        rule.slug ??
        (rule.label ?? item.name ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      if (slug) slugs.add(slug)
    }
  }
  return slugs
}

function compareFigure(
  figure: string,
  input: EngineInput,
  domains: readonly string[],
  reported: WireModifier[] | undefined
): FigureDivergence {
  const derived = deriveFigure(input, domains)
  const truth = pf2eModifiers(reported)
  const candidates = candidateSlugs(input.items, domains)
  // Attribution is by slug, which is why the ledger records one. Matching on the
  // item's name instead would fail for any rule whose slug differs from it, and
  // an unattributable skip would be misread as a silent miss.
  const skippedSlugs = new Set(
    derived.ledger.skipped.map((skip) => skip.slug).filter((slug): slug is string => !!slug)
  )

  const valueMismatch: FigureDivergence['valueMismatch'] = []
  const engineOnly: string[] = []
  for (const modifier of derived.modifiers) {
    if (!truth.has(modifier.slug)) {
      engineOnly.push(modifier.slug)
      continue
    }
    const expected = truth.get(modifier.slug) ?? 0
    if (expected !== modifier.modifier) {
      valueMismatch.push({ slug: modifier.slug, engine: modifier.modifier, pf2e: expected })
    }
  }

  const produced = new Set(derived.modifiers.map((modifier) => modifier.slug))
  const silentMiss: string[] = []
  for (const slug of truth.keys()) {
    if (produced.has(slug)) continue
    // Only a slug a FlatModifier on this actor could have produced counts. PF2e
    // reports base and proficiency modifiers here too, and the engine is not
    // supposed to produce those.
    if (!candidates.has(slug)) continue
    // A skip that names this modifier is not silent — it is the ledger working.
    if (skippedSlugs.has(slug)) continue
    silentMiss.push(slug)
  }

  return {
    figure,
    valueMismatch,
    engineOnly,
    silentMiss,
    skipped: derived.ledger.skipped.length
  }
}

// Run the engine over every figure a payload reports a modifier list for, and
// say where it diverged.
export function runDifferential(
  args: UpdateCharacterDetailsArgs,
  stamp: string | undefined
): DifferentialReport {
  const actor = args.actor as { items?: EngineItem[] } | undefined
  const items = actor?.items ?? []
  const system = args.system as
    | {
        details?: { level?: { value?: number } }
        traits?: { value?: string[] }
        attributes?: { ac?: { modifiers?: WireModifier[] } }
        saves?: Record<string, { modifiers?: WireModifier[]; attribute?: string } | undefined>
        skills?: Record<string, { modifiers?: WireModifier[]; attribute?: string } | undefined>
        perception?: { modifiers?: WireModifier[] }
      }
    | undefined

  const level = system?.details?.level?.value
  const input: EngineInput = {
    items,
    options: {
      level,
      traits: system?.traits?.value ?? [],
      items,
      activeRules: args.activeRules ?? []
    },
    paths: typeof level === 'number' ? { 'actor.level': level } : {},
    stamp
  }

  const figures: FigureDivergence[] = []
  figures.push(compareFigure('ac', input, AC_DOMAINS, system?.attributes?.ac?.modifiers))
  figures.push(compareFigure('perception', input, PERCEPTION_DOMAINS, system?.perception?.modifiers))
  for (const [slug, save] of Object.entries(system?.saves ?? {})) {
    if (!save) continue
    figures.push(
      compareFigure(slug, input, saveDomains(slug, save.attribute ?? SAVE_ATTRIBUTES[slug]), save.modifiers)
    )
  }
  for (const [slug, skill] of Object.entries(system?.skills ?? {})) {
    if (!skill) continue
    figures.push(compareFigure(slug, input, skillDomains(slug, skill.attribute ?? 'int'), skill.modifiers))
  }

  const silentMisses = figures.reduce((sum, figure) => sum + figure.silentMiss.length, 0)
  const clean = figures.every(
    (figure) =>
      figure.valueMismatch.length === 0 &&
      figure.engineOnly.length === 0 &&
      figure.silentMiss.length === 0
  )
  return { actorId: args.actorId, figures, clean, silentMisses }
}

// A compact summary for a log line: only the figures that diverged.
export function describeDifferential(report: DifferentialReport): string {
  if (report.clean) return `rule engine: clean on ${report.actorId}`
  const parts = report.figures
    .filter((f) => f.valueMismatch.length || f.engineOnly.length || f.silentMiss.length)
    .map((f) => {
      const bits: string[] = []
      if (f.silentMiss.length) bits.push(`SILENT MISS ${f.silentMiss.join(',')}`)
      if (f.engineOnly.length) bits.push(`over-applied ${f.engineOnly.join(',')}`)
      if (f.valueMismatch.length) {
        bits.push(f.valueMismatch.map((m) => `${m.slug} ${m.engine}≠${m.pf2e}`).join(','))
      }
      return `${f.figure}: ${bits.join('; ')}`
    })
  return `rule engine: ${report.actorId} — ${parts.join(' | ')}`
}
