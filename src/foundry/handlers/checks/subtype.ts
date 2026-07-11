import type {
  BlastDamageQuery,
  CheckSubtypeByType,
  GetStrikeDamageArgs,
  RollCheckArgs
} from '@/types/api-types'

// Check-subtype access for the roll handlers. Modern apps (protocol ≥ 3) send
// the typed CheckSubtypeByType payload; older apps sent comma-packed positional
// strings (e.g. 'longsword,1,' for a strike). Handlers call checkSubtypeOf()
// with their own checkType and only ever see the typed shape — the legacy
// decoding lives here and nowhere else, so it can be deleted wholesale once
// pre-3 clients are no longer a concern.

// Empty legacy segments mean "absent" ('' from `${altUsage ?? ''}`).
const numberOrUndefined = (s: string | undefined) =>
  s !== undefined && s.length ? Number(s) : undefined

const LEGACY_DECODERS: {
  [K in keyof CheckSubtypeByType]: (s: string) => CheckSubtypeByType[K]
} = {
  strike: (s) => {
    const [actionSlug, variant, altUsage] = s.split(',')
    return { actionSlug, variant: Number(variant || 0), altUsage: numberOrUndefined(altUsage) }
  },
  damage: (s) => {
    const [actionSlug, degree, altUsage] = s.split(',')
    return {
      actionSlug,
      degree: degree === 'critical' ? 'critical' : 'damage',
      altUsage: numberOrUndefined(altUsage)
    }
  },
  blast: (s) => {
    const [element, damageType, variant, isMelee] = s.split(',')
    return { element, damageType, variant: Number(variant || 0), isMelee: isMelee === 'true' }
  },
  blastDamage: (s) => {
    const [element, damageType, outcome, isMelee] = s.split(',')
    return {
      element,
      damageType,
      outcome: outcome === 'criticalSuccess' ? 'criticalSuccess' : 'success',
      isMelee: isMelee === 'true'
    }
  },
  skill: (s) => ({ slug: s }),
  skillAction: (s) => ({ slug: s }),
  save: (s) => ({ slug: s }),
  spellAttack: (s) => {
    const [entryId, spellId, attackNumber] = s.split(',')
    return {
      entryId,
      spellId: spellId || undefined,
      attackNumber: numberOrUndefined(attackNumber)
    }
  },
  spellDamage: (s) => {
    const [spellId, mapIncreases, castingRank] = s.split(',')
    return {
      spellId,
      mapIncreases: Number(mapIncreases || 0) as 0 | 1 | 2,
      castingRank: numberOrUndefined(castingRank)
    }
  },
  perception: () => undefined,
  familiarAttack: () => undefined,
  initiative: () => undefined,
  flat: () => undefined
}

export function checkSubtypeOf<K extends keyof CheckSubtypeByType>(
  args: Pick<RollCheckArgs, 'checkSubtype'>,
  checkType: K
): CheckSubtypeByType[K] {
  // The wire type says "typed object", but a pre-protocol-3 app sends the
  // legacy string — this cast is the one place that possibility is handled.
  const raw = args.checkSubtype as CheckSubtypeByType[K] | string
  if (typeof raw !== 'string') return raw
  return LEGACY_DECODERS[checkType](raw)
}

// GET_STRIKE_DAMAGE's blast target: prefer the typed field; fall back to the
// legacy 'blast:element,damageType,isMelee' actionSlug packing. Returns
// undefined for plain strike lookups.
export function blastDamageQueryOf(
  args: Pick<GetStrikeDamageArgs, 'actionSlug' | 'blast'>
): BlastDamageQuery | undefined {
  if (args.blast) return args.blast
  const [prefix, rest] = args.actionSlug.split(':')
  if (prefix !== 'blast' || rest === undefined) return undefined
  const [element, damageType, isMelee] = rest.split(',')
  return { element, damageType, isMelee: isMelee === 'true' }
}
