import type { ItemPF2e, RawDamageDice, RawModifier } from '@7h3laughingman/pf2e-types'
// Value import (not `import type`): TM's literal constants are used as
// computed property keys in ResponseByAction below.
import { TM } from '@/api/protocol'
import type {
  SkillActionData,
  SpellcastingModifierData,
  TablemateActor,
  TablemateActorExtras
} from '@/types/character-types'

export type ModuleEventArgs =
  | AcknowledgementArgs
  | ListenderOnlineArgs
  | UpdateCharacterDetailsArgs
  | RequestCharacterDetailsArgs
  | AnybodyHomeArgs
  | UpdateActorArgs
  | RollCheckArgs
  | CharacterActionArgs
  | CastSpellArgs
  | ConsumeItemArgs
  | GetStrikeDamageArgs
  | ShareTargetsArgs
  | SendChatMessageArgs
  | SendItemToChatArgs
  | SetWeaponLoadedArgs
  | SetWeaponDamageTypeArgs
  | ToggleKineticAuraArgs
  | AttachItemArgs
  | DetachItemArgs
  | CastStaffSpellArgs
  | FreeRollArgs
  | RollDamageArgs
  | RollInlineCheckArgs
  | RunMacroArgs
  | RunActionableArgs
  | GetSpellDamageArgs
  | GetCompendiumItemArgs
  | AddCompendiumItemArgs
  | ListCompendiaArgs
  | GetCompendiumIndexArgs
  | SendCompendiumItemToChatArgs
  | ApplyDamageArgs
  | RerollChatRollArgs

export interface AcknowledgementArgs {
  action: typeof TM.ACK
  uuid: string
  userId: string
  // Set by the Foundry side when the handler threw (or the request was
  // refused — see the TM_ERROR_* sentinels in protocol.ts). When present, the
  // app-side ack queue rejects the pending request with this message instead
  // of resolving it, so a failed handler surfaces as a rejected promise
  // rather than a 30s timeout indistinguishable from "the GM is slow".
  error?: string
}
// World-scoped GM policy for rolls that arrive with player-determined dice
// faces (manual picker or Pixel dice):
//   'allow'  — honour them (default)
//   'flag'   — honour them, but tag the resulting chat message so the GM can
//              see the result was supplied by the player
//   'reject' — refuse the roll with a TM_ERROR_MANUAL_ROLLS_DISABLED error ack
export type ManualRollPolicy = 'allow' | 'flag' | 'reject'

export interface ListenderOnlineArgs {
  action: typeof TM.LISTENER_ONLINE
  userId: string
  // Wire-protocol version + human-readable module release, stamped by the
  // Foundry side. Optional because a module predating the version handshake
  // omits them — the app reads `protocol === undefined` as incompatible.
  protocol?: number
  moduleVersion?: string
  // Manual-roll policy of the announcing world. Optional because a module
  // predating the setting omits it — the app treats undefined as 'allow'.
  manualRollPolicy?: ManualRollPolicy
}
export interface UpdateCharacterDetailsArgs {
  action: typeof TM.UPDATE_CHARACTER
  actorId: string
  // Fields below are sent as live objects (not pre-stringified). socket.io
  // handles wire serialization itself; the Foundry side runs a single
  // JSON.parse(JSON.stringify(...)) pass on elementalBlasts only, to break
  // its circular `actor` reference and shrink nested `item` references.
  //
  // `actor`/`system` state the CLIENT-facing contract: the shapes
  // parseActorData merges into its TablemateActor model. The Foundry side
  // serializes from source data (actor.toObject() plus prepared-value
  // overlays), which the upstream instance types can't describe, so it casts
  // once at its return site — the single seam where source and prepared
  // shapes meet.
  actor: Partial<TablemateActor>
  system: Partial<TablemateActor['system']>
  languages: string[]
  proficiencyLabels: Record<string, string>
  inventory: TablemateActorExtras['inventory']
  activeRules: string[]
  elementalBlasts: TablemateActorExtras['elementalBlasts'] | null
  spellcastingModifiers: Record<string, SpellcastingModifierData>
  rollOptionLabels: Record<string, string>
  traitLabels: Record<string, string>
  iwrLabels: Record<string, string>
  skillActions: SkillActionData[]
  uuid: string
  userId: string
}
export interface RequestCharacterDetailsArgs {
  action: typeof TM.REQUEST_CHARACTER
  userId: string
  actorId: string
  uuid: string
}
export interface AnybodyHomeArgs {
  action: typeof TM.ANYBODY_HOME
  userId: string
  // Wire-protocol version + human-readable app release, stamped by the browser.
  // Optional because an app predating the version handshake omits them — the
  // Foundry side reads `protocol === undefined` as incompatible.
  protocol?: number
  appVersion?: string
}
export interface UpdateActorArgs {
  action: typeof TM.UPDATE_ACTOR
  userId: string
  actorId: string
  update: object
  uuid: string
}
export interface CheckModifier {
  label: string
  modifier: number
  enabled: boolean
  ignored: boolean
}

