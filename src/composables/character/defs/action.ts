import type { AbilityItemPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import type { Maybe } from '@/composables/character/helpers'
import { makeItem } from './item'

// A limited-use action's Frequency ("2 per hour"). `per` is a bare enum key
// ("day", "PT1H"); `perLabel` is the ready-made phrase, looked up in the world's
// frequency catalog (stores/labelCatalogs) rather than composed per item by the
// GM. `value` and `max` still arrive on the wire — PF2e fills `value ??= max` in
// prepareBaseData and item alterations can rewrite `max`, neither of which is
// visible in source data.
export interface ActionFrequency {
  value: Maybe<number>
  max: Maybe<number>
  per: Maybe<string>
  perLabel: Maybe<string>
}

export interface ActionSystem extends ItemSystem {
  actions: {
    value: Maybe<number>
  }
  actionType: {
    value: Maybe<string>
  }
  frequency: Maybe<ActionFrequency>
}

export interface Action extends Item {
  system: ActionSystem
  actionType: string | null
  item: Item
  // The toolbelt actionable macro attached to this action, if any. Folded into
  // `usable` and `doUse` below rather than driving a button of its own — a
  // macro replaces an action's default behavior, it isn't a second thing to do
  // with it.
  macroId: Maybe<string>
  // Whether this ability has something to "use" — PF2e's own row-level test
  // (createAbilityViewData's `usable`), which is what decides whether its
  // sheets draw a Use button at all. See makeAction for which parts of that
  // test carry over.
  usable: boolean
  // Spend a use and post the card. Undefined on the lists that don't offer it
  // (a familiar's abilities — PF2e's familiar sheet has no Use button either).
  doUse?: () => Promise<unknown> | void
  // Set the remaining uses directly, for the counter in the item's own modal —
  // the manual correction PF2e's sheets offer as a number input beside their
  // Use button. A plain field write, NOT a use: it posts no card and is how a
  // player restores a Frequency their daily preparations refreshed, or takes
  // back a mis-tap. Undefined on an ability with no Frequency to set.
  setUses?: (newValue: number) => unknown
}

// An exploration activity: something the character can be marked as currently
// doing while the party is in exploration mode.
//
// `active` mirrors membership in PF2e's `system.exploration` array on the
// actor, which is the entire feature — see the exploration block in
// useCharacterActions for why nothing else hangs off it.
export interface ExplorationActivity extends Action {
  active: boolean
  // Add this activity to the actor's list, or drop it if it's already there.
  // Always present (unlike Action's `doUse`): marking one is the only thing
  // this list is for.
  toggleActive: () => Promise<unknown> | void
}

// `frequencyLabels` is REQUIRED, not defaulted: a default would let a new call
// site compile while quietly rendering "PT1H" instead of "per hour".
export function makeAction(
  root: AbilityItemPF2e,
  frequencyLabels: Record<string, string>
): Action {
  const base = makeItem(root)
  return {
    ...base,
    system: {
      ...base?.system,
      actions: {
        value: root?.system?.actions?.value
      },
      actionType: {
        value: root?.system?.actionType?.value
      },
      frequency: makeFrequency(root?.system?.frequency, frequencyLabels)
    },
    // PF2e's `usable` is `selfEffect || frequency || crafting`; only the
    // frequency arm carries over, and the other two are left out because the
    // app can't finish what their card starts:
    //   selfEffect — the posted card's Apply Effect button is what actually
    //     grants the effect, and the app has no handler for it (see the chat
    //     card-button allowlist in main.css), so tapping Use would post a card
    //     and grant nothing.
    //   crafting  — opens PF2e's FormulaPicker dialog, which would appear on
    //     the handling GM's screen for the tablet user to answer.
    // Both are worth wiring; neither is a reason to withhold the button from
    // the limited-use abilities that are the whole point of it.
    usable: !!root?.system?.frequency
  } as Action
}

function makeFrequency(
  frequency: AbilityItemPF2e['system']['frequency'] | undefined,
  frequencyLabels: Record<string, string>
): ActionFrequency | undefined {
  if (!frequency) return undefined
  return {
    // Unspent frequencies have no stored `value` — PF2e fills it from `max` at
    // prepare time, and so does the overlay, but a payload from an older
    // Foundry-side build won't have been through it.
    value: frequency.value ?? frequency.max,
    max: frequency.max,
    per: frequency.per,
    // An interval with no catalog entry falls through to its raw key, which is
    // what an unlocalized frequency showed before.
    perLabel: frequency.per ? (frequencyLabels[frequency.per] ?? frequency.per) : undefined
  }
}
