import type { ActorPF2e, SpellPF2e } from '@7h3laughingman/pf2e-types'
import type { GetSpellDamageArgs } from '@/types/api-types'
import { useBackgroundRoll } from '../backgroundRoll'
import { getCharacter, getGame, makeAck } from '../utils/foundry'
import { findSpell } from '../utils/spellLookup'
import { withDamageModifierOverrides, type ModifierOverrideMap } from './checks/modifierOverrides'

export async function foundryGetSpellDamage(args: GetSpellDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  const targetTokenDoc = args.targets?.map((t) => source.scenes.active?.tokens.get(t))[0] ?? null
  const baseSpell = findSpell(actor, args.spellId)
  // getDamage reads `this.rank` (which honours system.location.heightenedLevel),
  // so we ask PF2e for a heightened variant via loadVariant. Per the PF2e source
  // (item/spell/document.ts), loadVariant returns null only when castRank
  // equals the spell's current rank — that's exactly the no-op case where the
  // base spell already has the right rank, so falling back to baseSpell is
  // correct.
  const spell = args.castingRank
    ? ((baseSpell?.loadVariant({ castRank: args.castingRank }) as
        | SpellPF2e<ActorPF2e>
        | undefined) ?? baseSpell)
    : baseSpell
  type SpellGetDamageOpts = {
    target?: typeof targetTokenDoc
    skipDialog?: boolean
    rollMode?: 'roll' | 'publicroll' | 'gmroll' | 'blindroll' | 'selfroll'
  }
  type SpellGetDamage = (opts: SpellGetDamageOpts) => Promise<{
    template?: {
      damage?: { roll?: { formula?: string }; breakdown?: string[] }
      modifiers?: unknown[]
    }
  } | null>
  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll()
  registerBackgroundRoll()
  const overrides = (args as { modifierOverrides?: ModifierOverrideMap }).modifierOverrides
  const getDamage = () =>
    (spell!.getDamage as unknown as SpellGetDamage)({
      target: targetTokenDoc,
      skipDialog: true,
      rollMode: 'blindroll'
    })
  const sd = spell ? await withDamageModifierOverrides(overrides, getDamage) : null
  const baseline = spell && overrides && Object.keys(overrides).length ? await getDamage() : sd
  unregisterBackgroundRoll()
  return {
    ...makeAck(args),
    response: {
      formula: sd?.template?.damage?.roll?.formula ?? null,
      breakdown: sd?.template?.damage?.breakdown ?? [],
      modifiers: baseline?.template?.modifiers ?? []
    }
  }
}