// Typed check-target payloads, keyed by RollCheckArgs.checkType. Replaces the
// old comma-packed positional strings (e.g. 'longsword,1,' for a strike) that
// every handler decoded with split(','). The client's rollCheck() is generic
// over this map, so each call site is checked against its own shape; the
// module's checkSubtypeOf() narrows by checkType and still decodes the legacy
// string form sent by pre-protocol-3 apps.
export interface CheckSubtypeByType {
  // MAP variant index (0/1/2) + alt-usage index into strike.altUsages.
  strike: { actionSlug: string; variant: number; altUsage?: number }
  damage: { actionSlug: string; degree: 'damage' | 'critical'; altUsage?: number }
  blast: { element: string; damageType: string; variant: number; isMelee: boolean }
  blastDamage: {
    element: string
    damageType: string
    outcome: 'success' | 'criticalSuccess'
    isMelee: boolean
  }
  skill: { slug: string }
  skillAction: { slug: string }
  save: { slug: string }
  // entryId alone = entry-level attack (the spellcasting-entry modal);
  // spellId + attackNumber (1/2/3 = MAP 0/-5/-10) for per-spell attack buttons.
  spellAttack: { entryId: string; spellId?: string; attackNumber?: number }
  spellDamage: { spellId: string; mapIncreases: 0 | 1 | 2; castingRank?: number }
  perception: undefined
  familiarAttack: undefined
  initiative: undefined
  flat: undefined
}
export type CheckType = keyof CheckSubtypeByType
export type CheckSubtype = CheckSubtypeByType[CheckType]

// Blast damage-formula lookup target (GET_STRIKE_DAMAGE). Pre-protocol-3 apps
// packed this into actionSlug as 'blast:element,damageType,isMelee'.
export interface BlastDamageQuery {
  element: string
  damageType: string
  isMelee: boolean
}

