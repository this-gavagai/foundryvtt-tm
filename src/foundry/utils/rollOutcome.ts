// What a roll was aimed at, and how it came out — read off the chat card PF2e
// posted for it and put on the wire for the app's roll-result modal.
//
// The card is the source of truth rather than the handler's own resolved
// targets or the returned Roll, because it is the only place where the numbers
// PF2e ACTUALLY used are all written down together: the DC it compared against
// (which a target-derived modifier or a circumstance bonus may have moved), the
// degree of success after any adjustment, and the target it settled on. A
// second derivation from the request would be a second opinion, and the two
// would disagree exactly where it matters.
//
// The other half of this file's job is deciding what the requesting user is
// allowed to see. The module runs on the elected GM's client, which can read
// everything; the tablet asking for the roll usually belongs to a player, who
// per the world's metagame settings may not see the DC, the result, or even the
// target's name. PF2e enforces that by rendering the card and then hiding parts
// of it from non-GMs. Nothing of the sort is available to us — whatever goes on
// the wire has arrived on the player's device — so each field is withheld HERE,
// by the same rules PF2e applies (CheckPF2e.#createResultFlavor, pf2e 8.4.1),
// and simply absent from the payload when it isn't this user's to see.

import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { DegreeOfSuccess, RollOutcome } from '@/types/api-types'
import { configPF2E, localize, resolveUuidSync, settingsApi } from '../globals'
import { getRequestingUser } from './permissions'
import { rollOutcomeEnabled } from '../featureToggles'
import { tokenPortrait } from '@/utils/tokenPortrait'
import { logger } from '@/utils/utilities'

// PF2e's context flag, at the precision this file reads it. Everything is
// optional: the flag is written by several different pipelines (a statistic
// check, an inline check, a damage roll) and they do not all fill in the same
// fields.
type ContextFlag = {
  dc?: {
    value?: number
    slug?: string | null
    label?: string | null
    scope?: 'attack' | 'check'
    visible?: boolean
  } | null
  target?: { actor?: string | null; token?: string | null } | null
  outcome?: string | null
  unadjustedOutcome?: string | null
}

// The flag bag a roll's chat message carries it in. Exported so chatCapture can
// declare it on the message it hands back without restating the shape.
export type OutcomeFlags = { pf2e?: { context?: ContextFlag | null } | null }

// A chat message as this file needs it. Structural, like the rest of the
// module's Foundry touchpoints: the live document satisfies it, and a test
// passes an object literal.
export type OutcomeMessage = { flags?: OutcomeFlags | null } | null | undefined

// The token/actor documents the target uuids resolve to, at the precision the
// name, art and DC-visibility rules need.
//
// The art fields are the ones tokenPortrait reads, and they are two because a
// dynamic-ring token stores its art twice: the drawn art is
// `ring.subject.texture`, while `texture.src` stays the full-frame portrait.
// Sending the wrong one puts a picture on the modal that is not the thing on
// the canvas.
type TargetTokenLike = {
  name?: string | null
  playersCanSeeName?: boolean
  actor?: TargetActorLike | null
  texture?: { src?: string | null } | null
  ring?: {
    enabled?: boolean | null
    subject?: { texture?: string | null; scale?: number | null } | null
  } | null
}
type TargetActorLike = {
  name?: string | null
  img?: string | null
  hasPlayerOwner?: boolean
  // Foundry's default token for the actor. A target can arrive as an actor with
  // no token document — an unlinked placeable this client cannot resolve — and
  // PF2e falls back to the prototype for the very same name-visibility decision.
  prototypeToken?: TargetTokenLike | null
}

// PF2e's four degrees, in the order of DEGREE_OF_SUCCESS_STRINGS. Used as a
// guard, not a lookup: the flag value is a string PF2e wrote, and an unfamiliar
// one (a system version with a fifth degree) is dropped rather than forwarded
// as a wire value the app has no wording for.
const DEGREES: DegreeOfSuccess[] = ['criticalFailure', 'failure', 'success', 'criticalSuccess']

function asDegree(value: unknown): DegreeOfSuccess | undefined {
  return DEGREES.find((degree) => degree === value)
}

// A PF2e world setting, read defensively: these are registered by the system at
// init and this runs long after, but a setting the system has renamed must cost
// a detail on a modal, not the whole ack.
function pf2eSetting(key: string): boolean {
  try {
    return settingsApi().get('pf2e', key) === true
  } catch {
    return false
  }
}

function contextOf(message: OutcomeMessage): ContextFlag | undefined {
  return message?.flags?.pf2e?.context ?? undefined
}

