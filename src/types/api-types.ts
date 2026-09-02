import type { ItemPF2e, RawDamageDice, RawModifier } from '@7h3laughingman/pf2e-types'
// Value import (not `import type`): TM's literal constants are used as
// computed property keys in ResponseByAction below.
import { TM } from '@/api/protocol'
import type { ChatReaction } from '@/utils/chatReactions'
import type { ChatComment } from '@/utils/chatComments'
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
  | RequestTargetsArgs
  | UpdateActorArgs
  | RollCheckArgs
  | CharacterActionArgs
  | CastSpellArgs
  | SelectSpellVariantArgs
  | ConsumeItemArgs
  | GetStrikeDamageArgs
  | ShareTargetsArgs
  | SendChatMessageArgs
  | SendVoiceMemoArgs
  | SendImageArgs
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
  | SetHitPointsArgs
  | NextTurnArgs
  | RerollChatRollArgs
  | ToggleReactionArgs
  | SetCommentArgs
  | RegisterPushArgs

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
  // Additive feature flags the module supports (see CAPABILITY_* in
  // protocol.ts). Optional/absent on modules predating the handshake; the app
  // treats a missing capability as unsupported and hides the affordance.
  capabilities?: string[]
  // The world's resolved dynamic token ring spritesheet. Only the Foundry
  // client can resolve it: the world setting names a ring ID, and modules
  // register their own rings. Absent on modules predating the field, and on
  // worlds where the ring framework never initialized — avatars then render
  // without rings.
  tokenRing?: { spritesheet?: string }
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
// No payload beyond the requester's userId: the module derives worldId from
// game.world.id and binds it to the (self-reported) userId when minting the
// registration token, so there is nothing for the client to supply.
export interface RegisterPushArgs {
  action: typeof TM.REGISTER_PUSH
  uuid: string
  userId: string
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
  //
  // `itemId`/`usage` are the chat-card form of the same identity: a posted
  // strike card names its strike as "<itemId>.<slug>.<melee|ranged>" and has no
  // index to give, so the module resolves the usage instead (see StrikeRef).
  strike: {
    actionSlug: string
    variant: number
    altUsage?: number
    itemId?: string
    usage?: 'melee' | 'ranged'
  }
  damage: {
    actionSlug: string
    degree: 'damage' | 'critical'
    altUsage?: number
    itemId?: string
    usage?: 'melee' | 'ranged'
  }
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
  // `overlayIds` names the spell-variant overlays the roll is made under (the
  // variant a posted chat card was switched to). Absent for a plain sheet roll,
  // which is always the base spell.
  spellAttack: {
    entryId: string
    spellId?: string
    attackNumber?: number
    castingRank?: number
    overlayIds?: string[]
  }
  spellDamage: {
    spellId: string
    mapIncreases: 0 | 1 | 2
    castingRank?: number
    overlayIds?: string[]
  }
  perception: undefined
  familiarAttack: undefined
  initiative: undefined
  flat: undefined
  // The recovery check a dying creature attempts. No subtype: PF2e derives the
  // DC and the outcome notes from the actor's own dying track, so the request
  // carries nothing but the actor. See foundry/handlers/checks/recovery.ts.
  recovery: undefined
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
  targetScene?: string
  item?: ItemPF2e | null
  diceResults: DiceResults
}
// `targetScene` accompanies `targets` on every targeted request. Token ids are
// unique per SCENE, not per world, so a bare id list is only half an address —
// the module used to guess `scenes.active` at all five resolution sites, which
// is wrong whenever the targeting client is viewing a scene that isn't the
// active one (routine during prep, and normal play for a split party). The
// value is the targeting client's own currently-drawn canvas, carried through
// from ShareTargetsArgs.sceneId. Optional throughout: a pre-protocol-4 app omits
// it and the module falls back to the active scene, i.e. the old behaviour.
export interface CharacterActionArgs {
  action: typeof TM.CHARACTER_ACTION
  userId: string
  characterId: string
  targets: string[]
  targetScene?: string
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
  // Spell-variant overlays chosen at cast time. The slot is spent by the normal
  // cast either way; these decide which version the resulting card shows.
  overlayIds?: string[]
  uuid: string
  targets: string[]
  targetScene?: string
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
  // See CastSpellArgs.
  overlayIds?: string[]
  targets: string[]
  targetScene?: string
  uuid: string
}
// A tap on one of a spell card's variant buttons. `overlayIds` comes straight
// off the button's data-overlay-ids; an empty list means the "base variant"
// button, which reverts the card to the un-overlaid spell.
export interface SelectSpellVariantArgs {
  action: typeof TM.SELECT_SPELL_VARIANT
  userId: string
  characterId: string
  messageId: string
  overlayIds: string[]
  // Optional: the rank the card was cast at. A chat-card click reads it off the
  // card's own data-cast-rank; the post-cast picker omits it, and the module
  // takes it from the message's origin flags instead.
  castRank?: number
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
  // Deliberately NO targets. A damage preview describes what this weapon or
  // spell does, not what it does to a particular creature, so it must not shift
  // as the mirrored target changes. PF2e agrees for the headline numbers: a
  // `getFormula: true` call sets its roll context's `viewOnly`, which nulls the
  // target actor outright — the target these requests used to carry only ever
  // reached the modifiers list. Dropping it makes the whole preview consistent,
  // and takes it off the path where a stale mirror could refuse it.
  altUsage: number | undefined
  // Chat-card form of the strike identity — see the `strike` check subtype.
  itemId?: string
  usage?: 'melee' | 'ranged'
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
  // Spell-variant overlays the preview should be computed under — see the
  // spellDamage check subtype. Absent for a base-spell preview.
  overlayIds?: string[]
  // No targets — see GetStrikeDamageArgs.
  modifierOverrides?: Record<string, boolean>
  uuid: string
}
// One client describing its OWN targeting, pushed whenever it changes and in
// reply to REQUEST_TARGETS. Not a table-wide map: the whole-table form could
// only ever be built by re-reading `user.targets` on some other client, which
// is a set of placed Tokens on THAT client's canvas — so any target outside its
// currently-drawn scene silently vanished from the report.
export interface ShareTargetsArgs {
  action: typeof TM.SHARE_TARGETS
  // The user whose targeting this describes — always the sender's own id.
  userId: string
  // The scene those token ids live on: the sender's currently-drawn canvas.
  // Null when the sender has no canvas up (no scene viewed), in which case
  // `targets` is necessarily empty.
  sceneId: string | null
  targets: string[]
}

