// Barrel re-exports. Each handler lives in its own module under handlers/;
// the listener (and any other importer) keeps using `from './handlers'`
// without caring about the internal layout.
//
//   handlers/
//     actions.ts            characterAction, callMacro, sendItemToChat, freeRoll
//     castSpell.ts          castSpell, castStaffSpell, consumeItem
//     characterDetails.ts   getCharacterDetails (+ serialization helpers)
//     equipment.ts          setWeaponLoaded, setWeaponDamageType, toggleKineticAura
//     getSpellDamage.ts     getSpellDamage formula preview
//     getStrikeDamage.ts    getStrikeDamage formula preview
//     rollCheck.ts          rollCheck orchestrator + dispatch map
//     checks/               one file per check kind (strike, blast, …)

export {
  foundryCallMacro,
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
