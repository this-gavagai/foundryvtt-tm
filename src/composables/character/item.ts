import type { Maybe } from './helpers'
import type { Item as PF2eItem } from '@/types/pf2e-types'
import type { DeleteEventArgs, UpdateEventArgs } from '@/types/foundry-types'
import type { RequestResolutionArgs } from '@/types/api-types'

export interface Item {
  _id: Maybe<string>
  name: Maybe<string>
  type: Maybe<string>
  img: Maybe<string>
  itemGrants: Maybe<string[]>
  grantedBy: Maybe<string>
  flags: {
    pf2e: {
      damageSelections: {
        earth: Maybe<string>
        fire: Maybe<string>
        water: Maybe<string>
        air: Maybe<string>
        wood: Maybe<string>
        metal: Maybe<string>
      }
    }
  }
  system: {
    slug: Maybe<string>
    location: { value: Maybe<string>; heightenedLevel: Maybe<number>; signature: Maybe<boolean> }
    // location: Maybe<string>
    // signature: Maybe<boolean>
    category: Maybe<string>
    description: { value: string }
    value: { value: Maybe<number>; isValued: Maybe<boolean> }
    traits: {
      rarity: Maybe<string>
      value: Maybe<string[]>
      toggles: { modular: { selected: Maybe<string> }; versatile: { selected: Maybe<string> } }
    }
    level: { value: Maybe<number>; taken: Maybe<number> }
    bulk: { value: Maybe<number> }
    stackGroup: Maybe<string>
    actions: { value: Maybe<string> }
    range: Maybe<string>
    target: Maybe<string>
    defense: { save: { basic: Maybe<boolean>; statistic: Maybe<string> } }
    damage: { damageType: Maybe<string> }
    area: { type: Maybe<string>; value: Maybe<number> }
    equipped: {
      carryType: Maybe<string>
      invested: Maybe<boolean>
      handsHeld: Maybe<number>
      inSlot: Maybe<boolean>
    }
    usage: { value: Maybe<string> }
    hp: { value: Maybe<number> }
    containerId: Maybe<string>
    quantity: Maybe<number>
    price: {
      value: { gp: Maybe<number>; sp: Maybe<number>; cp: Maybe<number> }
      per: Maybe<number>
    }
    spelldc: { dc: Maybe<number> }
    time: { value: Maybe<string> }
    prepared: { value: Maybe<string>; flexible: Maybe<boolean> }
    slots: {
      [key: string]: {
        value: Maybe<number>
        max: Maybe<number>
        prepared: { id: Maybe<string | null>; expended: Maybe<boolean> }[]
      }
    }
    spell: { system: { level: { value: Maybe<number> }; description: { value: Maybe<string> } } }
    uses: { value: Maybe<number>; max: Maybe<number> }
  }
  delete?: () => Promise<DeleteEventArgs>
  consumeItem?: () => Promise<RequestResolutionArgs>
  changeQty?: (newTotal: number) => Promise<UpdateEventArgs | null>
  changeUses?: (newTotal: number) => Promise<UpdateEventArgs | null>
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
      range: root?.system?.range?.hasOwnProperty('value')
        ? root?.system?.range?.value
        : root?.system?.range,
      target: root?.system?.target?.value,
      area: { type: root?.system?.area?.type, value: root?.system?.area?.value },
      defense: {
        save: {
          basic: root?.system?.defense?.save?.basic,
          statistic: root?.system?.defense?.save?.statistic
        }
      },
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
        },
        per: root?.system?.price?.per
      },
      spelldc: { dc: root?.system?.spelldc?.dc },
      time: { value: root?.system?.time?.value },
      prepared: {
        value: root?.system?.prepared?.value,
        flexible: root?.system?.prepared?.flexible
      },
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
