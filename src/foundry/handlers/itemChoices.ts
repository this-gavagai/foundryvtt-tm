// The choices adding an item would ask its owner to make, inflated on a Foundry
// client and answered on the tablet.
//
// PF2e's `ChoiceSetRuleElement#preCreate` stops and asks a human: it awaits a
// `PickAThingPrompt` unless the rule's source already carries a `selection`. The
// module creates compendium items on the ELECTED GM's client (that is how the
// creation pipeline gets to run at all), so that dialog opened on the GM's
// screen, asking them to make a choice belonging to whichever player tapped Add
// — with nothing on it saying whose choice it was. Dismissing it left PF2e to
// warn and set `ruleSource.ignored = true`, so the item landed with its rule
// disabled and read to the player as silently broken.
//
// The fix is not to reimplement ChoiceSet. It is to answer it before it asks,
// which PF2e already supports and this module already relies on once —
// `foundryToggleKineticAura` pre-sets the aura's radius so the dialog never
// fires. This generalizes that: inflate the choices HERE (only a Foundry client
// has the CONFIG catalogs, the actor's derived data, and PF2e's predicate
// evaluator), hand the plain list to the app, and let it write the answers back
// into `selections`.
//
// Deliberately NOT ported app-side. Choices come from four different places —
// an explicit array, a CONFIG path, the actor's owned items, the actor's attacks
// — and every one of them filters through
// `resolveInjectedProperties(new Predicate(…)).test(rollOptions)`. Reproducing
// that would mean porting three PF2e subsystems and keeping them faithful
// forever; asking the system to describe its own question costs one round trip.

import type { ActorPF2e, RuleElement } from '@7h3laughingman/pf2e-types'
import type { ItemChoiceSet, ItemChoiceSelection } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { itemClass } from '../globals'

// A source rule, as far as this file cares.
interface RuleSource {
  key?: string
  flag?: string
  selection?: unknown
  [key: string]: unknown
}

/** One option, as the app will render it. */
export interface InflatedChoice {
  value: string | number
  label: string
  img?: string
}

// A prepared ChoiceSet rule element, as far as this file reads it.
//
// An INTERSECTION with the declared RuleElement rather than a standalone shape,
// so narrowing `prepareRuleElements()`'s output needs one `as` rather than a
// double cast. The added members are the ones the types package hasn't got: it
// tracks pf2e 7.10.4 and the live system is 8.4.1, and ChoiceSet's own fields
// (`flag`, `prompt`, `inflateChoices`) are not in it.
type PreparedChoiceSet = RuleElement & {
  key?: string
  flag?: string
  prompt?: string
  label?: string
  selection?: unknown
  allowedDrops?: unknown
  inflateChoices?: (rollOptions: Set<string>, tempItems: unknown[]) => Promise<InflatedChoice[]>
}

// The constructor's own first parameter, so the cast below states no shape of
// its own.
type ItemConstructorSource = ConstructorParameters<ReturnType<typeof itemClass>>[0]

function sourceRules(itemSource: Record<string, unknown>): RuleSource[] {
  const system = itemSource.system as { rules?: unknown } | undefined
  return Array.isArray(system?.rules) ? (system.rules as RuleSource[]) : []
}

/**
 * Write the app's answers into an item's source rules, in place.
 *
 * Addressed by INDEX into `system.rules`, not by the rule's `flag`: a flag is
 * optional, is derived from the item slug when absent, and two ChoiceSets on one
 * item can share one. The index is the only thing that names exactly one rule.
 */
export function applyChoiceSelections(
  itemSource: Record<string, unknown>,
  selections: ItemChoiceSelection[] | undefined
): void {
  if (!selections?.length) return
  const rules = sourceRules(itemSource)
  for (const { ruleIndex, value } of selections) {
    const rule = rules[ruleIndex]
    // A selection naming a rule that isn't a ChoiceSet is a stale app talking to
    // a different version of the item. Refuse it rather than writing a
    // `selection` onto some unrelated rule element, where it would be ignored
    // silently and leave the real ChoiceSet still unanswered.
    if (!rule || rule.key !== 'ChoiceSet') {
      logger.warn('TM-CHOICES: selection does not name a ChoiceSet rule', ruleIndex)
      continue
    }
    rule.selection = value
  }
}

