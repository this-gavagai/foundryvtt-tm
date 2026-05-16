import type { CharacterPF2e, ElementalBlast as PF2eElementalBlast } from '@7h3laughingman/pf2e-types'

// Tablemate enriches the raw Foundry actor with three fields during parseActorData:
//   - activeRules: rules that the actor's items have which are currently active
//   - elementalBlasts: a serialized snapshot of the actor's ElementalBlast helper
//   - inventory.labels: a precomputed name lookup for items + subitems
// These don't exist on CharacterPF2e from the upstream type package, so we extend it here.

export type TablemateCharacter = CharacterPF2e & {
  activeRules?: string[]
  elementalBlasts?: PF2eElementalBlast
  inventory: CharacterPF2e['inventory'] & { labels?: Record<string, string | undefined> }
}