export interface RollCheckArgs {
  action: typeof TM.ROLL_CHECK
  userId: string
  characterId: string
  checkType: CheckType
  checkSubtype: CheckSubtype
  modifiers: CheckModifier[]
  // Free-form options bag spread into PF2e's StatisticRollParameters by the
  // foundry-side handler. Server-side handlers may also pull out the
  // following well-known keys for app-side use:
  //   modifierOverrides: { [slug]: enabled } — per-roll toggles applied to
  //     existing modifiers on the statistic. See foundry/handlers/checks/
  //     modifierOverrides.ts for the mutation semantics.
  options: object
  uuid: string
  targets?: string[]
  item?: ItemPF2e | null
  diceResults: DiceResults
}
export interface CharacterActionArgs {
  action: typeof TM.CHARACTER_ACTION
  userId: string
  characterId: string
  targets: string[]
  characterAction: string
  diceResults: DiceResults
  options: object
  modifierOverrides?: Record<string, boolean>
  statisticSlug?: string
  uuid: string
}
export interface CastSpellArgs {
  action: typeof TM.CAST_SPELL
  userId: string
  id: string
  characterId: string
  rank: number
  slotId: number
  uuid: string
  targets: string[]
}
export interface FreeRollArgs {
  action: typeof TM.FREE_ROLL
  userId: string
  characterId: string
  secret: boolean
  diceResults: DiceResults
  // Optional flat modifier added to the d20 formula (e.g. `1d20+3`).
  modifier?: number
  // Optional display labels attached to the d20 chat message as flavor
  // (e.g. ["Athletics", "Stealth"]). No mechanical effect — purely a tag for
  // the GM/player to identify what the roll was about.
  traits?: string[]
  uuid: string
}
export interface RollDamageArgs {
  action: typeof TM.ROLL_DAMAGE
  userId: string
  characterId: string
  formula: string
  secret: boolean
  diceResults: DiceResults
  // Source-item ID for inline @Damage clicks. When set, the handler routes
  // through PF2e's _onClickInlineRoll pipeline for native chat-card fidelity
  // (item header, trait pills, item-context modifiers, rune/material tags).
  // Without it, falls back to a bare DamageRoll → toMessage.
  itemId?: string
  // Pipe annotations parsed off the inline @Damage[...|key:val|flag] call,
  // stamped onto the synthetic anchor's dataset by the handler.
  damageInline?: Record<string, string | true>
  uuid: string
}
export interface CastStaffSpellArgs {
  action: typeof TM.CAST_STAFF_SPELL
  userId: string
  characterId: string
  staffId: string
  spellId: string
  rank: number
  targets: string[]
  uuid: string
}
export interface ConsumeItemArgs {
  action: typeof TM.CONSUME_ITEM
  userId: string
  characterId: string
  consumableId: string
  options: object
  uuid: string
}
export interface GetStrikeDamageArgs {
  action: typeof TM.GET_STRIKE_DAMAGE
  userId: string
  characterId: string
  // Strike slug; empty when `blast` is set (blasts have no strike action).
  actionSlug: string
  targets: string[]
  altUsage: number | undefined
  modifierOverrides?: Record<string, boolean>
  // Blast lookup target. Pre-protocol-3 apps packed this into actionSlug as
  // 'blast:element,damageType,isMelee' — see blastDamageQueryOf module-side.
  blast?: BlastDamageQuery
  uuid: string
}
export interface GetSpellDamageArgs {
  action: typeof TM.GET_SPELL_DAMAGE
  userId: string
  characterId: string
  spellId: string
  castingRank: number | undefined
  targets: string[]
  modifierOverrides?: Record<string, boolean>
  uuid: string
}
export interface ShareTargetsArgs {
  action: typeof TM.SHARE_TARGETS
  targets: Record<string, string[]>
  userId: string
}
export interface SendChatMessageArgs {
  action: typeof TM.SEND_CHAT_MESSAGE
  userId: string
  characterId: string
  content: string
  uuid: string
}
export interface SendItemToChatArgs {
  action: typeof TM.SEND_ITEM_TO_CHAT
  userId: string
  characterId: string
  itemId: string
  uuid: string
}
export interface SetWeaponLoadedArgs {
  action: typeof TM.SET_WEAPON_LOADED
  userId: string
  characterId: string
  weaponId: string
  loaded: boolean
  ammoId?: string | null
  uuid: string
}
export interface SetWeaponDamageTypeArgs {
  action: typeof TM.SET_WEAPON_DAMAGE_TYPE
  userId: string
  characterId: string
  weaponId: string
  trait: 'versatile' | 'modular'
  selected: string | null
  uuid: string
}
export interface ToggleKineticAuraArgs {
  action: typeof TM.TOGGLE_KINETIC_AURA
  userId: string
  characterId: string
  uuid: string
}

export interface AttachItemArgs {
  action: typeof TM.ATTACH_ITEM
  userId: string
  characterId: string
  // The loose physical item being attached, and the item it attaches to.
  itemId: string
  parentId: string
  uuid: string
}

export interface DetachItemArgs {
  action: typeof TM.DETACH_ITEM
  userId: string
  characterId: string
  // The item that owns the subitem, and the subitem being detached.
  parentId: string
  subitemId: string
  uuid: string
}

export interface RunActionableArgs {
  action: typeof TM.RUN_ACTIONABLE
  userId: string
  characterId: string
  // The action/feat item that carries the toolbelt actionable flag. The
  // handler reads `flags['pf2e-toolbelt'].actionable.linked` (newer toolbelt
  // schema) or `.macro` (legacy) off this item to find the macro UUID, then
  // executes the macro with full toolbelt-style scope:
  // { actor, item, token, targets, use, cancel } — matching what toolbelt's
  // own useAction(actor, action) helper provides.
  itemId: string
  targets: string[]
  uuid: string
}

export interface RunMacroArgs {
  action: typeof TM.RUN_MACRO
  userId: string
  characterId: string
  // Foundry UUID of the macro to execute (e.g.
  // 'Macro.abc123' or 'Compendium.pf2e.action-macros.Macro.xyz').
  // Resolved server-side via fromUuidSync.
  macroUuid: string
  // Target token IDs on the active scene — resolved to Token objects and
  // passed in the macro's execution scope as `token` (first) and `targets`
  // (all). Macros that reference game.user.targets directly will see the
  // GM's UI state instead and won't pick these up.
  targets: string[]
  uuid: string
}

export interface GetCompendiumItemArgs {
  action: typeof TM.GET_COMPENDIUM_ITEM
  uuid: string
  userId: string
  itemUuid: string
}

export interface AddCompendiumItemArgs {
  action: typeof TM.ADD_COMPENDIUM_ITEM
  uuid: string
  userId: string
  characterId: string
  itemUuid: string
  spellcastingEntryId?: string
}

export interface ListCompendiaArgs {
  action: typeof TM.LIST_COMPENDIA
  uuid: string
  userId: string
}

