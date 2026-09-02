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
  macroId: Maybe<string>
  doMacro?: () => Promise<unknown> | void
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
    }
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
