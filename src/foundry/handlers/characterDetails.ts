import type {
  ItemPF2e,
  PhysicalItemPF2e,
  RollOptionRuleElement,
  WeaponPF2e
} from '@7h3laughingman/pf2e-types'
import type {
  RequestCharacterDetailsArgs,
  UpdateCharacterDetailsArgs
} from '@/types/api-types'
import { TM } from '@/api/protocol'
import { inventoryTypes } from '@/utils/constants'
import { logger } from '@/utils/utilities'

// Narrowed shadow over the ambient CONFIG. Only the field we read is typed.
declare const CONFIG: { PF2E: Record<string, unknown> }
import { getCharacter, getGame } from '../utils/foundry'
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
  }
  else return element
}

export async function getCharacterDetails(
  args: RequestCharacterDetailsArgs
): Promise<UpdateCharacterDetailsArgs> {
  const source = getGame()
  const actor = getCharacter(source, args.actorId)
  const elementalBlasts =
    actor.type !== 'party' ? { ...new game.pf2e.ElementalBlast(actor), actor: actor } : null
  const bulk = actor.inventory.bulk
  const inventory = {
    bulk: {
      max: bulk.max,
      bulk: bulk.bulk,
      encumberedAfter: bulk.encumberedAfter,
      encumberedAfterBreakdown: bulk.encumberedAfterBreakdown,
      maxBreakdown: bulk.maxBreakdown,
      value: { value: bulk.value.value, light: bulk.value.light, normal: bulk.value.normal }
    },
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
  const languages = (actor.system?.details?.languages?.value ?? []).map((slug: string) =>
    langKeys[slug] ? game.i18n.localize(langKeys[slug]) : slug
  )
  const proficiencyLabels = localizeProficiencyLabels(actor.system)
  const rollOptionLabels = localizeRollOptionLabels(actor)
  const iwrLabels = localizeIWRLabels(actor)
  const spellcastingModifiers = buildSpellcastingModifiers(actor)
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
  logger.debug('TABLEMATE: now sending ' + actor.name)
  return {
    action: TM.UPDATE_CHARACTER,
    actorId: actor._id ?? '',
    actor: actorPayload,
    system: actor.system,
    languages,
    proficiencyLabels,
    inventory,
    activeRules: [...activeRules],
    elementalBlasts: cleanBlasts,
    spellcastingModifiers,
    rollOptionLabels,
    iwrLabels,
    uuid: args.uuid,
    userId: game.user._id ?? ''
  }
}
