// Typed access to the globals Foundry injects into the client.
//
// Foundry exposes a curated set of names on globalThis (client/client.mjs:
// `fromUuid`, `Hooks`, `Roll`, `ChatMessage`, `getDocumentClass`, …) plus `game`,
// `ui`, `canvas` and `CONFIG`. This module is the single place that reaches for
// them, so each one has one type instead of one per consumer.
//
// The problem it solves is duplication, not deprecation. Those globals are
// maintained public API in v14, not legacy shims — the names Foundry HAS put on a
// deprecation path (`FilePicker`, `ImagePopout`, the AppV1 classes) go through
// `addBackwardsCompatibilityReferences` and have namespaced homes instead, which
// is why getFilePicker below looks the way it does and the rest don't. What had
// actually gone wrong is that `fromUuid` was declared in five modules with five
// mutually incompatible return types, and `game` in nine with nine partial
// shapes, so "what does this return" had no single answer.
//
// Every accessor reads the global at CALL time, never at module load: these are
// injected while Foundry boots, long after this module is evaluated, and tests
// install their own on globalThis per case.
//
// Deliberately NOT here: the narrow probe shapes in systemCompat.ts. Those exist
// so that a PF2e refactor breaks the feature probe rather than the compile, which
// is the entire point of that file — a precise shared type would defeat it.

import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// ── game ───────────────────────────────────────────────────────────────────

// The live Game instance.
//
// There used to be a `window.game ?? parent.game` dance here for the app running
// inside a Foundry iframe. Nothing on this side is reachable from the app bundle
// (the listener and every handler are Foundry-side only, and listener.ts reads
// the bare global throughout), so the parent-frame branch could never be taken.
export function getGame(): GamePF2e {
  return game
}

// The settings API.
//
// Registration happens once at ready; reads can run before it (a capability
// probe on a world that has never saved the setting), which is why each caller
// wraps its read in try/catch and falls back to a default. Reaching through here
// keeps that behaviour: with no `game` yet, the property access throws exactly as
// the bare global did.
export type SettingsApi = GamePF2e['settings']

export function settingsApi(): SettingsApi {
  return game.settings
}

// ── Documents by UUID ──────────────────────────────────────────────────────

// What every document resolved here has in common, and all most callers touch.
export type AnyDocument = { toObject: () => Record<string, unknown>; uuid?: string }

type UuidResolver = (uuid: string) => Promise<unknown>
type UuidResolverSync = (uuid: string) => unknown

function uuidResolver(): UuidResolver {
  const scope = globalThis as {
    foundry?: { utils?: { fromUuid?: UuidResolver } }
    fromUuid?: UuidResolver
  }
  const resolve = scope.foundry?.utils?.fromUuid ?? scope.fromUuid
  if (!resolve) throw new Error('fromUuid is unavailable in this Foundry client')
  return resolve
}

// Resolve a document by UUID.
//
// Generic because `fromUuid` genuinely is polymorphic — a Macro here, a
// compendium Item there — and the caller is the only one who knows which. Stating
// the expectation at the call site (`resolveUuid<MacroPF2e>(…)`) puts it where the
// assumption lives, instead of five modules each re-declaring the global with a
// different return type and no way to tell they disagreed.
//
// Always the async form. fromUuidSync returns an index STUB for a compendium
// document, which has no `execute()` and only some of the fields — the cause of
// "r.execute is not a function" on any `Compendium.<pack>.Macro.<id>` path.
// `async` so an unavailable resolver becomes a REJECTION rather than a
// synchronous throw. Every caller awaits, so both reach the same catch today, but
// a function typed as returning a promise must not throw before returning one.
export async function resolveUuid<T = AnyDocument>(uuid: string): Promise<T | null> {
  return (await uuidResolver()(uuid)) as T | null
}

