import type { Maybe } from './helpers'
import type { ItemPF2e } from '@7h3laughingman/pf2e-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { RequestResolutionArgs } from '@/types/api-types'

export interface Item {
  _id: Maybe<string>
  name: Maybe<string>
  type: Maybe<string>
  img: Maybe<string>
  itemGrants: Maybe<string[]>
  grantedBy: Maybe<string>
  system: ItemSystem
  delete?: () => Promise<DocumentSocketResponse>
  consumeItem?: () => Promise<RequestResolutionArgs>
  changeQty?: (newTotal: number) => Promise<DocumentSocketResponse | null>
  changeUses?: (newTotal: number) => Promise<DocumentSocketResponse | null>
}

export interface ItemSystem {
  slug: Maybe<string>
  description: { value: string }
  traits: {
    rarity: Maybe<string>
    value: Maybe<string[]>
  }
  level: { value: Maybe<number> }
}

export function makeItem(root: ItemPF2e | undefined): Item | undefined {
  if (!root) return undefined
  return {
    _id: root?._id ?? undefined,
    name: root?.name,
    type: root?.type,
    img: root?.img,
    itemGrants: root?.flags?.pf2e?.itemGrants
      ? Object.values(root?.flags?.pf2e?.itemGrants as object).map((i) => i?.id)
      : undefined,
    grantedBy: root?.flags?.pf2e?.grantedBy?.id,
    system: {
      slug: root?.system?.slug ?? undefined,
      description: { value: root?.system?.description?.value },
      traits: {
        rarity: root?.system?.traits?.rarity,
        value: root?.system?.traits?.value ? [...root?.system?.traits?.value] : undefined
      },
      level: { value: root?.system?.level?.value }
    }
  }
}
