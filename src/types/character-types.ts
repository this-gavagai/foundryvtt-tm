import type { CharacterPF2e, ElementalBlast as PF2eElementalBlast, RawModifier } from '@7h3laughingman/pf2e-types'

// Tablemate enriches the raw Foundry actor with extra fields during parseActorData:
//   - activeRules: rules that the actor's items have which are currently active
//   - elementalBlasts: a serialized snapshot of the actor's ElementalBlast helper
//   - languages: language slugs localized Foundry-side (the actor stores bare slugs)
//   - proficiencyLabels: slug→localized label for weapon/armor/classDC proficiencies
//   - inventory.labels: a precomputed name lookup for items + subitems
// These don't exist on CharacterPF2e from the upstream type package, so we extend it here.

export type SpellcastingModifierData = {
  mod: number
  modifiers: RawModifier[]
}

export type TablemateCharacter = CharacterPF2e & {
  activeRules?: string[]
  elementalBlasts?: PF2eElementalBlast
  languages?: string[]
  proficiencyLabels?: Record<string, string>
  spellcastingModifiers?: Record<string, SpellcastingModifierData>
  rollOptionLabels?: Record<string, string>
  iwrLabels?: Record<string, string>
  inventory: CharacterPF2e['inventory'] & { labels?: Record<string, string | undefined> }
}