// The synchronous form, for the rare caller that has a world-document uuid and
// cannot await. Subject to the compendium-stub caveat above; prefer resolveUuid.
export function resolveUuidSync<T = AnyDocument>(uuid: string): T | null {
  const scope = globalThis as {
    foundry?: { utils?: { fromUuidSync?: UuidResolverSync } }
    fromUuidSync?: UuidResolverSync
  }
  const resolve = scope.foundry?.utils?.fromUuidSync ?? scope.fromUuidSync
  if (!resolve) throw new Error('fromUuidSync is unavailable in this Foundry client')
  return resolve(uuid) as T | null
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export type HooksApi = typeof Hooks

export function hooks(): HooksApi {
  return Hooks
}

// Subscribe to a hook the typings do not enumerate.
//
// Foundry's typings overload `Hooks.on` for the hooks core declares and fall
// back to `(...args: unknown[])` for everything else — which includes the
// document-render hooks this module lives on (renderChatMessageHTML,
// updateChatMessage). A handler that declares what it is actually handed is
// then REJECTED for being narrower than unknown, so every call site would have
// to take `unknown` and re-narrow.
//
// The knowledge that renderChatMessageHTML is handed a chat message is the same
// kind of knowledge as the rest of this file: true of the running client, not
// expressible to the compiler. Stated once here, where the reason can be
// written down, rather than as an assertion at each subscription.
export function onHook<A extends unknown[]>(hook: string, handler: (...args: A) => void): void {
  hooks().on(hook, handler as (...args: unknown[]) => void)
}

// ── Notifications ──────────────────────────────────────────────────────────

// `ui.notifications` is absent until the UI renders, so every method is optional
// and callers use `?.` — a compatibility notice at ready must never be the reason
// startup fails.
export type NotificationsApi = {
  info?: (message: string, options?: object) => void
  warn?: (message: string, options?: object) => void
  error?: (message: string, options?: object) => void
}

export function notifications(): NotificationsApi | undefined {
  return (globalThis as { ui?: { notifications?: NotificationsApi } }).ui?.notifications
}

// ── Chat messages ──────────────────────────────────────────────────────────

// The document class chat messages are created through.
//
// The bare `ChatMessage` global is the BASE class, but Document.createDocuments
// resolves `this.implementation` internally, so creating through it already uses
// the system's configured subclass (ChatMessagePF2e). This exists to give the two
// modules that create messages one declaration rather than two.
// `getSpeaker` is deliberately absent. It resolves scene and token from whatever
// scene THIS client has drawn, which on the elected GM's machine is the GM's own
// view — wrong for a remote player's message and undefined with no scene loaded.
// Everything here builds a speaker with utils/foundry.actorSpeaker instead; not
// declaring the method keeps the canvas-dependent one from being reached for again.
//
// This is a NARROWING of core's ChatMessage, not a redescription of it: the
// return above is a plain assignment, so the compiler checks these two members
// against the real class and the omission of the rest costs nothing.
export type ChatMessageClass = {
  create: (data: object) => Promise<{ id?: string | null; _id?: string | null } | undefined>
  // Core's whisper-recipient lookup: keywords, user names, and the names of
  // users' assigned characters. See handlers/chat.ts.
  getWhisperRecipients: (name: string) => Array<{ id?: string | null; name?: string | null }>
}

export function chatMessageClass(): ChatMessageClass {
  return ChatMessage
}

// ── Items ──────────────────────────────────────────────────────────────────

// The configured Item document class — PF2e's ItemPF2e, not core's Item.
//
// Used to build a TEMPORARY in-memory item parented to an actor, which is how a
// compendium item gets posted to chat: PF2e's toChat() requires an owned item,
// and this satisfies the ownership check without persisting anything.
export type ItemDocumentClass = typeof CONFIG.Item.documentClass

export function itemClass(): ItemDocumentClass {
  return CONFIG.Item.documentClass
}

// ── FilePicker ─────────────────────────────────────────────────────────────

// The one global here that Foundry HAS moved: v13 relocated FilePicker to
// foundry.applications.apps and left the bare name behind as a deprecated
// backwards-compatibility reference. Prefer the namespaced home, fall back to the
// global for v11/v12.
export type FilePickerLike = {
  upload: (
    source: string,
    path: string,
    file: File,
    body?: object,
    options?: object
  ) => Promise<{ path?: string } | false>
  createDirectory: (source: string, target: string, options?: object) => Promise<unknown>
  browse: (source: string, target: string, options?: object) => Promise<unknown>
}

export function getFilePicker(): FilePickerLike {
  const scope = globalThis as {
    foundry?: { applications?: { apps?: { FilePicker?: FilePickerLike } } }
    FilePicker?: FilePickerLike
  }
  const picker = scope.foundry?.applications?.apps?.FilePicker ?? scope.FilePicker
  if (!picker) throw new Error('FilePicker is unavailable in this Foundry client')
  return picker
}

// ── ChatLog ────────────────────────────────────────────────────────────────

// Foundry's own chat-command parser, used so `/w` and friends mean the same thing
// typed on a tablet as typed into Foundry. Relocated in v13 like FilePicker.
export type ChatLogLike = { parse: (message: string) => [string, (string | RegExpMatchArray)[]] }

export function getChatLog(): ChatLogLike | undefined {
  const scope = globalThis as {
    foundry?: { applications?: { sidebar?: { tabs?: { ChatLog?: ChatLogLike } } } }
    ChatLog?: ChatLogLike
  }
  return scope.foundry?.applications?.sidebar?.tabs?.ChatLog ?? scope.ChatLog
}

// ── Localization ───────────────────────────────────────────────────────────

// Localize a key against the WORLD's locale.
//
// This is the Foundry-side half of the app's localization split: character data
// is localized here, where the world's language is authoritative, while the app's
// own UI chrome goes through vue-i18n in the client's language. Every label the
// module puts on the wire is resolved through this.
//
// A key with no translation comes back unchanged, which is Foundry's behaviour and
// what the callers rely on to fall back to a raw slug.
export function localize(key: string): string {
  return game.i18n.localize(key)
}

// Localize a key, falling back to a literal when the system or core does not
// define it.
//
// The module ships no Foundry lang files of its own, so a GM-facing string it puts
// in chat has two imperfect options: hardcode English, or borrow the system's key
// and show a raw "PF2E.Something" to the table if that key is ever renamed —
// Foundry returns the key unchanged when it cannot translate. This takes the
// system's wording (in the world's language, matching the rest of the sheet) when
// the key resolves, and the literal when it does not.
export function localizeOr(key: string, fallback: string): string {
  const text = localize(key)
  return text === key ? fallback : text
}

// ── CONFIG ─────────────────────────────────────────────────────────────────

// The PF2e config bag: slug → localization key dictionaries the label helpers
// read (languages, rarityTraits, weaponCategories, …).
//
// Kept at pf2e-types' own precision rather than flattened to a string record.
// The label helpers do walk it by name, but the names are a fixed list, so
// typing them as `keyof ConfigPF2E` (see utils/labels.ts) turns a dictionary
// PF2e renames into a compile error instead of labels that silently stop
// resolving.
export type ConfigPF2E = ConfigPF2e['PF2E']

export function configPF2E(): ConfigPF2E {
  return CONFIG.PF2E
}

// PF2e's registered Roll subclasses, searched for DamageRoll. See utils/roll.ts.
export function diceRollClasses(): Array<{ name?: string }> {
  const scope = globalThis as { CONFIG?: { Dice?: { rolls?: Array<{ name?: string }> } } }
  return scope.CONFIG?.Dice?.rolls ?? []
}

// ── Canvas ─────────────────────────────────────────────────────────────────

// The id of the scene this client currently has drawn, or null when it has none
// up (a GM on the world setup screen). The only thing anything here needs off the
// canvas: which scene our own targets are on.
export function drawnSceneId(): string | null {
  const scope = globalThis as { canvas?: { scene?: { id?: string } | null } }
  return scope.canvas?.scene?.id ?? null
}