// PF2e's own name for the DC being rolled against: "AC" for armor class, "Will
// DC" and friends for a save, a bare "DC" for anything unspecific — or the
// context's own label, which an inline @Check can set. Mirrors the derivation
// in #createResultFlavor, including its `ac` → `armor` rename and its trimming
// of the `-dc` suffix a defense slug carries.
//
// Localized here, in the WORLD's language, like every other label the module
// puts on the wire (see globals.localize). The degree of success is not: it
// travels as its slug and the app words it in the reader's own language, the
// way it does the rest of its chrome.
function dcLabel(dc: NonNullable<ContextFlag['dc']>): string | undefined {
  const explicit = dc.label?.trim()
  if (explicit) return localize(explicit)
  const raw = dc.slug ?? null
  const slug = raw === 'ac' ? 'armor' : (raw?.replace(/-dc$/, '') ?? null)
  // Widened by assignment, not asserted: pf2e-types enumerates the specific
  // DCs PF2e ships and the slug here is whatever the roll carried. See
  // labels.ts, which opens the same dictionaries the same way.
  const specific: Record<string, string | undefined> = configPF2E().checkDCs.Specific
  const key = (slug && specific[slug]) || configPF2E().checkDCs.Unspecific
  return localize(key)
}

// The chat card out of a PF2e action pipeline's return value.
//
// `Action#use` resolves to one CheckResultCallback per actor it rolled for, and
// each carries the message it posted — so the character-action route can
// describe its outcome without registering a capture the way the roll handlers
// do. Same array-of-results shape extractRollPayload reads the whisper list off,
// declared the same way: one assertion, at the boundary where PF2e's return type
// is `unknown`.
type ActionResults = { 0?: { message?: OutcomeMessage } | undefined }

export function outcomeMessageOf(result: unknown): OutcomeMessage {
  if (!result || typeof result !== 'object') return undefined
  return (result as ActionResults)[0]?.message
}

// Everything the app is allowed to be told about this roll's target and result,
// or undefined when there is nothing to tell.
//
// `userId` is the user who ASKED for the roll, not the one running the handler:
// a GM rolling from their own tablet sees what they would see on their own
// screen, and a player sees what the world lets players see.
export function describeRollOutcome(
  source: GamePF2e,
  message: OutcomeMessage,
  userId: string
): RollOutcome | undefined {
  try {
    // The world switch, off by default (see featureToggles.ts). This is the only
    // gate the feature needs: the outcome rides the ack rather than being asked
    // for, so an absent object is the whole of "off" — the app's modal renders
    // nothing for it, exactly as when the module is too old to send one. Every
    // roll route funnels through here, so there is one place to check.
    if (!rollOutcomeEnabled()) return undefined

    const context = contextOf(message)
    if (!context) return undefined

    const isGM = !!getRequestingUser(source, userId)?.isGM
    const outcome: RollOutcome = {}

    const tokenUuid = context.target?.token ?? null
    const actorUuid = context.target?.actor ?? null
    const token = tokenUuid ? resolveUuidSync<TargetTokenLike>(tokenUuid) : null
    const targetActor =
      token?.actor ?? (actorUuid ? resolveUuidSync<TargetActorLike>(actorUuid) : null)

    if (token || targetActor) {
      // A token whose name players cannot see stays nameless here, unless the
      // world doesn't play that way at all (nameVisibility off) or the asker is
      // a GM. Its ART still travels: the tablet's own canvas mirror already
      // shows the token it targeted, so withholding the picture of a creature
      // the player is looking at protects nothing.
      // The placed token when we have it, its actor's prototype when we don't:
      // one document answers both the name question and the art question, the
      // way PF2e falls back for the same pair.
      const art = token ?? targetActor?.prototypeToken ?? null
      const nameVisible =
        isGM || !pf2eSetting('metagame_tokenSetsNameVisibility') || !!art?.playersCanSeeName
      const name = token?.name ?? targetActor?.name ?? undefined
      if (nameVisible && name) outcome.targetName = name
      const img = tokenPortrait(art, targetActor?.img ?? undefined).url
      if (img) outcome.targetImg = img
    }

    const dc = context.dc
    if (dc && typeof dc.value === 'number') {
      // PF2e's rule, verbatim: a DC is public when the roll itself says so, when
      // the world shows DCs, or when the creature defending it is a player's.
      const dcVisible =
        isGM || !!dc.visible || pf2eSetting('metagame_showDC') || !!targetActor?.hasPlayerOwner
      if (dcVisible) {
        outcome.dc = dc.value
        outcome.dcLabel = dcLabel(dc)
      }
      // Degree only alongside a DC. PF2e stamps `outcome: "success"` on the
      // damage roll that follows an attack, where it distinguishes normal from
      // critical damage rather than naming a degree of success — reporting that
      // as a result would tell the player their damage roll "succeeded".
      if (isGM || pf2eSetting('metagame_showResults')) {
        const degree = asDegree(context.outcome)
        if (degree) {
          outcome.degree = degree
          outcome.scope = dc.scope
          const unadjusted = asDegree(context.unadjustedOutcome)
          if (unadjusted && unadjusted !== degree) outcome.unadjustedDegree = unadjusted
        }
      }
    }

    return Object.keys(outcome).length ? outcome : undefined
  } catch (error) {
    // A decoration on a modal is never worth failing an ack the player is
    // waiting on: the roll itself already happened and its card is in chat.
    logger.warn('TABLEMATE: could not describe a roll outcome', error)
    return undefined
  }
}
