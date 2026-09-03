import type { AbilityItemPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import type { Maybe } from '@/composables/character/helpers'
import { makeItem } from './item'

// A limited-use action's Frequency ("2 per hour"). `perLabel` is the ready-made
// "per day" / "per hour" phrase, composed and localized Foundry-side — `per`
// itself is a bare enum key ("day", "PT1H") the app has no catalog for. Both
// arrive on the wire; see the frequency overlay in
// foundry/handlers/characterDetails.
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

export function makeAction(root: AbilityItemPF2e): Action {
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
      frequency: makeFrequency(root?.system?.frequency)
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

// PF2e types the source `per` as its own enum and knows nothing of `perLabel`,
// which the Foundry side adds on the way out — narrow to the shape actually on
// the wire rather than restating the item's whole system data.
function makeFrequency(
  frequency: AbilityItemPF2e['system']['frequency'] | undefined
): ActionFrequency | undefined {
  if (!frequency) return undefined
  const wire = frequency as typeof frequency & { perLabel?: string }
  return {
    // Unspent frequencies have no stored `value` — PF2e fills it from `max` at
    // prepare time, and so does the overlay, but a payload from an older
    // Foundry-side build won't have been through it.
    value: wire.value ?? wire.max,
    max: wire.max,
    per: wire.per,
    perLabel: wire.perLabel
  }
}