export interface GetCompendiumIndexArgs {
  action: typeof TM.GET_COMPENDIUM_INDEX
  uuid: string
  userId: string
  // Pack collection id, e.g. "pf2e.equipment-srd" (matches game.packs key).
  packId: string
}

export interface SendCompendiumItemToChatArgs {
  action: typeof TM.SEND_COMPENDIUM_ITEM_TO_CHAT
  uuid: string
  userId: string
  characterId: string
  itemUuid: string
}

// One compendium pack as surfaced to the browser's pack list.
export interface CompendiumPackInfo {
  // Collection id used to fetch the index later (game.packs key).
  id: string
  label: string
  // Document type the pack holds: "Item", "Actor", "JournalEntry", …
  documentType: string
  // Owning package: "pf2e", "world", or a module id.
  packageName: string
}

// A single index entry within a pack (enough to render a browse row and open
// the full item via getCompendiumItem(uuid)).
export interface CompendiumIndexEntry {
  uuid: string
  name: string
  img?: string
  type?: string
  level?: number
  rarity?: string
  rarityLabel?: string
}

export type ApplyDamageMode = 'damage' | 'half' | 'double' | 'heal' | 'block'
export type ChatRollRerollMode = 'reroll' | 'hero-point' | 'keep-highest' | 'keep-lowest'

export interface ApplyDamageArgs {
  action: typeof TM.APPLY_DAMAGE
  uuid: string
  userId: string
  characterId: string
  messageId: string
  mode: ApplyDamageMode
  rollIndex?: number
}

export interface RerollChatRollArgs {
  action: typeof TM.REROLL_CHAT_ROLL
  uuid: string
  userId: string
  characterId: string
  messageId: string
  mode: ChatRollRerollMode
  diceResults: DiceResults
  rollIndex?: number
}

export interface RollInlineCheckArgs {
  action: typeof TM.ROLL_INLINE_CHECK
  userId: string
  characterId: string
  // The check slug (e.g. 'spell-attack', 'fortitude', 'reflex', 'will',
  // 'perception', or any custom slug PF2e's getStatistic resolves). Mirrors
  // the inline anchor's data-pf2-check.
  slug: string
  // Defense slug for the target (e.g. 'ac', 'fortitude'). PF2e resolves this
  // against the targeted token's getStatistic(against). Mirrors data-against.
  against?: string
  // Source-item ID — resolved server-side to a UUID and stamped onto
  // data-item-uuid so the inline-check pipeline picks up the right item
  // context (statistic.roll's `item` parameter, action header rendering).
  itemId?: string
  // Pipe annotations parsed off the inline @Check[...|key:val|flag] call
  // (traits, options, name, etc.) — stamped onto the synthetic anchor's
  // dataset by the handler so PF2e's listener reads the same context as it
  // would for a native enriched anchor.
  inline?: Record<string, string | true>
  secret: boolean
  diceResults: DiceResults
  targets: string[]
  uuid: string
}

export interface RollResult {
  formula: string
  result: string
  total: number
  dice: DiceResults
  isSecret: boolean
}

export interface CompendiumItemData {
  _id?: string
  name: string
  img?: string
  type?: string
  source: string
  system: {
    description?: { value?: string }
    traits?: { value?: string[]; rarity?: string }
    level?: { value?: number }
  } & Record<string, unknown>
}

// Damage-formula preview returned by GET_STRIKE_DAMAGE: display formulas for
// the normal/critical outcomes plus the modifier list the formula was built
// from (numeric Modifiers and DamageDice alike), for the override UI.
export interface StrikeDamagePreview {
  damage?: string
  critical?: string
  modifiers?: (RawModifier | RawDamageDice)[]
}

// Damage-formula preview returned by GET_SPELL_DAMAGE. `modifiers` comes from
// the baseline (override-free) computation so the override UI always lists
// the full set; `formula`/`breakdown` reflect the requested overrides.
export interface SpellDamagePreview {
  formula: string | null
  breakdown: string[]
  modifiers: (RawModifier | RawDamageDice)[]
}

// Response payload with no fields beyond the ack itself.
type PlainAck = object

