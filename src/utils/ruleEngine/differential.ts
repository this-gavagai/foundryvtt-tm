import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import { ref, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import { deriveFigure, type EngineInput } from './index'
import {
  deriveActorTraits,
  readStoredRanks,
  deriveArmorClass,
  deriveHitPointsMax,
  derivePerception,
  deriveFocusPool,
  deriveInitiative,
  deriveMovement,
  deriveSave,
  deriveSkill,
  deriveSpellAttack,
  deriveSpellDC,
  spellcastingDomains,
  type SpellcastingEntrySystem,
  type DerivationInput
} from './statistics'
import { calcAttribute } from '@/composables/character/calcAttributes'
import {
  AC_DOMAINS,
  PERCEPTION_DOMAINS,
  saveDomains,
  skillDomains,
  SAVE_ATTRIBUTES
} from './domains'
import type { EngineItem, EngineModifier } from './flatModifiers'
import type { Ledger } from './ledger'

// What the payload reports for one spellcasting entry, keyed by the entry's id.
type SpellModifiers = { dc?: number; mod?: number; modifiers?: WireModifier[] }

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
//
// It also compares WHOLE TOTALS, which is a strictly stronger check than the
// modifier sets: it exercises the base arithmetic — proficiency ranks, the class
// item's stored values, dex caps, ancestry hit points — that the modifier
// comparison cannot see at all. A figure can have a perfect modifier set and
// still be six points out because its proficiency rank was never upgraded.
//
// Attributes are compared separately. `calcAttribute` reconstructs them from
// build data, and every statistic keys off one, so an error there would surface
// as divergence in a dozen figures at once and look like a dozen bugs. Checked
// on its own, it reads as what it is.

export interface FigureDivergence {
  figure: string
  valueMismatch: { slug: string; engine: number; pf2e: number }[]
  engineOnly: string[]
  silentMiss: string[]
  skipped: number
  // Which rule element types were skipped, and why. Carried rather than counted
  // because "which key costs the most coverage across a real table" is the
  // number that says what to implement next — and a bare count cannot answer it.
  skippedBy: { key: string; reason: string }[]
  // The whole statistic, engine against PF2e. Absent when the payload reports no
  // total for this figure, or when the engine declined to derive one.
  total?: { engine: number; pf2e: number }
  // Whether a total comparison actually happened.
  //
  // Without this a row that compared NOTHING is indistinguishable from a row
  // that compared and agreed — both simply have no `total` — so a figure PF2e
  // never reports reads as permanently, silently correct. That is the same
  // shape as the spellcasting rows that compared nothing at all, and the reason
  // this flag exists rather than a comment promising to remember.
  totalCompared?: boolean
}

export interface DifferentialReport {
  actorId: string
  figures: FigureDivergence[]
  // `calcAttribute` against PF2e's own modifiers. Its own line because every
  // statistic depends on it: one wrong attribute reads as many wrong figures.
  attributes: { attribute: string; engine: number; pf2e: number }[]
  // Convenience for a log line: whether anything at all diverged.
  clean: boolean
  silentMisses: number
  // Totals that disagreed, which is the number worth watching as the engine
  // matures — a modifier set can be right while the figure is wrong.
  totalMismatches: number
  // Whether this ran against SOURCE data, as production does, or fell back to
  // the payload's prepared system. A report built the second way flatters the
  // engine and must not be read as a measurement of the real path.
  usedSource: boolean
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
      const rule = raw as {
        key?: string
        selector?: string | string[]
        slug?: string
        label?: string
      }
      if (rule.key !== 'FlatModifier') continue
      const selectors = Array.isArray(rule.selector) ? rule.selector : [rule.selector]
      if (!selectors.some((selector) => typeof selector === 'string' && wanted.has(selector)))
        continue
      const slug =
        rule.slug ??
        (rule.label ?? item.name ?? '')
          .toLowerCase()
          // Apostrophes are dropped, matching PF2e — see the note on the
          // engine's own sluggify. The candidate set is compared against slugs
          // PF2e produced, so it has to agree with them.
          .replace(/['’]/g, '')
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
  reported: WireModifier[] | undefined,
  total?: { engine: number | undefined; pf2e: number | undefined },
  // The modifier list the SHEET would render, when the caller has already built
  // it. Passing it is what makes this compare the real derivation.
  //
  // Without it the comparison fell back to `deriveFigure`, which collects flat
  // modifiers and returns them UNRESOLVED — no stacking applied, and no
  // attribute or proficiency in the contest at all. So a proficiency-typed feat
  // that loses to a trained skill's own bonus came out enabled here and disabled
  // in PF2e's list, and the harness reported a divergence out of two lists that
  // agree exactly. Every trained skill on every character carrying Untrained
  // Improvisation, on every payload.
  actual?: { modifiers: EngineModifier[]; ledger: Ledger }
): FigureDivergence {
  const derived = actual ?? deriveFigure(input, domains)
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
  // Disabled on both sides: PF2e reports stacking losers with `enabled: false`
  // and pf2eModifiers drops them, so comparing our disabled ones would
  // manufacture divergence out of agreement.
  for (const modifier of derived.modifiers.filter((m) => m.enabled)) {
    if (!truth.has(modifier.slug)) {
      // Only a slug a FlatModifier on this actor could have produced counts as
      // over-application — the same filter the silent-miss pass uses, and for
      // the same reason. The engine's own base entries (an attribute, a
      // proficiency, an armour bonus) are arithmetic rather than rules; PF2e
      // reports them too, but a payload that shapes them differently is a
      // serialization difference, not the engine applying a rule PF2e did not.
      if (candidates.has(modifier.slug)) engineOnly.push(modifier.slug)
      continue
    }
    const expected = truth.get(modifier.slug) ?? 0
    if (expected !== modifier.modifier) {
      valueMismatch.push({ slug: modifier.slug, engine: modifier.modifier, pf2e: expected })
    }
  }

  const produced = new Set(derived.modifiers.filter((m) => m.enabled).map((m) => m.slug))
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
    skipped: derived.ledger.skipped.length,
    skippedBy: derived.ledger.skipped.map((skip) => ({ key: skip.key, reason: skip.reason })),
    totalCompared: typeof total?.engine === 'number' && typeof total?.pf2e === 'number',
    total:
      typeof total?.engine === 'number' &&
      typeof total?.pf2e === 'number' &&
      total.engine !== total.pf2e
        ? { engine: total.engine, pf2e: total.pf2e }
        : undefined
  }
}

// Run the engine over every figure a payload reports a modifier list for, and
// say where it diverged.
export function runDifferential(
  args: UpdateCharacterDetailsArgs,
  stamp: string | undefined,
  // The SAME actor as the world dump holds it — source data, no prepared
  // overlays. Passing it is what makes this a measurement of the fallback path
  // rather than of a situation the engine never faces.
  //
  // Without it the harness fed the engine the payload's own prepared system,
  // whose skill ranks and save ranks are already resolved. On one live
  // character the dump carried ranks for four of eight trained skills and no
  // saves or perception at all, so the harness was measuring a materially
  // easier problem and reporting the result as if it were the real one.
  sourceActor?: { items?: EngineItem[]; system?: unknown }
): DifferentialReport {
  const actor = args.actor as { items?: EngineItem[] } | undefined
  // Prefer source; fall back to the payload so the harness still says something
  // when the world has not loaded yet.
  const items = sourceActor?.items ?? actor?.items ?? []
  const usedSource = !!sourceActor?.items
  const system = args.system as
    | {
        details?: { level?: { value?: number } }
        abilities?: Record<string, { mod?: number } | undefined>
        traits?: { value?: string[] }
        attributes?: { ac?: { value?: number; modifiers?: WireModifier[] }; hp?: { max?: number } }
        saves?: Record<
          string,
          { modifiers?: WireModifier[]; attribute?: string; totalModifier?: number } | undefined
        >
        skills?: Record<
          string,
          | {
              modifiers?: WireModifier[]
              attribute?: string
              totalModifier?: number
              rank?: number
              lore?: boolean
            }
          | undefined
        >
        perception?: { modifiers?: WireModifier[]; totalModifier?: number }
        initiative?: { statistic?: string; modifiers?: WireModifier[]; totalModifier?: number }
        movement?: { speeds?: Record<string, { value?: number } | null | undefined> }
        resources?: { focus?: { max?: number } }
      }
    | undefined

  const level = system?.details?.level?.value
  // Traits from SOURCE when we have it. The payload carries assembled traits;
  // a world dump carries none, and the option set treats their absence as a
  // definite "no" — so reading the payload's here would measure a case
  // production never sees.
  const traits = usedSource ? deriveActorTraits(items) : (system?.traits?.value ?? [])
  const input: EngineInput = {
    items,
    options: { level, traits, items, activeRules: args.activeRules ?? [] },
    paths: typeof level === 'number' ? { 'actor.level': level } : {},
    stamp
  }

  // PF2e's own attribute modifiers, so the statistic comparison isolates the
  // statistic. calcAttribute is checked separately below.
  const attributes: Record<string, number> = {}
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    attributes[key] = system?.abilities?.[key]?.mod ?? 0
  }
  const derivationInput: DerivationInput | undefined =
    typeof level === 'number'
      ? {
          items,
          level,
          attributes,
          traits,
          activeRules: args.activeRules ?? [],
          // From SOURCE when we have it, which is the whole point.
          storedRanks: readStoredRanks(sourceActor?.system ?? undefined),
          stamp
        }
      : undefined

  const figures: FigureDivergence[] = []
  figures.push(
    compareFigure(
      'ac',
      input,
      AC_DOMAINS,
      system?.attributes?.ac?.modifiers,
      {
        engine: derivationInput ? deriveArmorClass(derivationInput).value : undefined,
        pf2e: system?.attributes?.ac?.value
      },
      derivationInput ? deriveArmorClass(derivationInput) : undefined
    )
  )
  figures.push(
    compareFigure(
      'perception',
      input,
      PERCEPTION_DOMAINS,
      system?.perception?.modifiers,
      {
        engine: derivationInput ? derivePerception(derivationInput).value : undefined,
        pf2e: system?.perception?.totalModifier
      },
      derivationInput ? derivePerception(derivationInput) : undefined
    )
  )
  // Hit points have no modifier list of their own on the wire, so this row is a
  // pure total comparison — and the one most likely to expose a wrong class or
  // ancestry reading, since nothing else on the sheet uses those fields.
  if (derivationInput) {
    figures.push({
      figure: 'hp-max',
      valueMismatch: [],
      engineOnly: [],
      silentMiss: [],
      skipped: deriveHitPointsMax(derivationInput).ledger.skipped.length,
      skippedBy: deriveHitPointsMax(derivationInput).ledger.skipped.map((skip) => ({
        key: skip.key,
        reason: skip.reason
      })),
      totalCompared: typeof system?.attributes?.hp?.max === 'number',
      total:
        typeof system?.attributes?.hp?.max === 'number' &&
        deriveHitPointsMax(derivationInput).value !== system.attributes.hp.max
          ? { engine: deriveHitPointsMax(derivationInput).value, pf2e: system.attributes.hp.max }
          : undefined
    })
  }
  for (const [slug, save] of Object.entries(system?.saves ?? {})) {
    if (!save) continue
    figures.push(
      compareFigure(
        slug,
        input,
        saveDomains(slug, save.attribute ?? SAVE_ATTRIBUTES[slug]),
        save.modifiers,
        {
          engine: derivationInput ? deriveSave(derivationInput, slug).value : undefined,
          pf2e: save.totalModifier
        },
        derivationInput ? deriveSave(derivationInput, slug) : undefined
      )
    )
  }
  for (const [slug, skill] of Object.entries(system?.skills ?? {})) {
    if (!skill) continue
    figures.push(
      compareFigure(
        slug,
        input,
        skillDomains(slug, skill.attribute ?? 'int'),
        skill.modifiers,
        {
          engine: derivationInput
            ? deriveSkill(derivationInput, slug, skill.rank ?? 0, {
                lore: skill.lore,
                attribute: skill.attribute
              }).value
            : undefined,
          pf2e: skill.totalModifier
        },
        derivationInput
          ? deriveSkill(derivationInput, slug, skill.rank ?? 0, {
              lore: skill.lore,
              attribute: skill.attribute
            })
          : undefined
      )
    )
  }

  // Initiative is a pure total comparison. Its modifier list is the underlying
  // statistic's, already checked in that statistic's own row, so comparing it
  // again would double-count one divergence as two.
  if (derivationInput) {
    const named = system?.initiative?.statistic
    const rank = named ? (system?.skills?.[named]?.rank ?? 0) : 0
    const engine = deriveInitiative(derivationInput, named, rank)
    figures.push({
      figure: 'initiative',
      valueMismatch: [],
      engineOnly: [],
      silentMiss: [],
      skipped: engine.ledger.skipped.length,
      skippedBy: engine.ledger.skipped.map((skip) => ({ key: skip.key, reason: skip.reason })),
      totalCompared: typeof system?.initiative?.totalModifier === 'number',
      total:
        typeof system?.initiative?.totalModifier === 'number' &&
        engine.value !== system.initiative.totalModifier
          ? { engine: engine.value, pf2e: system.initiative.totalModifier }
          : undefined
    })
  }

  // One row per spellcasting entry, twice over: a character with two entries
  // has two different DCs, and the whole reason spell DC needed its own
  // derivation is that it does not follow the class.
  // Speeds and the focus pool are pure total comparisons: neither carries a
  // modifier list on the wire that lines up with the engine's domains, and both
  // are far more likely to be wrong in the base than in the modifiers.
  if (derivationInput) {
    const speeds = deriveMovement(derivationInput)
    for (const [type, speed] of Object.entries(speeds)) {
      const pf2e = system?.movement?.speeds?.[type]?.value
      // PF2e reports absent speeds as null; the engine reports them as null
      // too, so "both say nothing" is agreement, not a missing row.
      if (typeof pf2e !== 'number' && !speed) continue
      figures.push({
        figure: `speed:${type}`,
        valueMismatch: [],
        engineOnly: [],
        silentMiss: [],
        skipped: speed?.ledger.skipped.length ?? 0,
        skippedBy: (speed?.ledger.skipped ?? []).map((skip) => ({
          key: skip.key,
          reason: skip.reason
        })),
        totalCompared: typeof pf2e === 'number',
        total:
          typeof pf2e === 'number' && (speed?.value ?? 0) !== pf2e
            ? { engine: speed?.value ?? 0, pf2e }
            : undefined
      })
    }

    const focus = deriveFocusPool(derivationInput)
    const reportedFocus = system?.resources?.focus?.max
    figures.push({
      figure: 'focus-pool',
      valueMismatch: [],
      engineOnly: [],
      silentMiss: [],
      skipped: focus.ledger.skipped.length,
      skippedBy: focus.ledger.skipped.map((skip) => ({ key: skip.key, reason: skip.reason })),
      totalCompared: typeof reportedFocus === 'number',
      total:
        typeof reportedFocus === 'number' && focus.max !== reportedFocus
          ? { engine: focus.max, pf2e: reportedFocus }
          : undefined
    })
  }

  // Top level on the payload, NOT under `actor` — the sheet reads it off the
  // merged TablemateActor, where parseActorData has already hoisted it, and
  // reading it the sheet's way here finds nothing and compares nothing.
  const spellMods = args.spellcastingModifiers as
    Record<string, SpellModifiers | undefined> | undefined
  for (const entry of items) {
    if (entry.type !== 'spellcastingEntry') continue
    const id = (entry as { _id?: string })._id
    const reported = id ? spellMods?.[id] : undefined
    if (!reported || !derivationInput) continue
    const entrySystem = entry.system as unknown as SpellcastingEntrySystem | undefined
    const attribute = entrySystem?.ability?.value ?? 'int'
    const tradition = entrySystem?.tradition?.value ?? 'arcane'
    const slug = (entry as { name?: string }).name ?? id ?? 'spellcasting'
    figures.push(
      compareFigure(
        `${slug} DC`,
        input,
        spellcastingDomains(attribute, tradition, 'dc'),
        reported.modifiers,
        { engine: deriveSpellDC(derivationInput, entry).value, pf2e: reported.dc },
        deriveSpellDC(derivationInput, entry)
      )
    )
    figures.push(
      compareFigure(
        `${slug} attack`,
        input,
        spellcastingDomains(attribute, tradition, 'attack'),
        reported.modifiers,
        { engine: deriveSpellAttack(derivationInput, entry).value, pf2e: reported.mod },
        deriveSpellAttack(derivationInput, entry)
      )
    )
  }

  // calcAttribute wants a ref, and reconstructs the modifier from build data —
  // the same path the sheet takes when a payload's `abilities` is null.
  const attributeDivergence: DifferentialReport['attributes'] = []
  const asRef = ref({ items, system: args.system }) as unknown as Ref<CharacterPF2e | undefined>
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
    const pf2e = system?.abilities?.[key]?.mod
    if (typeof pf2e !== 'number') continue
    const engine = calcAttribute(asRef, key)
    if (typeof engine === 'number' && engine !== pf2e) {
      attributeDivergence.push({ attribute: key, engine, pf2e })
    }
  }

  const silentMisses = figures.reduce((sum, figure) => sum + figure.silentMiss.length, 0)
  const totalMismatches = figures.filter((figure) => figure.total).length
  const clean =
    attributeDivergence.length === 0 &&
    figures.every(
      (figure) =>
        figure.valueMismatch.length === 0 &&
        figure.engineOnly.length === 0 &&
        figure.silentMiss.length === 0 &&
        !figure.total
    )
  return {
    actorId: args.actorId,
    figures,
    attributes: attributeDivergence,
    clean,
    silentMisses,
    totalMismatches,
    usedSource
  }
}

