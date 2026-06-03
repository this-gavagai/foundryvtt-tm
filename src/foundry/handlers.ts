// Barrel re-exports. Each handler lives in its own module under handlers/;
// the listener (and any other importer) keeps using `from './handlers'`
// without caring about the internal layout.
//
//   handlers/
//     actions.ts            characterAction, sendItemToChat, freeRoll
//     castSpell.ts          castSpell, castStaffSpell, consumeItem
//     characterDetails.ts   getCharacterDetails (+ serialization helpers)
//     equipment.ts          setWeaponLoaded, setWeaponDamageType, toggleKineticAura
//     getSpellDamage.ts     getSpellDamage formula preview
//     getStrikeDamage.ts    getStrikeDamage formula preview
//     rollCheck.ts          rollCheck orchestrator + dispatch map
//     rollDamage.ts         inline @Damage + side-menu damage roll
//     rollInlineCheck.ts    inline @Check with target-defense routing
//     runMacro.ts           generic macro execution by UUID
//     checks/               one file per check kind (strike, blast, …)

export {
  foundryCharacterAction,
  foundryFreeRoll,
  foundrySendItemToChat
} from './handlers/actions'
export {
  foundryCastSpell,
  foundryCastStaffSpell,
  foundryConsumeItem
} from './handlers/castSpell'
export { getCharacterDetails } from './handlers/characterDetails'
export {
  foundrySetWeaponDamageType,
  foundrySetWeaponLoaded,
  foundryToggleKineticAura
} from './handlers/equipment'
export { foundryGetSpellDamage } from './handlers/getSpellDamage'
export { foundryGetStrikeDamage } from './handlers/getStrikeDamage'
export { foundryRollCheck } from './handlers/rollCheck'
export { foundryRollDamage } from './handlers/rollDamage'
export { foundryRollInlineCheck } from './handlers/rollInlineCheck'
export { foundryRunMacro } from './handlers/runMacro'
export { foundryRunActionable } from './handlers/runActionable'
