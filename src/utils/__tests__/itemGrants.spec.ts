import { describe, it, expect } from 'vitest'
import { resolveGrantDeletions, removalLockedBy, type GrantAwareItem } from '@/utils/itemGrants'

// The fixture is the real PF2e 8.4.1 grant graph for the death conditions,
// transcribed from the `GrantItem` rule elements in the conditionitems pack:
//
//   Dying       --grants--> Unconscious   (grantee: restrict)
//   Unconscious --grants--> Blinded       (grantee: restrict)
//   Unconscious --grants--> Prone         (grantee: restrict, granter: detach)
//
// `grantee: restrict` becomes the granter's `itemGrants[...].onDelete` — you
// may not remove the child while the parent stands. `granter: detach` becomes
// the child's `grantedBy.onDelete` — the child survives the parent's removal.
// Everything else defaults, which for a condition is `cascade`.

function condition(
  _id: string,
  name: string,
  opts: {
    grantedBy?: { id: string; onDelete?: 'cascade' | 'detach' | 'restrict' }
    grants?: Record<string, { id: string; onDelete?: 'cascade' | 'detach' | 'restrict' }>
    parent?: string
    type?: string
  } = {}
): GrantAwareItem {
  return {
    _id,
    name,
    type: opts.type ?? 'condition',
    flags: { pf2e: { grantedBy: opts.grantedBy, itemGrants: opts.grants } },
    ...(opts.parent ? { system: { references: { parent: { id: opts.parent } } } } : {})
  }
}

const dying = condition('d', 'Dying', {
  grants: { unconscious: { id: 'u', onDelete: 'restrict' } }
})
const unconscious = condition('u', 'Unconscious', {
  grantedBy: { id: 'd', onDelete: 'cascade' },
  grants: {
    blinded: { id: 'b', onDelete: 'restrict' },
    prone: { id: 'p', onDelete: 'restrict' }
  }
})
const blinded = condition('b', 'Blinded', { grantedBy: { id: 'u', onDelete: 'cascade' } })
const prone = condition('p', 'Prone', { grantedBy: { id: 'u', onDelete: 'detach' } })
const frightened = condition('f', 'Frightened')

const deathSpiral = [dying, unconscious, blinded, prone, frightened]

describe('resolveGrantDeletions', () => {
  it('cascades from the root condition down every granted condition', () => {
    const plan = resolveGrantDeletions(deathSpiral, ['d'])
    expect(plan.deleteIds.sort()).toEqual(['b', 'd', 'u'])
    expect(plan.blocked).toEqual([])
  })

  it('detaches a grantee that outlives its granter instead of deleting it', () => {
    // You stay on the floor after you stop being unconscious.
    const plan = resolveGrantDeletions(deathSpiral, ['d'])
    expect(plan.detachIds).toEqual(['p'])
    expect(plan.deleteIds).not.toContain('p')
  })

  it('leaves unrelated conditions alone', () => {
    expect(resolveGrantDeletions(deathSpiral, ['d']).deleteIds).not.toContain('f')
    expect(resolveGrantDeletions(deathSpiral, ['f'])).toEqual({
      deleteIds: ['f'],
      detachIds: [],
      blocked: []
    })
  })

  it('refuses to remove a condition its granter restricts', () => {
    expect(resolveGrantDeletions(deathSpiral, ['u'])).toMatchObject({
      deleteIds: [],
      blocked: [{ item: 'Unconscious', preventer: 'Dying' }]
    })
    expect(resolveGrantDeletions(deathSpiral, ['b'])).toMatchObject({
      blocked: [{ item: 'Blinded', preventer: 'Unconscious' }]
    })
  })

  it('drops a restriction when the restricting item is going too', () => {
    // Unconscious is restricted by Dying, but Dying is in the same batch.
    const plan = resolveGrantDeletions(deathSpiral, ['d', 'u'])
    expect(plan.blocked).toEqual([])
    expect(plan.deleteIds.sort()).toEqual(['b', 'd', 'u'])
  })

  it('cascades upward when a grantee is what justifies its granter', () => {
    const effect = condition('e', 'Effect: Boost', { type: 'effect' })
    const boost = condition('g', 'Granted', {
      grantedBy: { id: 'e', onDelete: 'cascade' }
    })
    effect.flags!.pf2e!.itemGrants = { granted: { id: 'g', onDelete: 'cascade' } }
    expect(resolveGrantDeletions([effect, boost], ['g']).deleteIds.sort()).toEqual(['e', 'g'])
  })

  it('defaults a missing onDelete by item class: conditions cascade, gear detaches', () => {
    const feat = condition('feat', 'Feat', {
      type: 'feat',
      grants: { c: { id: 'c' }, w: { id: 'w' } }
    })
    const granted = condition('c', 'Granted Condition', { grantedBy: { id: 'feat' } })
    const sword = condition('w', 'Longsword', { type: 'weapon', grantedBy: { id: 'feat' } })
    const plan = resolveGrantDeletions([feat, granted, sword], ['feat'])
    expect(plan.deleteIds.sort()).toEqual(['c', 'feat'])
    expect(plan.detachIds).toEqual(['w'])
  })

  it('ignores grant edges whose other half is already gone', () => {
    // Unconscious was deleted elsewhere; Prone still names it as its granter.
    const orphan = resolveGrantDeletions([prone, frightened], ['p'])
    expect(orphan).toEqual({ deleteIds: ['p'], detachIds: [], blocked: [] })
  })

  it('resolves nothing for ids the item list does not know', () => {
    expect(resolveGrantDeletions(deathSpiral, ['nope'])).toEqual({
      deleteIds: [],
      detachIds: [],
      blocked: []
    })
  })
})

// The other question the graph answers: not "what goes with this" but "may this
// go at all". PF2e asks it as ConditionPF2e#isLocked to decide whether its sheet
// offers a remove button; the app needs the same answer plus a name to show.
describe('removalLockedBy', () => {
  it('names the granter of a condition the granter restricts', () => {
    expect(removalLockedBy(deathSpiral, unconscious)).toBe('Dying')
    expect(removalLockedBy(deathSpiral, blinded)).toBe('Unconscious')
  })

  it('leaves the root condition removable', () => {
    expect(removalLockedBy(deathSpiral, dying)).toBeUndefined()
    expect(removalLockedBy(deathSpiral, frightened)).toBeUndefined()
  })

  it('does not lock a grantee whose grant is only detach or cascade', () => {
    // Prone survives Unconscious going away, but Unconscious still restricts
    // removing it directly — so this checks the other direction: an effect that
    // grants without restricting leaves its grantee free.
    const effect = condition('e', 'Effect: Heroism', {
      type: 'effect',
      grants: { c: { id: 'c', onDelete: 'detach' } }
    })
    const granted = condition('c', 'Granted', { grantedBy: { id: 'e', onDelete: 'cascade' } })
    expect(removalLockedBy([effect, granted], granted)).toBeUndefined()
  })

  it('names the parent of an in-memory grant, which has nothing to delete', () => {
    // Prone grants Off-Guard with `inMemoryOnly: true`; PF2e records the link as
    // system.references.parent and the child exists on no client but the GM's.
    const prone = condition('p', 'Prone')
    const offGuard = condition('og', 'Off-Guard', { parent: 'p' })
    expect(removalLockedBy([prone, offGuard], offGuard)).toBe('Prone')
  })

  it('holds nothing once the item it names is gone', () => {
    const offGuard = condition('og', 'Off-Guard', { parent: 'p' })
    expect(removalLockedBy([offGuard], offGuard)).toBeUndefined()
    expect(removalLockedBy([blinded], blinded)).toBeUndefined()
  })
})