// Per-action response payload a Foundry handler adds to its ack. The client's
// sendAction<K> resolves with AcknowledgementArgs & ResponseByAction[K], and
// the module's ActionHandlerMap pins each handler's return to the same entry
// — so a renamed or dropped response field fails to compile on both ends
// instead of drifting silently. Keys are exactly the client-initiated RPC
// actions; sendAction refuses actions without an entry.
export interface ResponseByAction {
  [TM.ROLL_CHECK]: { roll?: RollResult }
  [TM.CHARACTER_ACTION]: { roll?: RollResult }
  [TM.FREE_ROLL]: { roll: RollResult }
  [TM.ROLL_DAMAGE]: { roll?: RollResult }
  [TM.ROLL_INLINE_CHECK]: { roll?: RollResult }
  [TM.REROLL_CHAT_ROLL]: { roll?: RollResult }
  [TM.GET_STRIKE_DAMAGE]: { response: StrikeDamagePreview }
  [TM.GET_SPELL_DAMAGE]: { response: SpellDamagePreview }
  [TM.GET_COMPENDIUM_ITEM]: { compendiumItem: CompendiumItemData | null }
  [TM.LIST_COMPENDIA]: { compendia: CompendiumPackInfo[] }
  [TM.GET_COMPENDIUM_INDEX]: { compendiumIndex: CompendiumIndexEntry[] }
  [TM.CAST_SPELL]: PlainAck
  [TM.CAST_STAFF_SPELL]: PlainAck
  [TM.CONSUME_ITEM]: PlainAck
  [TM.SEND_CHAT_MESSAGE]: PlainAck
  [TM.SEND_ITEM_TO_CHAT]: PlainAck
  [TM.SEND_COMPENDIUM_ITEM_TO_CHAT]: PlainAck
  [TM.SET_WEAPON_LOADED]: PlainAck
  [TM.SET_WEAPON_DAMAGE_TYPE]: PlainAck
  [TM.ATTACH_ITEM]: PlainAck
  [TM.DETACH_ITEM]: PlainAck
  [TM.TOGGLE_KINETIC_AURA]: PlainAck
  [TM.RUN_MACRO]: PlainAck
  [TM.RUN_ACTIONABLE]: PlainAck
  [TM.UPDATE_ACTOR]: PlainAck
  [TM.ADD_COMPENDIUM_ITEM]: PlainAck
  [TM.APPLY_DAMAGE]: PlainAck
}

// The client-initiated RPC actions (everything with a typed response).
export type RpcAction = keyof ResponseByAction

// Widened "any RPC response" shape used only by the ack-queue plumbing, which
// stores resolvers for heterogeneous in-flight requests in one map. Call
// sites never see this type — sendAction narrows per action via
// ResponseByAction.
export type RequestResolutionArgs = AcknowledgementArgs & {
  roll?: RollResult
  response?: StrikeDamagePreview | SpellDamagePreview
  compendiumItem?: CompendiumItemData | null
  compendia?: CompendiumPackInfo[]
  compendiumIndex?: CompendiumIndexEntry[]
}

export interface ActiveRoll {
  action: 'action' | 'check' | 'damage'
  slug?: string
  label?: string
  statisticSlug?: string
  paramsString?: string
  params?: Record<string, string>
  dc?: number
  // Free-form damage formula. Already client-resolved (@item.level / @actor.x
  // substitutions performed in ParsedDescription) so it can be rolled directly.
  formula?: string
  // Source-item ID for inline @Damage clicks. The Foundry handler resolves
  // this to a full item UUID and hands it to PF2e's inline-roll click handler,
  // which renders the chat card identically to a native click — item-name
  // header, action glyph, trait pills, item-context modifiers.
  itemId?: string
  // Pipe annotations parsed off an inline @Damage[...|key:val|flag] call —
  // forwarded verbatim so the handler can stamp each onto the synthetic
  // anchor's dataset (data-traits, data-roll-options, data-domains, data-name,
  // data-immutable, data-override-traits). Values are raw strings; flag-form
  // params arrive as `true`.
  damageInline?: Record<string, string | true>
  // Pipe annotations parsed off an inline @Check[...|key:val|flag] call.
  // Routed through the inline-check pipeline (rollInlineCheck) so the
  // defense (`against`), traits, roll options, and role propagate exactly
  // as they would for a native enriched @Check anchor.
  checkInline?: Record<string, string | true>
  // Defense slug peeled out of the @Check inline params for client-side
  // routing decisions (e.g. only inline-check slugs with `against` need the
  // PF2e listener path; save/skill slugs without `against` can stay on the
  // direct save/skill API).
  against?: string
}

export interface DiceResults {
  d4?: number[]
  d6?: number[]
  d8?: number[]
  d10?: number[]
  d12?: number[]
  d20?: number[]
  d100?: number[]
}

// debugging conveniences
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    socket: any
    actor: any
    world: any
    altActors: any
    altCharacters: any
    link: any
    game: any
    Hooks: any
    character: any
    getBlastData: any
    pixels: any
    __TM_ENV__: any
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
