import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { mergeDeep } from '../utilities'
import { requestCharacterDetails } from './setup'

export function _processDeletes(actor: Ref<Actor>, results: []) {
  results.forEach((d: string) => {
    const item = actor.value.items.find((i: any) => i._id === d)
    if (item) {
      const index = actor.value.items.indexOf(item)
      actor.value.items.splice(index, 1)
    }
  })
  requestCharacterDetails(actor.value._id)
}
export function _processUpdates(actor: Ref<Actor>, results: []) {
  results.forEach((change: any) => {
    let item = actor.value.items.find((a: any) => a._id == change._id)
    if (item) mergeDeep(item, change)
  })
  requestCharacterDetails(actor.value._id)
}
export function _processCreates(actor: Ref<Actor>, results: []) {
  results.forEach((c: any) => {
    actor.value.items.push(c)
  })
  requestCharacterDetails(actor.value._id)
}