// A compact summary for a log line: only the figures that diverged.
export function describeDifferential(report: DifferentialReport): string {
  // "modifiers clean", not "clean". This harness compares the engine's MODIFIER
  // lists and statistic totals against the payload it arrived with; the
  // prediction check (derivedReconcile) asks a different question about a
  // different set of figures, and a run can be clean here and report a miss
  // there without either being wrong. An unqualified "clean" reads as a verdict
  // on the whole sheet and made the pair look self-contradictory.
  if (report.clean) return `rule engine: modifiers clean on ${report.actorId}`
  const parts = report.figures
    .filter((f) => f.valueMismatch.length || f.engineOnly.length || f.silentMiss.length || f.total)
    .map((f) => {
      const bits: string[] = []
      if (f.total) bits.push(`TOTAL ${f.total.engine}≠${f.total.pf2e}`)
      if (f.silentMiss.length) bits.push(`SILENT MISS ${f.silentMiss.join(',')}`)
      if (f.engineOnly.length) bits.push(`over-applied ${f.engineOnly.join(',')}`)
      if (f.valueMismatch.length) {
        bits.push(f.valueMismatch.map((m) => `${m.slug} ${m.engine}≠${m.pf2e}`).join(','))
      }
      return `${f.figure}: ${bits.join('; ')}`
    })
  const attributes = report.attributes.map((a) => `${a.attribute} ${a.engine}≠${a.pf2e}`)
  if (attributes.length) parts.unshift(`ATTRIBUTES ${attributes.join(',')}`)
  return `rule engine: ${report.actorId} — ${parts.join(' | ')}`
}
