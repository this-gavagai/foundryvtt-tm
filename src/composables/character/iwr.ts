import type { Maybe } from './helpers'
import type { IWR as PF2eIWR } from '@/types/pf2e-types'
export interface IWR {
  type: Maybe<string>
  exceptions: Maybe<string[]>
  definition: Maybe<string>
  value?: Maybe<number>
}
export function makeIWRs(set: PF2eIWR[] | undefined): IWR[] | undefined {
  if (!set) return undefined
  return set?.map((e: PF2eIWR) => ({
    type: e?.type,
    exceptions: Array.from(e?.exceptions),
    definition: e?.definition,
    value: e?.value
  }))
}
