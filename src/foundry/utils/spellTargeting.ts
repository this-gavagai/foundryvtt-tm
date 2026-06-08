import type { ActorPF2e, SpellPF2e } from '@7h3laughingman/pf2e-types'
import type { ResolvedTarget } from './target'

type SpellDamageParams = Record<string, unknown>
type SpellWithDamage = SpellPF2e<ActorPF2e> & {
  getDamage: (params?: SpellDamageParams) => Promise<unknown>
}

function eventCastRank(event: PointerEvent): number | undefined {
  const target = event.target
  if (typeof Element === 'undefined' || !(target instanceof Element)) return undefined

  const element = target.closest<HTMLElement>('[data-cast-rank]')
  const castRank = Number(element?.dataset.castRank)
  return Number.isFinite(castRank) && castRank > 0 ? castRank : undefined
}

function spellVariantForEvent(
  spell: SpellPF2e<ActorPF2e>,
  event: PointerEvent
): SpellPF2e<ActorPF2e> {
  const castRank = eventCastRank(event)
  return castRank
    ? ((spell.loadVariant({ castRank }) as SpellPF2e<ActorPF2e> | null) ?? spell)
    : spell
}

export async function rollSpellDamageWithTarget(
  spell: SpellPF2e<ActorPF2e>,
  event: PointerEvent,
  mapIncreases: 0 | 1 | 2 | undefined,
  targetTokenDoc: ResolvedTarget['tokenDoc']
) {
  const targetedSpell = spellVariantForEvent(spell, event) as SpellWithDamage
  const originalGetDamage = targetedSpell.getDamage.bind(targetedSpell)

  targetedSpell.getDamage = (params: SpellDamageParams = {}) =>
    originalGetDamage({ ...params, target: targetTokenDoc })

  try {
    return await targetedSpell.rollDamage(event, mapIncreases)
  } finally {
    targetedSpell.getDamage = originalGetDamage
  }
}
