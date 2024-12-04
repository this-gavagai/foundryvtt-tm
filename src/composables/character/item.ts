import type { Prop } from './helpers'
import type { Item as PF2eItem } from '@/types/pf2e-types'

export interface Item {
  _id: Prop<string>
  name: Prop<string>
  type: Prop<string>
  system: {
    slug: Prop<string>
    location: Prop<string>
    category: Prop<string>
    description: { value: string }
    value: { value: Prop<number>; isValued: Prop<boolean> }
    traits: { rarity: Prop<string>; value: Prop<string[]> }
    level: { value: Prop<number>; taken: Prop<number> }
    actions: { value: Prop<string> }
    equipped: {
      carryType: Prop<string>
      invested: Prop<boolean>
      handsHeld: Prop<number>
      inSlot: Prop<boolean>
    }
    usage: { value: Prop<string> }
    containerId: Prop<string>
    quantity: Prop<number>
    price: { value: { gp: Prop<number>; sp: Prop<number>; cp: Prop<number> } }
    spelldc: { dc: Prop<number> }
    prepared: { value: Prop<string> }
    slots: { [key: string]: { value: Prop<number>; max: Prop<number> } }
  }
  img: Prop<string>
  itemGrants: Prop<string[]>
  grantedBy: Prop<string>
  delete?: () => void
  changeValue?: (newTotal: number) => void
}
export function makeItem(root: PF2eItem | undefined): Item | undefined {
  if (!root) return undefined
  return {
    _id: root?._id,
    name: root?.name,
    type: root?.type,
    system: {
      slug: root?.system?.slug,
      location: root?.system?.location,
      category: root?.system?.category,
      description: { value: root?.system?.description?.value },
      value: { isValued: root?.system?.value?.isValued, value: root?.system?.value?.value },
      traits: {
        rarity: root?.system?.traits?.rarity,
        value: root?.system?.traits?.value ? [...root?.system?.traits?.value] : undefined
      },
      level: { value: root?.system?.level?.value, taken: root?.system?.level?.taken },
      actions: { value: root?.system?.actions?.value },
      equipped: {
        carryType: root?.system?.equipped?.carryType,
        invested: root?.system?.equipped?.invested,
        handsHeld: root?.system?.equipped?.handsHeld,
        inSlot: root?.system?.equipped?.inSlot
      },
      usage: { value: root?.system?.usage },
      containerId: root?.system?.containerId,
      quantity: root?.system?.quantity,
      price: {
        value: {
          gp: root?.system?.price?.value?.gp,
          sp: root?.system?.price?.value?.sp,
          cp: root?.system?.price?.value?.cp
        }
      },
      spelldc: { dc: root?.system?.spelldc?.dc },
      prepared: { value: root?.system?.prepared?.value },
      slots: Object.entries(root?.system?.slots ?? {}).reduce(
        (acc, curr) => (
          (acc[curr[0]] = {
            value: curr[1]?.value,
            max: curr[1]?.max
          }),
          acc
        ),
        {} as { [key: string]: { value: Prop<number>; max: Prop<number> } }
      )
    },
    img: root?.img,
    itemGrants: root?.flags?.pf2e?.itemGrants
      ? Object.values(root?.flags?.pf2e?.itemGrants as object).map((i) => i?.id)
      : undefined,
    grantedBy: root?.flags?.pf2e?.grantedBy?.id
  }
}
