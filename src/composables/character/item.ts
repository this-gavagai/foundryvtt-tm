import type { Prop } from './helpers'
import type { Item as PF2eItem } from '@/types/pf2e-types'

export interface Item {
  _id: Prop<string>
  name: Prop<string>
  type: Prop<string>
  img: Prop<string>
  itemGrants: Prop<string[]>
  grantedBy: Prop<string>
  flags: {
    pf2e: {
      damageSelections: {
        earth: Prop<string>
        fire: Prop<string>
        water: Prop<string>
        air: Prop<string>
        wood: Prop<string>
        metal: Prop<string>
      }
    }
  }
  system: {
    slug: Prop<string>
    location: { value: Prop<string>; heightenedLevel: Prop<number>; signature: Prop<boolean> }
    // location: Prop<string>
    // signature: Prop<boolean>
    category: Prop<string>
    description: { value: string }
    value: { value: Prop<number>; isValued: Prop<boolean> }
    traits: {
      rarity: Prop<string>
      value: Prop<string[]>
      toggles: { modular: { selected: Prop<string> }; versatile: { selected: Prop<string> } }
    }
    level: { value: Prop<number>; taken: Prop<number> }
    bulk: { value: Prop<number> }
    stackGroup: Prop<string>
    actions: { value: Prop<string> }
    range: Prop<number>
    damage: { damageType: Prop<string> }
    equipped: {
      carryType: Prop<string>
      invested: Prop<boolean>
      handsHeld: Prop<number>
      inSlot: Prop<boolean>
    }
    usage: { value: Prop<string> }
    hp: { value: Prop<number> }
    containerId: Prop<string>
    quantity: Prop<number>
    price: { value: { gp: Prop<number>; sp: Prop<number>; cp: Prop<number> } }
    spelldc: { dc: Prop<number> }
    time: { value: Prop<string> }
    prepared: { value: Prop<string> }
    slots: {
      [key: string]: {
        value: Prop<number>
        max: Prop<number>
        prepared: { id: Prop<string | null>; expended: Prop<boolean> }[]
      }
    }
    spell: { system: { level: { value: Prop<number> }; description: { value: Prop<string> } } }
    uses: { value: Prop<number>; max: Prop<number> }
  }
  delete?: () => Promise<unknown>
  changeQty?: (newTotal: number) => Promise<unknown>
  changeUses?: (newTotal: number) => Promise<unknown>
  consumeItem?: () => Promise<unknown>
}
export function makeItem(root: PF2eItem | undefined): Item | undefined {
  if (!root) return undefined
  // if (root?.system?.location) console.log(root?.name, root?.type, root?.system?.location)
  return {
    _id: root?._id,
    name: root?.name,
    type: root?.type,
    img: root?.img,
    itemGrants: root?.flags?.pf2e?.itemGrants
      ? Object.values(root?.flags?.pf2e?.itemGrants as object).map((i) => i?.id)
      : undefined,
    grantedBy: root?.flags?.pf2e?.grantedBy?.id,
    flags: {
      pf2e: {
        damageSelections: {
          earth: root?.flags?.pf2e?.damageSelections?.earth,
          fire: root?.flags?.pf2e?.damageSelections?.fire,
          water: root?.flags?.pf2e?.damageSelections?.water,
          air: root?.flags?.pf2e?.damageSelections?.air,
          wood: root?.flags?.pf2e?.damageSelections?.wood,
          metal: root?.flags?.pf2e?.damageSelections?.metal
        }
      }
    },
    system: {
      slug: root?.system?.slug,
      location: {
        // NB: in the base PF2e type, feats have just a string while spells have this object. easier to convert everything
        value: root?.system?.location?.value ?? root?.system?.location,
        signature: root?.system?.location?.signature,
        heightenedLevel: root?.system?.location?.heightenedLevel
      },
      category: root?.system?.category,
      description: { value: root?.system?.description?.value },
      value: { isValued: root?.system?.value?.isValued, value: root?.system?.value?.value },
      bulk: { value: root?.system?.bulk?.value },
      stackGroup: root?.system?.stackGroup,
      traits: {
        rarity: root?.system?.traits?.rarity,
        value: root?.system?.traits?.value ? [...root?.system?.traits?.value] : undefined,
        toggles: {
          modular: { selected: root?.system?.traits?.toggles?.modular?.selected },
          versatile: { selected: root?.system?.traits?.toggles?.versatile?.selected }
        }
      },
      level: { value: root?.system?.level?.value, taken: root?.system?.level?.taken },
      actions: { value: root?.system?.actions?.value },
      range: root?.system?.range,
      damage: { damageType: root?.system?.damage?.damageType },
      equipped: {
        carryType: root?.system?.equipped?.carryType,
        invested: root?.system?.equipped?.invested,
        handsHeld: root?.system?.equipped?.handsHeld,
        inSlot: root?.system?.equipped?.inSlot
      },
      usage: { value: root?.system?.usage?.value },
      hp: { value: root?.system?.hp?.value },
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
      time: { value: root?.system?.time?.value },
      prepared: { value: root?.system?.prepared?.value },
      slots: Object.entries(root?.system?.slots ?? {}).reduce(
        (acc, curr) => (
          (acc[curr[0]] = {
            value: curr[1]?.value,
            max: curr[1]?.max,
            prepared: curr[1]?.prepared?.map((i) => ({
              id: i?.id,
              expended: i?.expended
            }))
          }),
          acc
        ),
        {} as {
          [key: string]: {
            value: number
            max: number
            prepared: { id: string | null; expended: boolean }[]
          }
        }
      ),
      spell: {
        system: {
          level: { value: root?.system?.spell?.system?.level?.value },
          description: { value: root?.system?.spell?.system?.description?.value }
        }
      },
      uses: { value: root?.system?.uses?.value, max: root?.system?.uses?.max }
    }
  }
}
