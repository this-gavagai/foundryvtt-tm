import { describe, it, expect } from 'vitest'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import { processChanges } from '@/api/documents'
import type { DocumentData } from '@/api/internal'

// processChanges applies a modifyDocument response to a local document array
// in place. It runs for both our own mutations and remote broadcasts, so its
// merge rules (create-if-absent, deep-merge with wholesale array replacement,
// splice-on-delete) shape what every sheet displays.

function response(action: 'create' | 'update' | 'delete', result: unknown[]) {
  return { action, result } as unknown as DocumentSocketResponse
}

type Doc = { _id: string; system?: { quantity?: number; traits?: string[] } }
const docs = (...items: Doc[]) => items as unknown as DocumentData[]

describe('processChanges', () => {
  it('create appends new documents and skips ones already present', () => {
    const root = docs({ _id: 'a' })
    processChanges(response('create', [{ _id: 'a' }, { _id: 'b' }]), root)
    expect(root.map((d) => d._id)).toEqual(['a', 'b'])
  })

  it('update deep-merges the matching document', () => {
    const root = docs({ _id: 'a', system: { quantity: 1, traits: ['agile'] } })
    processChanges(response('update', [{ _id: 'a', system: { quantity: 5 } }]), root)
    expect((root[0] as Doc).system).toMatchObject({ quantity: 5, traits: ['agile'] })
  })

  it('update replaces nested arrays wholesale (server arrays are authoritative)', () => {
    const root = docs({ _id: 'a', system: { traits: ['agile', 'finesse'] } })
    processChanges(response('update', [{ _id: 'a', system: { traits: ['deadly'] } }]), root)
    expect((root[0] as Doc).system?.traits).toEqual(['deadly'])
  })

  it('update ignores documents that are not present locally', () => {
    const root = docs({ _id: 'a' })
    processChanges(response('update', [{ _id: 'ghost', system: { quantity: 2 } }]), root)
    expect(root).toHaveLength(1)
    expect((root[0] as Doc).system).toBeUndefined()
  })

  it('delete splices matching documents and ignores unknown ids', () => {
    const root = docs({ _id: 'a' }, { _id: 'b' }, { _id: 'c' })
    processChanges(response('delete', ['b', 'ghost']), root)
    expect(root.map((d) => d._id)).toEqual(['a', 'c'])
  })

  it('is a no-op without a root array', () => {
    expect(() => processChanges(response('create', [{ _id: 'a' }]), undefined)).not.toThrow()
  })
})