// What the app currently mirrors from its targeting proxy. Kept as one value so
// the ids and the scene they belong to are always read together — pairing an id
// list with a scene from a different update would resolve to the wrong tokens,
// or to none. Lives here rather than in the store so the api layer can name it
// without importing Pinia (see api/storeBridge.ts).
export interface MirroredTargets {
  sceneId: string | null
  tokenIds: string[]
}

export interface RequestTargetsArgs {
  action: typeof TM.REQUEST_TARGETS
  userId: string
  // Whose targeting the asker wants. Every client checks this against its own
  // id and only the named one answers, so a table of tablets mirroring one
  // display doesn't provoke a reply from every other client.
  proxyId: string
}
export interface SendChatMessageArgs {
  action: typeof TM.SEND_CHAT_MESSAGE
  userId: string
  characterId: string
  content: string
  // When set, the message speaks as the player (their login user's name)
  // rather than in-character as the actor.
  outOfCharacter?: boolean
  uuid: string
}
// One chunk of a voice memo. The app slices the recorded audio into raw byte
// ranges, base64-encodes each independently (so the GM can concatenate the
// decoded bytes without base64-padding seams), and sends one of these per
// slice — all sharing `uploadId`, numbered `seq` of `total`. The GM
// accumulates them and, on the final chunk, uploads the file and creates the
// chat message. Metadata (mimeType/durationMs/content/outOfCharacter/whisper)
// is echoed on every chunk; the GM keeps the first chunk's copy.
export interface SendVoiceMemoArgs {
  action: typeof TM.SEND_VOICE_MEMO
  userId: string
  characterId: string
  // Client-generated id shared by every chunk of one recording.
  uploadId: string
  // 0-based chunk index and total chunk count.
  seq: number
  total: number
  // base64 of this chunk's raw bytes (NOT of a base64 substring).
  chunkBase64: string
  // Container MIME type of the whole clip, e.g. 'audio/mp4' or 'audio/webm'.
  mimeType: string
  durationMs: number
  // Optional text caption shown alongside the player.
  content?: string
  // Speak as the player rather than in-character (mirrors SendChatMessageArgs).
  outOfCharacter?: boolean
  // Whisper command targets for a private memo — the same 'gm' / '[Name]'
  // tokens the text path sends, resolved server-side; omitted/empty = public.
  whisper?: string[]
  // The sending app transcribes its own memos (see api/transcription.ts) and
  // patches the text onto the posted message a moment later. This flag says a
  // transcript is on its way, and is stored on the message so the push notifier
  // knows to hold the notification briefly for it — the module itself no longer
  // has any transcription configuration to consult.
  transcriptPending?: boolean
  uuid: string
}
// One chunk of an uploaded image. Mirrors SendVoiceMemoArgs exactly (shared
// chunked-upload mechanism) — the app slices the prepared image bytes into raw
// byte ranges, base64-encodes each independently, and sends one per slice, all
// sharing `uploadId`. The GM reassembles and, on the final chunk, uploads the
// file and creates the chat message. See foundry/handlers/chat.ts.
export interface SendImageArgs {
  action: typeof TM.SEND_IMAGE
  userId: string
  characterId: string
  // Client-generated id shared by every chunk of one image.
  uploadId: string
  // 0-based chunk index and total chunk count.
  seq: number
  total: number
  // base64 of this chunk's raw bytes (NOT of a base64 substring).
  chunkBase64: string
  // MIME type of the (possibly re-encoded) image, e.g. 'image/jpeg'.
  mimeType: string
  // Pixel dimensions of the prepared image, so the GM can size the <img> and the
  // app can reserve space without a reflow. Omitted if they couldn't be read.
  width?: number
  height?: number
  // Optional text caption shown alongside the image.
  content?: string
  // Speak as the player rather than in-character (mirrors SendChatMessageArgs).
  outOfCharacter?: boolean
  // Whisper command targets for a private image — the same 'gm' / '[Name]'
  // tokens the text path sends, resolved server-side; omitted/empty = public.
  whisper?: string[]
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
  targetScene?: string
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
  // Target token IDs on `targetScene` — resolved to Token objects and passed in
  // the macro's execution scope as `token` (first) and `targets` (all), and
  // presented as `game.user.targets` for the duration of the macro, so one
  // written against the ambient set picks them up too.
  targets: string[]
  targetScene?: string
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

// A manual hit-point edit. `value` is the ABSOLUTE hit points the sheet asked
// for, not a delta: the GM side derives the delta from live actor state, so two
// players nudging the same NPC can't compound a stale local number. `temp` is
// sent only when the form actually changed it — an absent field means "leave
// temporary hit points alone", which is not the same as sending 0.
export interface SetHitPointsArgs {
  action: typeof TM.SET_HIT_POINTS
  uuid: string
  userId: string
  characterId: string
  value?: number
  temp?: number
}

// "End turn" from the app's header turn bar.
//
// `actorId` is the actor the requester claims the turn belongs to — their own
// character — and is what the 'owner' authorization gate checks. It is NOT
// enough on its own: owning an actor says nothing about whose turn it is, so the
// handler additionally requires that actor to BE the current combatant (a GM may
// end anyone's turn, as they can in Foundry).
//
// `combatId`, `round` and `turn` describe the turn the player was looking at
// when they tapped. Requests are dispatched one at a time and a tap can queue
// behind a slow roll, so by the time this runs the turn may already have
// advanced — without the check, a late tap would skip the NEXT player's turn.
// The handler refuses a request that no longer matches the live encounter.
export interface NextTurnArgs {
  action: typeof TM.NEXT_TURN
  uuid: string
  userId: string
  actorId: string
  combatId: string
  round: number
  turn: number
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

// Toggle the requesting user's emoji reaction on a chat message. No
// characterId: reactions are the player's, not a character's, so this is the one
// chat action authorized as 'world-user' rather than against actor ownership
// (see AUTH_POLICY in foundry/listener.ts). The handler derives the reactor from
// `userId` and never accepts a reaction set from the client, so a client can't
// react on another user's behalf or clear anyone else's reactions.
export interface ToggleReactionArgs {
  action: typeof TM.TOGGLE_REACTION
  uuid: string
  userId: string
  messageId: string
  // Must be one of REACTION_EMOJI (utils/chatReactions.ts); the handler rejects
  // anything else rather than storing arbitrary strings in the flag.
  emoji: string
}

// Write, edit, or remove one comment on a chat message. Like a reaction this
// belongs to the player rather than a character, so there is no characterId to
// test ownership against and the wire-level requirement is only 'world-user':
// anyone in the world may comment on any message. The one rule that remains —
// only a comment's author (or a GM) may rewrite it — is a property of the stored
// comment, so the handler enforces it (see foundry/handlers/comments.ts).
export interface SetCommentArgs {
  action: typeof TM.SET_COMMENT
  uuid: string
  userId: string
  messageId: string
  // Omitted to add a new comment; set to edit or remove the one it names. A
  // commentId the message doesn't carry is an error, not a silent add — it means
  // the comment was deleted under the editor, and quietly re-adding it would
  // undo someone else's removal.
  commentId?: string
  // The comment's text, sanitized again on the Foundry side (trimmed, capped at
  // COMMENT_MAX_LENGTH). Empty removes the named comment — which is why remove
  // needs no separate action.
  text: string
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
  targetScene?: string
  uuid: string
}

// One rolled die of a result, as Foundry's Roll reports it: the face count and
// the individual results of that term.
//
// NOT DiceResults, which this field used to be typed as. DiceResults travels the
// other way — face counts the app pre-seeds for a roll it is asking Foundry to
// make — and the mismatch meant both the producer (foundry/utils/roll.ts,
// handlers/actionHandlers.ts) and the consumer (RollResultModal.vue) had to
// assert their way past the declared type.
export interface RolledDie {
  faces: number
  results: { result: number }[]
}

export interface RollResult {
  formula: string
  result: string
  total: number
  dice: RolledDie[]
  isSecret: boolean
}

// PF2e's four degrees of success, in its own spelling (DEGREE_OF_SUCCESS_STRINGS).
// Declared here rather than imported from pf2e-types because it is a WIRE value:
// the module writes it, the app reads it, and it must keep meaning the same
// thing across a system upgrade that renames the system-side type.
export type DegreeOfSuccess = 'criticalFailure' | 'failure' | 'success' | 'criticalSuccess'

// What a roll was aimed at and how it came out, read off the chat card PF2e
// posted for it (flags.pf2e.context — see foundry/utils/rollOutcome.ts).
//
// Every field is independently optional, because each is independently
// WITHHELD: PF2e hides a DC, a target's name, or a degree of success from
// players according to the world's metagame settings, and the module applies
// those same rules before putting anything on the wire rather than sending it
// all and trusting the app to hide it. A field that is absent was either not
// part of the roll (an untargeted skill check has no target) or is not this
// user's to see — the app draws what it is given and says nothing about the
// rest.
export interface RollOutcome {
  // The targeted token's name and art, when the roll had a target.
  targetName?: string
  targetImg?: string
  // The DC rolled against, and PF2e's label for it ("AC", "Reflex DC", "DC"),
  // localized in the WORLD's language like every other label the module sends.
  dc?: number
  dcLabel?: string
  // The degree of success. Only ever set for a roll that HAD a DC — PF2e also
  // stamps `outcome: "success"` on the damage roll that follows an attack,
  // where it means "not a critical" rather than a degree of success, and
  // showing that as a result would be a lie.
  degree?: DegreeOfSuccess
  // The degree before a degree-of-success adjustment (Assurance, an effect that
  // upgrades a success to a critical). Only set when it differs from `degree`.
  unadjustedDegree?: DegreeOfSuccess
  // Which wording the degree takes: an attack roll reads Hit/Miss, everything
  // else Success/Failure. PF2e's own dc.scope.
  scope?: 'attack' | 'check'
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
  // messageId names the chat card the roll posted, when it can be identified —
  // it is what lets the roll-result modal offer a comment on the roll it is
  // showing. Absent when the pipeline posted nothing the module could match to
  // this request (see chatCapture.ts), and every consumer treats it as optional.
  //
  // `outcome` names the target and the degree of success, for the roll-result
  // modal. Like messageId it is read off the posted card, so it is absent
  // whenever that card could not be identified — and its own fields are absent
  // when the roll had no target, no DC, or the world hides them from this user.
  [TM.ROLL_CHECK]: { roll?: RollResult; messageId?: string; outcome?: RollOutcome }
  [TM.CHARACTER_ACTION]: { roll?: RollResult; outcome?: RollOutcome }
  [TM.FREE_ROLL]: { roll: RollResult }
  [TM.ROLL_DAMAGE]: { roll?: RollResult; messageId?: string; outcome?: RollOutcome }
  [TM.ROLL_INLINE_CHECK]: { roll?: RollResult; messageId?: string; outcome?: RollOutcome }
  [TM.REROLL_CHAT_ROLL]: { roll?: RollResult }
  [TM.GET_STRIKE_DAMAGE]: { response: StrikeDamagePreview }
  [TM.GET_SPELL_DAMAGE]: { response: SpellDamagePreview }
  [TM.GET_COMPENDIUM_ITEM]: { compendiumItem: CompendiumItemData | null }
  [TM.LIST_COMPENDIA]: { compendia: CompendiumPackInfo[] }
  [TM.GET_COMPENDIUM_INDEX]: { compendiumIndex: CompendiumIndexEntry[] }
  // The chat card the cast posted, when one was captured — lets the app offer
  // the spell's variants for that card. Absent when the cast produced no card.
  [TM.CAST_SPELL]: { messageId?: string }
  // As CAST_SPELL: the card the cast posted, so the app can offer the spell's
  // variants for it. A staff spell is not a real actor item, but its card still
  // resolves back to a spell document, so the variant rewrite works on it.
  [TM.CAST_STAFF_SPELL]: { messageId?: string }
  [TM.SELECT_SPELL_VARIANT]: PlainAck
  [TM.CONSUME_ITEM]: PlainAck
  [TM.SEND_CHAT_MESSAGE]: PlainAck
  // The final chunk's ack reports the message the memo was posted as, so the
  // sender can patch its transcript onto it once transcription finishes (it is
  // the message's author, so it can write that update itself over the socket).
  // Intermediate chunks ack with neither field.
  [TM.SEND_VOICE_MEMO]: { messageId?: string; content?: string }
  [TM.SEND_IMAGE]: PlainAck
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
  [TM.SET_HIT_POINTS]: PlainAck
  [TM.NEXT_TURN]: PlainAck
  // The updated reaction list, so the caller can reconcile its optimistic write
  // against what the GM actually stored (concurrent taps, a rejected emoji).
  [TM.TOGGLE_REACTION]: { reactions: ChatReaction[] }
  // The updated comment list, so the caller reconciles against what the GM
  // actually stored (a concurrent edit, a comment someone removed while this one
  // was being typed).
  [TM.SET_COMMENT]: { comments: ChatComment[] }
  [TM.REGISTER_PUSH]: { regToken: string; relayUrl: string }
}

// The client-initiated RPC actions (everything with a typed response).
export type RpcAction = keyof ResponseByAction

// Every key that appears in any member of a union of object types.
type KeysOfUnion<U> = U extends unknown ? keyof U : never

// Flatten a union of object types into one object where every key that appears
// in ANY member is optional and typed as the union of that key's value across
// the members that carry it (members without the key contribute `never`, which
// drops out of the union).
type MergeUnion<U> = {
  [K in KeysOfUnion<U>]?: U extends unknown ? (K extends keyof U ? U[K] : never) : never
}

// Widened "any RPC response" bag used only by the ack-queue plumbing, which
// stores resolvers for heterogeneous in-flight requests in one map. DERIVED
// from ResponseByAction so it can't drift when a new response field is added
// — this was a hand-maintained mirror before. Call sites never see it;
// sendAction narrows per action via ResponseByAction.
export type RequestResolutionArgs = AcknowledgementArgs & MergeUnion<ResponseByAction[RpcAction]>

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
