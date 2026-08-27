// (Intentionally minimal.) The narrowed shapes for Roll / DamageRoll / Macro /
// fromUuidSync live as module-scoped `declare` statements at the top of each
// file that uses them. That shadows the wider ambient types pf2e-types and
// foundry-types provide, which is what we want — `declare global` here would
// *merge* with those upstream declarations and fail when our narrow shapes
// don't structurally match.
//
// FoundryRoll and DamageRollCtor are regular exported types — import them from
// utils/roll.ts.
//
// What DOES belong here: gaps in the community type packages, closed by
// augmenting the upstream declaration so every call site is checked against it.
// The alternative — an `as unknown as` at each call site — buys the same compile
// but checks nothing and has to be repeated.
//
// NB the `export {}` is load-bearing. Without a top-level import or export this
// file is a script, and `declare module '…'` in a script declares a NEW ambient
// module instead of augmenting the real one: it silently compiles and does
// nothing. (pf2e-types has one of those, for "foundry-types/client/helpers/
// client-settings.mjs" — note the missing scope — which is why its ClientSettings
// augmentation has no effect.)
export {}

declare module '@7h3laughingman/foundry-types/client/_types.mjs' {
  // Foundry renders a file/folder-picker button beside the text field for a
  // String setting registered with `filePicker`. Long-standing, documented
  // `game.settings.register` API that foundry-types 13.351 does not describe;
  // used by the image-upload and voice-memo path settings.
  interface SettingConfig {
    filePicker?: 'any' | 'audio' | 'folder' | 'image' | 'imagevideo' | 'video'
  }
}
