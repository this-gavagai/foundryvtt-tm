import type {
  ActorPF2e,
  CharacterPF2e,
  ItemPF2e,
  PhysicalItemPF2e,
  RawModifier,
  RollOptionRuleElement,
  WeaponPF2e
} from '@7h3laughingman/pf2e-types'
import type { RequestCharacterDetailsArgs, UpdateCharacterDetailsArgs } from '@/types/api-types'
import type { SkillActionData } from '@/types/character-types'
import { TM } from '@/api/protocol'
import { inventoryTypes } from '@/utils/constants'
import { logger } from '@/utils/utilities'

// Narrowed shadow over the ambient CONFIG. Only the field we read is typed.
declare const CONFIG: { PF2E: Record<string, unknown> }
import { getGame } from '../utils/foundry'
import {
  buildSpellcastingModifiers,
  localizeIWRLabels,
  localizeProficiencyLabels,
  localizeRollOptionLabels
} from '../utils/labels'

// JSON-replacer for ElementalBlast: drops the circular `actor` back-reference,
// shrinks nested item references to bare `{ _id }`, and flattens `statistic` to
// only its check modifiers. `Statistic.check` is a prototype getter — it does
// not survive JSON serialization — so we must capture it here while we still
// have the live object. `BaseStatistic.modifiers` only carries the base
// (ability + proficiency) modifiers; `check.modifiers` includes all synthetics
// (feats, status bonuses, etc.) that are resolved at check-build time.
function blastReplacer(key: string, element: unknown) {
  if (key === 'actor') return undefined
  else if (key === 'item') return { _id: (element as ItemPF2e)?._id }
  else if (key === 'statistic') {
    type StatLike = { check?: { modifiers?: unknown[] }; modifiers?: unknown[] }
    const stat = element as StatLike | null
    return { modifiers: stat?.check?.modifiers ?? stat?.modifiers ?? [] }
  } else return element
}

type StatisticTrace = {
  rank?: number | null
  // Skill statistics carry a `lore` flag on the live object, but getTraceData()
  // doesn't emit it — so lore skills arrive client-side indistinguishable from
  // core skills. Capture it here so the app can break lores out on their own.
  lore?: boolean
  getTraceData?: () => {
    slug?: string
    label?: string
    value?: number
    totalModifier?: number
    dc?: number
    breakdown?: string
    attribute?: string | null
    rank?: number | null
    modifiers?: RawModifier[]
  }
}

function serializeModifier(modifier: RawModifier) {
  return {
    slug: modifier.slug,
    label: modifier.label,
    modifier: modifier.modifier,
    enabled: modifier.enabled,
    hideIfDisabled: modifier.hideIfDisabled,
    type: modifier.type,
    critical: (modifier as { critical?: boolean | null }).critical ?? undefined
  }
}

function serializeStatistic(statistic: StatisticTrace | null | undefined) {
  if (!statistic) return undefined
  const trace = statistic.getTraceData?.()
  if (!trace) return undefined
  return {
    ...trace,
    rank: trace.rank ?? statistic.rank ?? undefined,
    lore: statistic.lore ?? undefined,
    modifiers: trace.modifiers?.map(serializeModifier)
  }
}

// Skill actions (Demoralize, Tumble Through, Recall Knowledge, …) don't store
// their own modifier on the actor — they roll against a parent skill statistic.
// But the rollable number isn't simply that skill's modifier: feats/items can
// grant bonuses scoped to a single action via FlatModifier rule elements
// predicated on `action:<slug>`, which the bare skill modifier omits.
//
// We mirror PF2e's own `SingleCheckActionVariant.toActionCheckPreview`: take the
// skill statistic's modifiers (which already include the actor's skill-domain
// synthetics, extracted in BaseStatistic), append the action's own declared
// modifiers, then recompute against the action's roll options. Re-testing flips
// on any action-predicated modifiers, so both the total and the per-modifier
// `enabled` flags reflect the action context. We build it here (not client-side)
// because predicate evaluation needs the live actor + synthetics.
//
// Unlike PF2e's preview (which returns only the total), we also serialize the
// resolved modifier list so the app can show the breakdown and let the player
// toggle modifiers — exactly as it already does for a plain skill roll.
type LiveStatistic = {
  label: string
  modifiers: RawModifier[]
  dc?: { options?: Iterable<string> }
  lore?: boolean
}
type SkillActionLike = {
  slug?: string
  name?: string
  cost?: 'free' | 'reaction' | 0 | 1 | 2 | 3
  traits?: string[]
  statistic?: string | string[]
  modifiers?: RawModifier[]
  rollOptions?: string[]
}
type PF2eModifierApi = {
  actions?: { values?: () => Iterable<SkillActionLike> }
  Modifier?: new (raw: RawModifier) => RawModifier
  StatisticModifier?: new (
    slug: string,
    modifiers: RawModifier[],
    rollOptions: Set<string>
  ) => { totalModifier: number; modifiers: RawModifier[] }
}

