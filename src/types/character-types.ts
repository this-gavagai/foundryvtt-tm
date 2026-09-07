import type { Ref } from 'vue'
import type {
  CharacterPF2e,
  ElementalBlast as PF2eElementalBlast,
  FamiliarPF2e,
  NPCPF2e,
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
  // The entry's prepared spell DC. Absent from older Foundry-side builds, and
  // only meaningfully different from the entry's stored `spelldc.dc` for an
  // elite/weak-adjusted NPC.
  dc?: number
  // Trimmed on the wire (see buildSpellcastingModifiers Foundry-side) — the
  // full RawModifier never crosses the socket.
  modifiers: SerializedModifier[]
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
  // Both are inputs to PF2e's stacking contest, which the client re-runs every
  // time a player toggles a modifier. Without them that re-run is a different
  // calculation from the one the server will do: `force` decides the `ability`
  // contest outright, and `ignored` marks a modifier from an unequipped or
  // uninvested item, which enters no contest at all.
  force?: boolean
  ignored?: boolean
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

// One named variant of a skill action (Create a Diversion's Distracting Words
// / Gesture / Trick, Perform's Acting / Comedy / …). PF2e refuses to roll an
// action that declares more than one variant unless the use() call names one,
// so the app has to offer the choice — see StatBox's sub-variant chips.
// `traits` and `cost` are the variant's own (they override the action's).
export type SkillActionVariant = {
  slug: string
  label: string
  traits: string[]
  cost?: string
}

// A skill action serialized Foundry-side from the live action registry
// (game.pf2e.actions). `rollOptions` are replayed as extraRollOptions on the
// actual roll so the rolled number matches the previewed `modifier`.
// The half of a skill action that is the same for every character in the world:
// what the action IS, out of PF2e's own registry. Keyed by slug and published
// once per label-catalog stamp rather than resent per character — it was 69KB of
// a 277KB payload, repeated verbatim on every refresh.
export type SkillActionRegistryEntry = {
  label: string
  cost?: string
  traits: string[]
  rollOptions: string[]
  variants?: SkillActionVariant[]
  description?: string
}

export type SkillActionRegistry = Record<string, SkillActionRegistryEntry>

export type SkillActionData = {
  slug: string
  // Everything below `slug` except `statistics` is REGISTRY data and is now
  // optional on the wire: a current module leaves it out and sends the catalog
  // instead. Kept in the type because a module predating that still fills it in,
  // and the app prefers whatever the payload actually carries.
  label?: string
  cost?: string
  traits?: string[]
  rollOptions?: string[]
  statistics: SkillActionStatistic[]
  // Present only when the action declares more than one variant — exactly the
  // case where PF2e requires one to be named at roll time.
  variants?: SkillActionVariant[]
  // Enriched HTML description pulled Foundry-side from the pf2e.actionspf2e
  // compendium (keyed by slug). Rendered client-side via ParsedDescription.
  // Absent for actions with no matching compendium item (e.g. homebrew).
  description?: string
}

// One container's live capacity, resolved Foundry-side from PF2e's own
// ContainerPF2e getters rather than re-derived from item source data: what a
// container is holding right now is only knowable from the prepared document,
// and PF2e counts it the same stack-, size- and subitem-aware way the Bulk
// meter counts an inventory. Keyed by container item id in
// `inventory.containers`.
export type ContainerCapacity = {
  // Bulk of everything stowed inside, as PF2e counts it.
  value: number
  // The container's declared capacity in Bulk. Zero for a container that
  // doesn't stow (a sheath, a quiver): PF2e gives those no capacity of their
  // own and counts their contents against the wearer directly.
  max: number
  // PF2e's own fill percentage — light-unit based up to 100%, whole-Bulk based
  // beyond it (Container#percentFull) — so the app doesn't re-derive it.
  percentFull: number
  // Bulk this container is negating for its wearer right now. PF2e drops it to
  // zero while the container is over capacity, and for an extradimensional
  // container stowed inside another one.
  ignored: number
  // What it negates when nothing has suspended it (system.bulk.ignored). The
  // two differ exactly when the negation has lapsed.
  ignoredMax: number
}

// Deliberately no label maps here any more. Every slug → display-name lookup
// now goes through stores/labelCatalogs, which holds ONE copy for the world and
// keeps it across sessions — so a label no longer depends on this particular
// actor having been serialized by a GM. See utils/labelCache.ts.
export type TablemateActorExtras = {
  activeRules?: string[]
  elementalBlasts?: PF2eElementalBlast
  spellcastingModifiers?: Record<string, SpellcastingModifierData>
  skillActions?: SkillActionData[]
  inventory?: Partial<CharacterPF2e['inventory']> & {
    labels?: Record<string, string | undefined>
    // Container id → capacity. Absent on module builds predating the field,
    // which is why every reader treats a missing entry as "no readout".
    containers?: Record<string, ContainerCapacity>
  }
}

export type TablemateCharacter = CharacterPF2e & TablemateActorExtras
export type TablemateFamiliar = FamiliarPF2e & TablemateActorExtras
export type TablemateNpc = NPCPF2e & TablemateActorExtras
export type TablemateActor = TablemateCharacter | TablemateFamiliar | TablemateNpc

// The ref shape the API layer accepts: any tablemate actor, possibly not yet
// loaded. RPCs only serialize `_id` (see fromActor in actionRpc), so callers
// must ensure the actor is loaded before invoking — the same contract the old
// Ref<CharacterPF2e> signatures implied via casts at every call site.
export type TablemateActorRef = Ref<TablemateActor | null | undefined>