/**
 * The ChoiceSets that would still stop and ask, given the answers so far.
 *
 * Returns an empty list when the item can be created without asking anything —
 * which is the condition both callers actually want: the app asks this to know
 * what to render, and the create asks it again afterwards to know whether it is
 * safe to proceed.
 *
 * Creates nothing. The temp item is built the way PF2e's own
 * `ItemPF2e.createDocuments` builds one, so the rules see the actor they are
 * about to be attached to.
 */
export async function pendingItemChoices(
  actor: ActorPF2e,
  itemSource: Record<string, unknown>
): Promise<ItemChoiceSet[]> {
  const rules = sourceRules(itemSource)
  // Nothing to ask about, and no reason to instantiate anything.
  if (!rules.some((rule) => rule?.key === 'ChoiceSet' && rule.selection == null)) return []

  // A temp item parented to the actor, then its rule elements — what
  // ItemPF2e.createDocuments does before it calls preCreate on anything.
  //
  // The cast names the constructor's own parameter type rather than restating
  // it: the source here is arbitrary JSON off a compendium document, and the
  // union of every item source shape is not something to spell out by hand.
  //
  // createDocuments also calls `prepareActorData()` on each temp item first,
  // which this skips: it exists so an item can contribute to the ACTOR's data
  // before rules prepare, and the actor here is already fully derived. A
  // ChoiceSet predicate that depends on the item's own contribution to its
  // future actor would read one step early — the one known gap, and a narrower
  // one than the `this`-typed call it would take to close.
  const temp = new (itemClass())(itemSource as ItemConstructorSource, { parent: actor })
  const prepared = temp.prepareRuleElements({ suppressWarnings: true }) as PreparedChoiceSet[]

  // The roll options a ChoiceSet's predicates test against, assembled the way
  // ChoiceSetRuleElement#preCreate assembles them.
  const rollOptions = new Set<string>([...actor.getRollOptions(), ...temp.getRollOptions('parent')])

  const pending: ItemChoiceSet[] = []
  for (const [ruleIndex, rule] of prepared.entries()) {
    if (rule?.key !== 'ChoiceSet') continue
    // Already answered — by the app, or authored into the compendium entry.
    if (rules[ruleIndex]?.selection != null) continue
    if (rule.ignored) continue
    // A ChoiceSet whose predicate fails never prompts: preCreate returns before
    // reaching the dialog. So it is not pending, and refusing on account of it
    // would block items that create perfectly well today.
    if (rule.predicate && rule.resolveInjectedProperties) {
      try {
        if (!rule.resolveInjectedProperties(rule.predicate).test(rollOptions)) continue
      } catch (error) {
        logger.debug('TM-CHOICES: could not test a ChoiceSet predicate', error)
      }
    }

    let options: InflatedChoice[] = []
    try {
      options = (await rule.inflateChoices?.(rollOptions, [temp])) ?? []
    } catch (error) {
      // An inflation that throws leaves us unable to describe the question. Report
      // it as unanswerable rather than as "no choice needed", which would let the
      // create through to prompt the GM — the thing this exists to prevent.
      logger.warn('TM-CHOICES: could not inflate a ChoiceSet', error)
    }

    pending.push({
      ruleIndex,
      flag: typeof rule.flag === 'string' ? rule.flag : '',
      prompt: typeof rule.prompt === 'string' ? rule.prompt : '',
      label: typeof rule.label === 'string' ? rule.label : '',
      options,
      // Empty options means the question cannot be answered from a list — a
      // drop-only ChoiceSet (`allowedDrops`, satisfied by dragging an item onto
      // the prompt), or an inflation that failed. Either way the app has nothing
      // to offer, and says so instead of guessing.
      ...(options.length ? {} : { unanswerable: true as const })
    })
  }
  return pending
}

// What the app is told when an item cannot be added without asking a question it
// has no way to put to the player. Matched verbatim app-side, like the other
// sentinels in api/protocol.ts, so the message can name the item.
export const CHOICES_UNANSWERABLE = 'TM_ITEM_CHOICE_UNANSWERABLE'