function serializeSkillActions(actor: ActorPF2e): SkillActionData[] {
  const pf2e = game.pf2e as unknown as PF2eModifierApi
  const getStatistic = (actor as ActorPF2e & { getStatistic?: (s: string) => LiveStatistic | null })
    .getStatistic
  // The set of slugs that are actually skills (core + lore) on this actor. Not
  // every action sets `section: "skill"` — Track and Sense Direction, for
  // example, sit in the "exploration" group — so we key off the statistic being
  // a skill rather than the section. This also excludes actions that roll a
  // save/perception (their statistic slug won't be in here).
  const actorSkills =
    (actor as ActorPF2e & { skills?: Record<string, LiveStatistic> }).skills ?? {}
  // Lore skills (Warfare Lore, etc.) are valid Recall Knowledge statistics, but
  // PF2e's preview never appends them (see its own "append relevant statistic
  // replacements" TODO). Splice them in so Recall Knowledge shows on lores too.
  const loreSlugs = Object.entries(actorSkills)
    .filter(([, stat]) => stat?.lore)
    .map(([slug]) => slug)
  const { actions: registry, Modifier, StatisticModifier } = pf2e
  if (!registry?.values || !Modifier || !StatisticModifier || !getStatistic) return []
  const out: SkillActionData[] = []
  for (const action of registry.values()) {
    if (!action?.statistic) continue
    const declared = Array.isArray(action.statistic) ? action.statistic : [action.statistic]
    const candidates =
      action.slug === 'recall-knowledge' ? [...declared, ...loreSlugs] : declared
    const actionModifiers = Array.isArray(action.modifiers) ? action.modifiers : []
    const rollOptions = Array.isArray(action.rollOptions)
      ? action.rollOptions
      : action.slug
        ? [`action:${action.slug}`]
        : []
    const statistics: SkillActionData['statistics'] = []
    for (const slug of candidates) {
      if (!(slug in actorSkills)) continue
      const statistic = getStatistic.call(actor, slug)
      if (!statistic) continue
      try {
        const actionMods = actionModifiers.map((m) => new Modifier(m))
        const actionSlugs = new Set(actionMods.map((m) => m.slug))
        const combined = [...statistic.modifiers, ...actionMods]
        const sm = new StatisticModifier(
          slug,
          combined,
          new Set([...rollOptions, ...(statistic.dc?.options ?? [])])
        )
        statistics.push({
          statistic: slug,
          label: statistic.label,
          modifier: sm.totalModifier,
          modifiers: sm.modifiers.map((m) => {
            const fromAction = actionSlugs.has(m.slug) || undefined
            // Positive string atoms of the predicate are the sub-roll-options
            // that switch a conditional action modifier on (e.g. pocketed).
            const predicate = (m as { predicate?: unknown[] }).predicate
            const enableOptions =
              fromAction && Array.isArray(predicate)
                ? predicate.filter((p): p is string => typeof p === 'string')
                : []
            return {
              ...serializeModifier(m),
              fromAction,
              enableOptions: enableOptions.length ? enableOptions : undefined
            }
          })
        })
      } catch {
        // A misbehaving action (homebrew/module) shouldn't sink the whole sync.
        continue
      }
    }
    if (!statistics.length) continue
    out.push({
      slug: action.slug ?? '',
      label: action.name ? game.i18n.localize(action.name) : (action.slug ?? ''),
      cost: action.cost === undefined ? undefined : String(action.cost),
      traits: Array.isArray(action.traits) ? action.traits : [],
      // Replayed as extraRollOptions on the actual roll so the rolled number
      // matches the previewed modifier (action-specific bonuses fire again).
      rollOptions,
      statistics
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export async function getCharacterDetails(
  args: RequestCharacterDetailsArgs
): Promise<UpdateCharacterDetailsArgs> {
  const source = getGame()
  const actor = source.actors.get(args.actorId, { strict: true }) as ActorPF2e
  const isCharacter = actor.type === 'character'
  const characterActor = actor as unknown as CharacterPF2e
  const elementalBlasts = isCharacter
    ? { ...new game.pf2e.ElementalBlast(characterActor), actor: actor }
    : null
  const actorWithInventory = actor as ActorPF2e & {
    inventory?: {
      bulk?: {
        max?: number
        bulk?: number
        encumberedAfter?: number
        encumberedAfterBreakdown?: string
        maxBreakdown?: string
        value?: { value?: number; light?: number; normal?: number }
      }
    }
  }
  const bulk = actorWithInventory.inventory?.bulk
  const inventory = {
    bulk: bulk
      ? {
          max: bulk.max,
          bulk: bulk.bulk,
          encumberedAfter: bulk.encumberedAfter,
          encumberedAfterBreakdown: bulk.encumberedAfterBreakdown,
          maxBreakdown: bulk.maxBreakdown,
          value: {
            value: bulk.value?.value,
            light: bulk.value?.light,
            normal: bulk.value?.normal
          }
        }
      : undefined,
    labels: [...actor.items].reduce((acc: Record<string, string | undefined>, i: ItemPF2e) => {
      if (inventoryTypes.some((t) => t.type === i.type)) {
        acc[i._id ?? ''] = i.name
        ;(i as PhysicalItemPF2e)?.subitems?.forEach((s: ItemPF2e) => (acc[s._id ?? ''] = s.name))
      }
      return acc
    }, {})
  }
  const activeRules = new Set<string>()
  actor.rules.forEach((r) => {
    const ro = r as RollOptionRuleElement
    if (ro.option && ro.predicate.test([])) activeRules.add(ro.option)
  }, [])
  // elementalBlasts has a circular `actor` back-reference
  const cleanBlasts = elementalBlasts
    ? JSON.parse(JSON.stringify(elementalBlasts, blastReplacer))
    : null
  // Languages are stored on the actor as bare slugs; need to be localized
  const langKeys = CONFIG.PF2E.languages as Record<string, string>
  const actorSystem = actor.system as {
    details?: { languages?: { value?: string[] } }
  }
  const languages = (actorSystem.details?.languages?.value ?? []).map((slug: string) =>
    langKeys[slug] ? game.i18n.localize(langKeys[slug]) : slug
  )
  const proficiencyLabels = isCharacter ? localizeProficiencyLabels(characterActor.system) : {}
  const rollOptionLabels = localizeRollOptionLabels(characterActor)
  const iwrLabels = isCharacter ? localizeIWRLabels(characterActor) : {}
  const spellcastingModifiers = isCharacter ? buildSpellcastingModifiers(characterActor) : {}
  // Some PF2e conditions grant child conditions in-memory only (e.g. Grabbed
  // grants Off-Guard and Immobilized via `GrantItem` rule elements with
  // `inMemoryOnly: true`). These grants live on `actor.conditions` rather
  // than `actor.items`; the default JSON serialization (which boils down to
  // `actor._source`) drops them entirely. Merge the two sources here so the
  // wire payload reflects what the Foundry runtime actually sees.
  const baseItems = [...actor.items].map((i) => {
    const obj = i.toObject() as { _id?: string; system?: Record<string, unknown> }
    // toObject() returns source data, so for weapons system.damage.damageType
    // is the BASE type and the modular toggle is just a numeric index whose
    // options array isn't serialized. Overlay the *current* damage type so
    // the client can highlight the right damage-type chip.
    if (i.type === 'weapon') {
      const w = i as unknown as WeaponPF2e
      // Modular weapons: the active option's damageType lives on the prepared
      // toggle config. Fall back to the prepared system.damage.damageType for
      // everything else (e.g. versatile carries the string in `selected` and
      // base weapons just have their innate type).
      const modularDmg = w.system.traits?.toggles?.modular?.config?.damageType
      const prepared = modularDmg ?? w.system.damage?.damageType
      if (prepared) {
        const sys = (obj.system ??= {})
        const dmg = (sys.damage as { damageType?: string } | undefined) ?? {}
        ;(sys.damage as { damageType?: string }) = { ...dmg, damageType: prepared }
      }
    }
    return obj
  })
  // In-memory-only conditions (e.g. Off-Guard granted by Grabbed) are now derived
  // on the client from item rule elements, so they appear/disappear the moment
  // their granting item does rather than waiting for a full server refresh.
  const actorPayload = {
    ...actor.toObject(),
    items: baseItems
  }
  const systemPayload = JSON.parse(JSON.stringify(actor.system)) as {
    attributes?: {
      hp?: { value?: number; max?: number; temp?: number }
      ac?: {
        value?: number
        breakdown?: string
        modifiers?: ReturnType<typeof serializeModifier>[]
      }
    }
    perception?: object
    saves?: Record<string, object | undefined>
    skills?: Record<string, object | undefined>
    attack?: object
    movement?: { speeds?: Record<string, object | undefined> }
  }
  const hitPoints = actor.hitPoints
  if (hitPoints) {
    const attributes = (systemPayload.attributes ??= {})
    attributes.hp = {
      ...(attributes.hp ?? {}),
      value: hitPoints.value,
      max: hitPoints.max,
      temp: hitPoints.temp
    }
  }
  if (actor.armorClass) {
    const attributes = (systemPayload.attributes ??= {})
    attributes.ac = {
      ...(attributes.ac ?? {}),
      value: actor.armorClass.value,
      breakdown: actor.armorClass.breakdown,
      modifiers: actor.armorClass.modifiers.map(serializeModifier)
    }
  }
  systemPayload.perception = serializeStatistic(actor.perception)
  systemPayload.saves = {
    ...(systemPayload.saves ?? {}),
    fortitude: serializeStatistic(actor.saves?.fortitude),
    reflex: serializeStatistic(actor.saves?.reflex),
    will: serializeStatistic(actor.saves?.will)
  }
  systemPayload.skills = Object.fromEntries(
    Object.entries(actor.skills ?? {}).map(([slug, skill]) => [slug, serializeStatistic(skill)])
  )
  systemPayload.attack = serializeStatistic(
    (actor as ActorPF2e & { attackStatistic?: StatisticTrace }).attackStatistic
  )
  const movement = (
    actor as ActorPF2e & {
      movement?: { speeds?: Record<string, StatisticTrace | null | undefined> }
    }
  ).movement
  if (movement?.speeds) {
    systemPayload.movement = {
      ...(systemPayload.movement ?? {}),
      speeds: {
        ...(systemPayload.movement?.speeds ?? {}),
        land: serializeStatistic(movement.speeds.land),
        swim: serializeStatistic(movement.speeds.swim),
        climb: serializeStatistic(movement.speeds.climb),
        fly: serializeStatistic(movement.speeds.fly),
        burrow: serializeStatistic(movement.speeds.burrow)
      }
    }
  }
  logger.debug('TABLEMATE: now sending ' + actor.name)
  return {
    action: TM.UPDATE_CHARACTER,
    actorId: actor._id ?? '',
    actor: actorPayload,
    system: systemPayload,
    languages,
    proficiencyLabels,
    inventory,
    activeRules: [...activeRules],
    elementalBlasts: cleanBlasts,
    spellcastingModifiers,
    rollOptionLabels,
    iwrLabels,
    skillActions: isCharacter ? serializeSkillActions(actor) : [],
    uuid: args.uuid,
    userId: game.user._id ?? ''
  }
}
