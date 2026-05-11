import type { AbilityItemPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import type { Maybe } from './helpers'
import { makeItem } from './item'

export interface ActionSystem extends ItemSystem {
  actions: {
    value: Maybe<number>
  }
  actionType: {
    value: Maybe<string>
  }
}

export interface Action extends Item {
  system: ActionSystem
  actionType: string | null
  item: Item
  macroId: Maybe<string>
  doMacro?: (options?: object | undefined) => void
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
      }
    }
  } as Action
}
