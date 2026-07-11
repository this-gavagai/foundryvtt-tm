import { describe, it, expect } from 'vitest'
import { checkSubtypeOf, blastDamageQueryOf } from '@/foundry/handlers/checks/subtype'
import type { CheckSubtype } from '@/types/api-types'

// The subtype normalizer is the protocol-3 compatibility seam: modern apps
// send typed objects, pre-3 apps sent comma-packed positional strings. The
// legacy fixtures below are copied verbatim from the OLD client encoders
// (template literals like `${slug},${variant},${altUsage ?? ''}`), so these
// tests pin that an un-updated app decodes to exactly what the new app sends.

const args = (checkSubtype: unknown) => ({ checkSubtype: checkSubtype as CheckSubtype })

describe('checkSubtypeOf — typed payloads pass through untouched', () => {
  it('returns the object the modern app sent', () => {
    const subtype = { actionSlug: 'longsword', variant: 1, altUsage: undefined }
    expect(checkSubtypeOf(args(subtype), 'strike')).toBe(subtype)
  })

  it('passes undefined through for payload-less types', () => {
    expect(checkSubtypeOf(args(undefined), 'perception')).toBeUndefined()
    expect(checkSubtypeOf(args(undefined), 'flat')).toBeUndefined()
  })
})

describe('checkSubtypeOf — legacy comma-packed strings', () => {
  it('decodes a strike (`slug,variant,altUsage`)', () => {
    expect(checkSubtypeOf(args('longsword,1,'), 'strike')).toEqual({
      actionSlug: 'longsword',
      variant: 1,
      altUsage: undefined
    })
    expect(checkSubtypeOf(args('dagger,0,1'), 'strike')).toEqual({
      actionSlug: 'dagger',
      variant: 0,
      altUsage: 1
    })
  })

  it('decodes strike damage (`slug,degree,altUsage`)', () => {
    expect(checkSubtypeOf(args('longsword,critical,'), 'damage')).toEqual({
      actionSlug: 'longsword',
      degree: 'critical',
      altUsage: undefined
    })
    expect(checkSubtypeOf(args('longsword,damage,0'), 'damage')).toEqual({
      actionSlug: 'longsword',
      degree: 'damage',
      altUsage: 0
    })
  })

  it('decodes a blast attack (`element,damageType,variant,isMelee`)', () => {
    expect(checkSubtypeOf(args('fire,cold,1,true'), 'blast')).toEqual({
      element: 'fire',
      damageType: 'cold',
      variant: 1,
      isMelee: true
    })
  })

  it('decodes blast damage (`element,damageType,outcome,isMelee`)', () => {
    expect(checkSubtypeOf(args('air,electricity,criticalSuccess,false'), 'blastDamage')).toEqual({
      element: 'air',
      damageType: 'electricity',
      outcome: 'criticalSuccess',
      isMelee: false
    })
    expect(checkSubtypeOf(args('air,electricity,success,true'), 'blastDamage').outcome).toBe(
      'success'
    )
  })

  it('decodes bare-slug statistic subtypes', () => {
    expect(checkSubtypeOf(args('athletics'), 'skill')).toEqual({ slug: 'athletics' })
    expect(checkSubtypeOf(args('reflex'), 'save')).toEqual({ slug: 'reflex' })
    expect(checkSubtypeOf(args('demoralize'), 'skillAction')).toEqual({ slug: 'demoralize' })
  })

  it('decodes an entry-level spell attack (bare entryId)', () => {
    expect(checkSubtypeOf(args('entry123'), 'spellAttack')).toEqual({
      entryId: 'entry123',
      spellId: undefined,
      attackNumber: undefined
    })
  })

  it('decodes a per-spell attack (`entryId,spellId,attackNumber`)', () => {
    expect(checkSubtypeOf(args('entry123,spell456,2'), 'spellAttack')).toEqual({
      entryId: 'entry123',
      spellId: 'spell456',
      attackNumber: 2
    })
  })

  it('decodes spell damage (`spellId,mapIncreases,castingRank`)', () => {
    expect(checkSubtypeOf(args('spell456,1,3'), 'spellDamage')).toEqual({
      spellId: 'spell456',
      mapIncreases: 1,
      castingRank: 3
    })
    expect(checkSubtypeOf(args('spell456,0,'), 'spellDamage')).toEqual({
      spellId: 'spell456',
      mapIncreases: 0,
      castingRank: undefined
    })
  })

  it('decodes the legacy empty string for payload-less types', () => {
    expect(checkSubtypeOf(args(''), 'perception')).toBeUndefined()
    expect(checkSubtypeOf(args(''), 'initiative')).toBeUndefined()
    expect(checkSubtypeOf(args(''), 'familiarAttack')).toBeUndefined()
    expect(checkSubtypeOf(args(''), 'flat')).toBeUndefined()
  })
})

describe('blastDamageQueryOf', () => {
  it('prefers the typed blast field', () => {
    const blast = { element: 'fire', damageType: 'fire', isMelee: true }
    expect(blastDamageQueryOf({ actionSlug: '', blast })).toBe(blast)
  })

  it("decodes the legacy 'blast:' actionSlug packing", () => {
    expect(blastDamageQueryOf({ actionSlug: 'blast:water,cold,false' })).toEqual({
      element: 'water',
      damageType: 'cold',
      isMelee: false
    })
  })

  it('returns undefined for a plain strike slug', () => {
    expect(blastDamageQueryOf({ actionSlug: 'longsword' })).toBeUndefined()
    expect(blastDamageQueryOf({ actionSlug: '' })).toBeUndefined()
  })
})
