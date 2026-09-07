import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import { ref, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
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
// Every character payload carries PF2e's OWN answer for the same actor the
// engine can be run against, which makes each payload a labelled example and the
// table a growing test set no hand-written fixture suite could match for realism.
// Nothing here changes a number on screen.
//
// Three outcomes, carrying very different weight:
//
//   valueMismatch  same modifier, different number. Arithmetic or clamping.
//   engineOnly     the engine produced a modifier PF2e did not — it read a
//                  predicate as true that was false. OVER-application, the kind
//                  that inflates a defence.
//   silentMiss     PF2e has a modifier from a FlatModifier on this actor that the
//                  engine neither produced NOR recorded as skipped. The only
//                  category that indicts the DESIGN rather than the
//                  implementation: the ledger was supposed to make it
//                  impossible, so any occurrence is a bug in the honesty
//                  machinery itself and outranks the other two.
//
// It also compares WHOLE TOTALS, which is strictly stronger than the modifier
// sets: it exercises the base arithmetic — ranks, class stored values, dex caps,
// ancestry hit points — that the modifier comparison cannot see at all.
//
// THE HARNESS MUST BE CONFIGURED AS THE SHEET IS, or it is measuring a different
// engine. `usedSource` and `usedTraitVocabulary` exist because that failed
// silently once; see the note on `usedTraitVocabulary` below.
//
// Attributes are compared separately: `calcAttribute` reconstructs them from
// build data and every statistic keys off one, so an error there would surface as
// divergence in a dozen figures at once and look like a dozen bugs.

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
  // Whether the world's trait vocabulary was available, as it is in production
  // once the label catalog has been published.
  //
  // Its own flag for the same reason `usedSource` and `totalCompared` have one:
  // an ABSENT input silently changes what is being measured, and a report that
  // cannot say so is indistinguishable from one measuring the real thing. The
  // harness once never passed a vocabulary while production always does, so
  // every bare trait atom was `opaque` here and `context` there — a modifier
  // gated on `{not: "trap"}` was SKIPPED in the measurement and APPLIED on the
  // sheet, the flattering direction and the hardest to notice.
  usedTraitVocabulary: boolean
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

// A figure with no comparable modifier list on the wire: hit points, initiative,
// the speeds, the focus pool. One function rather than five hand-rolled
// literals, which had already drifted apart.
function totalOnly(
  figure: string,
  ledger: Ledger | undefined,
  engine: number,
  pf2e: number | undefined
): FigureDivergence {
  return {
    figure,
    valueMismatch: [],
    engineOnly: [],
    silentMiss: [],
    skipped: ledger?.skipped.length ?? 0,
    skippedBy: (ledger?.skipped ?? []).map((skip) => ({ key: skip.key, reason: skip.reason })),
    totalCompared: typeof pf2e === 'number',
    total: typeof pf2e === 'number' && engine !== pf2e ? { engine, pf2e } : undefined
  }
}

function compareFigure(
  figure: string,
  items: readonly EngineItem[],
  domains: readonly string[],
  reported: WireModifier[] | undefined,
  total: { engine: number | undefined; pf2e: number | undefined },
  // The figure the SHEET would render. REQUIRED — there is no second way to
  // produce one, and the type is what keeps it that way. An instrument must not
  // be able to measure a code path production never calls.
  derived: { modifiers: EngineModifier[]; ledger: Ledger }
): FigureDivergence {
  const truth = pf2eModifiers(reported)
  const candidates = candidateSlugs(items, domains)
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
    totalCompared: typeof total.engine === 'number' && typeof total.pf2e === 'number',
    total:
      typeof total.engine === 'number' &&
      typeof total.pf2e === 'number' &&
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
  // The world's trait slugs, exactly as the sheet passes them. NOT optional in
  // spirit — `undefined` is a legitimate value (the catalog is unpublished) but
  // a caller that simply forgets is measuring something else, so it is a
  // positional parameter rather than a field on an options bag, and the report
  // says which way it went. See `usedTraitVocabulary`.
  traitVocabulary: readonly string[] | undefined,
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
  // PF2e's own attribute modifiers, so the statistic comparison isolates the
  // statistic. calcAttribute is checked separately below.
  const attributes: Record<string, number> = {}
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    attributes[key] = system?.abilities?.[key]?.mod ?? 0
  }

  // Nothing is measurable without a level: every figure keys off it, and the
  // engine declines to derive at all. An empty report that says so beats a
  // report full of rows that compared nothing.
  if (typeof level !== 'number') {
    return {
      actorId: args.actorId,
      figures: [],
      attributes: [],
      clean: true,
      silentMisses: 0,
      totalMismatches: 0,
      usedSource,
      usedTraitVocabulary: !!traitVocabulary?.length
    }
  }

  // ONE input, carrying every field the sheet's own `derivationInputFor`
  // populates. A field present there and absent here is not a smaller
  // measurement — it is a measurement of a different engine.
  const derivationInput: DerivationInput = {
    items,
    level,
    attributes,
    traits,
    activeRules: args.activeRules ?? [],
    rollOptionSet: args.rollOptionSet,
    // From SOURCE when we have it, which is the whole point.
    storedRanks: readStoredRanks(sourceActor?.system ?? undefined),
    traitVocabulary,
    stamp
  }

  const figures: FigureDivergence[] = []
  const ac = deriveArmorClass(derivationInput)
  figures.push(
    compareFigure('ac', items, AC_DOMAINS, system?.attributes?.ac?.modifiers, {
      engine: ac.value,
      pf2e: system?.attributes?.ac?.value
    }, ac)
  )
  const perception = derivePerception(derivationInput)
  figures.push(
    compareFigure('perception', items, PERCEPTION_DOMAINS, system?.perception?.modifiers, {
      engine: perception.value,
      pf2e: system?.perception?.totalModifier
    }, perception)
  )
  // Hit points have no modifier list of their own on the wire, so this row is a
  // pure total comparison — and the one most likely to expose a wrong class or
  // ancestry reading, since nothing else on the sheet uses those fields.
  const hp = deriveHitPointsMax(derivationInput)
  figures.push(totalOnly('hp-max', hp.ledger, hp.value, system?.attributes?.hp?.max))
  for (const [slug, save] of Object.entries(system?.saves ?? {})) {
    if (!save) continue
    const derived = deriveSave(derivationInput, slug)
    figures.push(
      compareFigure(
        slug,
        items,
        saveDomains(slug, save.attribute ?? SAVE_ATTRIBUTES[slug]),
        save.modifiers,
        { engine: derived.value, pf2e: save.totalModifier },
        derived
      )
    )
  }
  for (const [slug, skill] of Object.entries(system?.skills ?? {})) {
    if (!skill) continue
    const derived = deriveSkill(derivationInput, slug, skill.rank ?? 0, {
      lore: skill.lore,
      attribute: skill.attribute
    })
    figures.push(
      compareFigure(
        slug,
        items,
        skillDomains(slug, skill.attribute ?? 'int'),
        skill.modifiers,
        { engine: derived.value, pf2e: skill.totalModifier },
        derived
      )
    )
  }

  // Initiative is a pure total comparison. Its modifier list is the underlying
  // statistic's, already checked in that statistic's own row, so comparing it
  // again would double-count one divergence as two.
  const named = system?.initiative?.statistic
  const initiative = deriveInitiative(
    derivationInput,
    named,
    named ? (system?.skills?.[named]?.rank ?? 0) : 0
  )
  figures.push(
    totalOnly('initiative', initiative.ledger, initiative.value, system?.initiative?.totalModifier)
  )

  // Speeds and the focus pool are pure total comparisons too: neither carries a
  // modifier list on the wire that lines up with the engine's domains, and both
  // are far more likely to be wrong in the base than in the modifiers.
  for (const [type, speed] of Object.entries(deriveMovement(derivationInput))) {
    const pf2e = system?.movement?.speeds?.[type]?.value
    // PF2e reports absent speeds as null; the engine reports them as null
    // too, so "both say nothing" is agreement, not a missing row.
    if (typeof pf2e !== 'number' && !speed) continue
    figures.push(
      totalOnly(`speed:${type}`, speed?.ledger, speed?.value ?? 0, pf2e)
    )
  }

  const focus = deriveFocusPool(derivationInput)
  figures.push(
    totalOnly('focus-pool', focus.ledger, focus.max, system?.resources?.focus?.max)
  )

  // Top level on the payload, NOT under `actor` — the sheet reads it off the
  // merged TablemateActor, where parseActorData has already hoisted it, and
  // reading it the sheet's way here finds nothing and compares nothing.
  const spellMods = args.spellcastingModifiers as
    Record<string, SpellModifiers | undefined> | undefined
  for (const entry of items) {
    if (entry.type !== 'spellcastingEntry') continue
    const id = (entry as { _id?: string })._id
    const reported = id ? spellMods?.[id] : undefined
    if (!reported) continue
    const entrySystem = entry.system as unknown as SpellcastingEntrySystem | undefined
    const attribute = entrySystem?.ability?.value ?? 'int'
    const tradition = entrySystem?.tradition?.value ?? 'arcane'
    const slug = (entry as { name?: string }).name ?? id ?? 'spellcasting'
    const dc = deriveSpellDC(derivationInput, entry)
    const attack = deriveSpellAttack(derivationInput, entry)
    figures.push(
      compareFigure(
        `${slug} DC`,
        items,
        spellcastingDomains(attribute, tradition, 'dc'),
        reported.modifiers,
        { engine: dc.value, pf2e: reported.dc },
        dc
      )
    )
    figures.push(
      compareFigure(
        `${slug} attack`,
        items,
        spellcastingDomains(attribute, tradition, 'attack'),
        reported.modifiers,
        { engine: attack.value, pf2e: reported.mod },
        attack
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
    usedSource,
    usedTraitVocabulary: !!traitVocabulary?.length
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
