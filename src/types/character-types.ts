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

// The trimmed modifier shape sent over the wire (see serializeModifier in the
// Foundry handler). A subset of PF2e's RawModifier — enough for the client to
// render the breakdown and run its stacking simulation.
export type SerializedModifier = {
  slug?: string
  label?: string
  modifier?: number
  enabled?: boolean
  hideIfDisabled?: boolean
  type?: RawModifier['type']
  critical?: boolean
  // True for modifiers declared on the action itself (e.g. Steal's "Object
  // pocketed or protected") rather than inherited from the skill statistic.
  fromAction?: boolean
  // For conditional action modifiers, the roll option(s) that enable them (from
  // the modifier's predicate, e.g. ["action:steal:pocketed"]). Toggling the
  // modifier on adds these to the action's roll; empty for always-on or
  // auto-evaluated (negated-predicate) modifiers. See useCharacterSkillActions.
  enableOptions?: string[]
}

// One rollable statistic option for a skill action. Single-skill actions have
// exactly one; multi-skill actions (e.g. Recall Knowledge) have several. The
// `modifier` is the fully-resolved total and `modifiers` its breakdown — both
// already include feat/item bonuses scoped to this action via `action:<slug>`
// roll-option predicates, which the bare skill modifier omits.
export type SkillActionStatistic = {
  statistic: string
  label: string
  modifier: number
  modifiers: SerializedModifier[]
}

// A skill action serialized Foundry-side from the live action registry
// (game.pf2e.actions). `rollOptions` are replayed as extraRollOptions on the
// actual roll so the rolled number matches the previewed `modifier`.
export type SkillActionData = {
  slug: string
  label: string
  cost?: string
  traits: string[]
  rollOptions: string[]
  statistics: SkillActionStatistic[]
}

export type TablemateActorExtras = {
  activeRules?: string[]
  elementalBlasts?: PF2eElementalBlast
  languages?: string[]
  proficiencyLabels?: Record<string, string>
  spellcastingModifiers?: Record<string, SpellcastingModifierData>
  rollOptionLabels?: Record<string, string>
  iwrLabels?: Record<string, string>
  skillActions?: SkillActionData[]
  inventory?: Partial<CharacterPF2e['inventory']> & { labels?: Record<string, string | undefined> }
}

export type TablemateCharacter = CharacterPF2e & TablemateActorExtras
export type TablemateFamiliar = FamiliarPF2e & TablemateActorExtras
export type TablemateActor = TablemateCharacter | TablemateFamiliar
