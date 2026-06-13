import type {
  CharacterPF2e,
  ElementalBlast as PF2eElementalBlast,
  FamiliarPF2e,
  RawModifier
} from '@7h3laughingman/pf2e-types'

// Tablemate enriches the raw Foundry actor with extra fields during parseActorData:
//   - activeRules: rules that the actor's items have which are currently active
//   - elementalBlasts: a serialized snapshot of the actor's ElementalBlast helper
//   - languages: language slugs localized Foundry-side (the actor stores bare slugs)
//   - proficiencyLabels: slug→localized label for weapon/armor/classDC proficiencies
//   - inventory.labels: a precomputed name lookup for items + subitems
// These don't exist on PF2e actor types from the upstream type package, so we
// extend them here. Most extras are optional because slim actor types such as
// familiars don't expose every character convenience Tablemate serializes.

export type SpellcastingModifierData = {
  mod: number
  modifiers: RawModifier[]
}

export type TablemateActorExtras = {
  activeRules?: string[]
  elementalBlasts?: PF2eElementalBlast
  languages?: string[]
  proficiencyLabels?: Record<string, string>
  spellcastingModifiers?: Record<string, SpellcastingModifierData>
  rollOptionLabels?: Record<string, string>
  iwrLabels?: Record<string, string>
  inventory?: Partial<CharacterPF2e['inventory']> & { labels?: Record<string, string | undefined> }
}

export type TablemateCharacter = CharacterPF2e & TablemateActorExtras
export type TablemateFamiliar = FamiliarPF2e & TablemateActorExtras
export type TablemateActor = TablemateCharacter | TablemateFamiliar
