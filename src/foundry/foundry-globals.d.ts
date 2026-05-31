// (Intentionally minimal.) The narrowed shapes for Roll / DamageRoll / CONFIG /
// Macro / fromUuidSync live as module-scoped `declare` statements at the top
// of each file that uses them. That shadows the wider ambient types pf2e-types
// and foundry-types provide, which is what we want — `declare global` here
// would *merge* with those upstream declarations and fail when our narrow
// shapes don't structurally match.
//
// FoundryRoll and DamageRollCtor are regular exported types — import them from
// utils/roll.ts.

export {}
