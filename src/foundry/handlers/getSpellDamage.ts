import type { GetSpellDamageArgs, SpellDamagePreview } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { getCharacter, getGame, makeAck } from '../utils/foundry'
import { findSpell, loadSpellVariant } from '../utils/spellLookup'
import { withDamageModifierOverrides, type ModifierOverrideMap } from './checks/modifierOverrides'

export async function foundryGetSpellDamage(args: GetSpellDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  // No target — a damage preview describes the spell, not a victim, so it must
  // not shift as the mirrored target changes. See GetStrikeDamageArgs.
  // getDamage reads `this.rank` (which honours system.location.heightenedLevel)
  // and the applied overlays, so the preview has to be taken from the same
  // variant the roll will use — otherwise a card switched to "Heal (vs. Living)"
  // previews the base spell's dice and the picker offers the wrong ones.
  const spell = loadSpellVariant(findSpell(actor, args.spellId), {
    castRank: args.castingRank,
    overlayIds: args.overlayIds
  })
  const overrides = (args as { modifierOverrides?: ModifierOverrideMap }).modifierOverrides
  // No rollMode. It used to be passed here as 'blindroll', but getDamage posts
  // no chat message — it builds and returns the damage data — so there was never
  // a message for a roll mode to apply to, and pf2e 8.4.1 does not read the
  // field at all. Dropped rather than translated to its replacement
  // (messageMode), which would likewise govern a message this never creates.
  const getDamage = () => spell!.getDamage({ skipDialog: true })
  const { sd, baseline } = await withBackgroundRoll(undefined, async () => {
    const sd = spell ? await withDamageModifierOverrides(overrides, getDamage) : null
    const baseline = spell && overrides && Object.keys(overrides).length ? await getDamage() : sd
    return { sd, baseline }
  })
  // Typed local so the wire contract's field names/arity stay
  // compiler-checked; only `modifiers` is asserted — it carries live PF2e
  // Modifier/DamageDice instances.
  const response: SpellDamagePreview = {
    formula: sd?.template?.damage?.roll?.formula ?? null,
    breakdown: sd?.template?.damage?.breakdown ?? [],
    modifiers: (baseline?.template?.modifiers ?? []) as SpellDamagePreview['modifiers']
  }
  return { ...makeAck(args), response }
}
