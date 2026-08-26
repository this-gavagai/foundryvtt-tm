import type { ActiveRoll } from '@/types/api-types'
import { PF2E_ACTION_STAT_MAP } from '@/utils/constants'

export function compendiumUuidFromClickTarget(target: HTMLElement): string | undefined {
  return (
    target.closest<HTMLElement>('[data-type="compendiumLink"]')?.dataset.uuid ??
    target.closest<HTMLAnchorElement>('a.content-link[data-uuid]')?.dataset.uuid
  )
}

function isItemContentLink(anchor: HTMLAnchorElement): boolean {
  return anchor.dataset.type?.toLowerCase() === 'item' || /\.Item\./.test(anchor.dataset.uuid ?? '')
}

export function compendiumItemUuidFromClickTarget(target: HTMLElement): string | undefined {
  const contentLink = target.closest<HTMLAnchorElement>('a.content-link[data-uuid]')
  if (!contentLink || !isItemContentLink(contentLink)) return undefined
  return contentLink.dataset.uuid
}

function normalizeInlineFormula(formula: string): string {
  const trimmed = formula.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed.slice(1, -1)
  return trimmed
}

function paramsFromString(params: string | undefined): Record<string, string> | undefined {
  if (!params) return undefined
  const parsed = params
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((out, part) => {
      const [key, ...rest] = part.split('=')
      if (key && rest.length) out[key] = rest.join('=')
      return out
    }, {})
  return Object.keys(parsed).length ? parsed : undefined
}

function damageInlineFromAnchor(anchor: HTMLAnchorElement): Record<string, string | true> {
  const inline: Record<string, string | true> = {}
  if (anchor.dataset.traits) inline.traits = anchor.dataset.traits
  if (anchor.dataset.rollOptions) inline.options = anchor.dataset.rollOptions
  if (anchor.dataset.domains) inline.domains = anchor.dataset.domains
  if (anchor.dataset.name) inline.name = anchor.dataset.name
  else if (anchor.dataset.flavor) inline.name = anchor.dataset.flavor
  if ('immutable' in anchor.dataset) inline.immutable = true
  if ('overrideTraits' in anchor.dataset) inline.overrideTraits = true
  return inline
}

function checkInlineFromAnchor(anchor: HTMLAnchorElement): Record<string, string | true> {
  const inline: Record<string, string | true> = {}
  if (anchor.dataset.pf2Traits) inline.traits = anchor.dataset.pf2Traits
  if (anchor.dataset.pf2RollOptions) inline.options = anchor.dataset.pf2RollOptions
  if (anchor.dataset.pf2RepostFlavor) inline.name = anchor.dataset.pf2RepostFlavor
  if (anchor.dataset.pf2Roller) inline.roller = anchor.dataset.pf2Roller
  if (anchor.dataset.rollerRole) inline.rollerRole = anchor.dataset.rollerRole
  if (anchor.dataset.pf2Dc) inline.dc = anchor.dataset.pf2Dc
  if (anchor.dataset.pf2ShowDc) inline.showDC = anchor.dataset.pf2ShowDc
  if (anchor.dataset.pf2Adjustment) inline.adjustment = anchor.dataset.pf2Adjustment
  if ('overrideTraits' in anchor.dataset) inline.overrideTraits = true
  if ('targetOwner' in anchor.dataset) inline.targetOwner = true
  return inline
}

export function activeRollFromInlineRollAnchor(anchor: HTMLAnchorElement): ActiveRoll | undefined {
  if (!('damageRoll' in anchor.dataset)) return undefined
  const rawFormula =
    anchor.dataset.damageRoll || anchor.dataset.baseFormula || anchor.dataset.formula || ''
  const formula = normalizeInlineFormula(rawFormula)
  if (!formula) return undefined
  const damageInline = damageInlineFromAnchor(anchor)
  return {
    action: 'damage',
    formula,
    label: anchor.textContent?.trim() || formula,
    itemId: anchor.dataset.itemId,
    damageInline: Object.keys(damageInline).length ? damageInline : undefined
  }
}

// Action-cost glyph spans (ours and PF2e-native) hold characters like "1" or
// "r" that only read as icons through the Pathfinder2eActions font — they must
// not leak into a text label.
const GLYPH_SPAN_SELECTOR = '.pf2-icon-inline, .pf2-icon, .action-glyph, .activity-glyph'

function textContentWithoutGlyphs(element: HTMLElement): string | undefined {
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll(GLYPH_SPAN_SELECTOR).forEach((glyph) => glyph.remove())
  return clone.textContent?.trim() || undefined
}

export function activeRollFromActionElement(element: HTMLElement): ActiveRoll | undefined {
  const slug = element.dataset.pf2Action
  if (!slug) return undefined
  const label = textContentWithoutGlyphs(element) || slug
  const params: Record<string, string> = {}
  Object.assign(params, paramsFromString(element.dataset.pf2ParamsString))
  if (element.dataset.pf2Variant) params.variant = element.dataset.pf2Variant
  const statisticSlug =
    element.dataset.pf2Stat || element.dataset.pf2Skill || PF2E_ACTION_STAT_MAP[slug] || undefined
  return {
    action: 'action',
    slug,
    label,
    statisticSlug,
    params: Object.keys(params).length ? params : undefined
  }
}

export function activeRollFromInlineCheckAnchor(anchor: HTMLAnchorElement): ActiveRoll | undefined {
  const slug = anchor.dataset.pf2Check
  if (!slug) return undefined
  const inline = checkInlineFromAnchor(anchor)
  const dc =
    typeof inline.dc === 'string' && /^\d+$/.test(inline.dc) ? Number(inline.dc) : undefined
  const against = anchor.dataset.against
  return {
    action: 'check',
    slug,
    label: anchor.textContent?.trim() || slug,
    checkInline: Object.keys(inline).length ? inline : undefined,
    dc,
    against
  }
}

export function activeRollFromFoundryClickTarget(target: HTMLElement): ActiveRoll | undefined {
  const actionElement = target.closest<HTMLElement>('[data-pf2-action]')
  const actionRoll = actionElement ? activeRollFromActionElement(actionElement) : undefined
  if (actionRoll) return actionRoll

  const inlineCheck = target.closest<HTMLAnchorElement>('a.inline-check[data-pf2-check]')
  const checkRoll = inlineCheck ? activeRollFromInlineCheckAnchor(inlineCheck) : undefined
  if (checkRoll) return checkRoll

  const inlineRoll = target.closest<HTMLAnchorElement>('a.inline-roll')
  return inlineRoll ? activeRollFromInlineRollAnchor(inlineRoll) : undefined
}

// --- Chat-card roll buttons --------------------------------------------------
// Buttons PF2e renders inside a posted card that this app knows how to roll.
// Anything else is hidden by the chat-card styles rather than parsed here (see
// main.css), so the set of "supported" is stated once and it is the set the
// user actually sees.
//
// Two card families produce roll buttons, and they name their subject
// differently:
//
//   spell cards  — the cast lives in the message flags (rank + variant
//                  overlays), so the DOM carries nothing but which button.
//   strike cards — the strike is named right on the card, as
//                  data-identifier="<itemId>.<slug>.<melee|ranged>".
//
// The save button is the odd one out in PF2e's own markup: alone among the
// spell-card buttons it carries no data-visibility="owner", because a save is
// rolled by whoever READS the card, against the DC printed on it. That makes it
// an ordinary check for the viewer's own character — which is exactly what an
// inline @Check anchor already is, so it is parsed into one.

// Which strike a card names, as PF2e stamps it. `usage` selects between the
// weapon's melee and ranged forms; the module resolves it against the actor
// (see StrikeRef) because an index into altUsages isn't knowable from here.
export interface StrikeCardRef {
  actionSlug: string
  itemId?: string
  usage?: 'melee' | 'ranged'
}

export type CardRoll =
  // variant doubles as the MAP step: 0 = no penalty, 1 = -5, 2 = -10.
  | { kind: 'spell'; phase: 'attack'; variant: 0 | 1 | 2 }
  | { kind: 'spell'; phase: 'damage' }
  | { kind: 'strike'; phase: 'attack'; variant: 0 | 1 | 2; strike: StrikeCardRef }
  | { kind: 'strike'; phase: 'damage'; critical: boolean; strike: StrikeCardRef }

// PF2e spells hyphenate the MAP suffix; strikes don't. Both are spelled out
// rather than pattern-matched, so an unrecognized action stays unrecognized
// instead of being guessed at.
const SPELL_ATTACK_VARIANT: Record<string, 0 | 1 | 2> = {
  'spell-attack': 0,
  'spell-attack-2': 1,
  'spell-attack-3': 2
}
const STRIKE_ATTACK_VARIANT: Record<string, 0 | 1 | 2> = {
  'strike-attack': 0,
  'strike-attack2': 1,
  'strike-attack3': 2
}

// "<itemId>.<slug>.<melee|ranged>" — see strike-card.hbs. Parsed defensively:
// the slug is the only part the module strictly needs, and a card written by an
// older PF2e (or a module that re-renders one) may carry fewer segments.
function strikeCardRef(target: HTMLElement): StrikeCardRef | undefined {
  const identifier = target.closest<HTMLElement>('.chat-card[data-identifier]')?.dataset.identifier
  if (!identifier) return undefined
  const [itemId, actionSlug, usage] = identifier.split('.')
  if (!actionSlug) return undefined
  return {
    actionSlug,
    itemId: itemId || undefined,
    usage: usage === 'melee' || usage === 'ranged' ? usage : undefined
  }
}

export function cardRollFromClickTarget(target: HTMLElement): CardRoll | undefined {
  const button = target.closest<HTMLButtonElement>('.card-buttons button[data-action]')
  const action = button?.dataset.action
  if (!action || !button) return undefined

  if (action === 'spell-damage') return { kind: 'spell', phase: 'damage' }
  const spellVariant = SPELL_ATTACK_VARIANT[action]
  if (spellVariant !== undefined) return { kind: 'spell', phase: 'attack', variant: spellVariant }

  // A strike card is useless without its identifier — there would be nothing to
  // tell the module which strike to roll — so bail rather than guess.
  const strike = strikeCardRef(target)
  if (!strike) return undefined
  if (action === 'strike-damage') {
    return {
      kind: 'strike',
      phase: 'damage',
      // PF2e writes the outcome on the button; only "success" is the plain
      // damage roll, everything else is the critical one.
      critical: button.dataset.outcome !== 'success',
      strike
    }
  }
  const strikeVariant = STRIKE_ATTACK_VARIANT[action]
  return strikeVariant === undefined
    ? undefined
    : { kind: 'strike', phase: 'attack', variant: strikeVariant, strike }
}

// The save button as an ActiveRoll: `data-save` is the save slug and `data-dc`
// the spell's DC, both stamped by PF2e's spell-card template. No `against` —
// the DC is already resolved, so this takes the direct save path rather than
// the target-defense pipeline.
export function activeRollFromSpellSaveButton(target: HTMLElement): ActiveRoll | undefined {
  const button = target.closest<HTMLButtonElement>('button[data-action="spell-save"]')
  const slug = button?.dataset.save
  if (!slug) return undefined
  const dc = Number(button?.dataset.dc)
  return {
    action: 'check',
    slug,
    label: button?.textContent?.trim() || slug,
    dc: Number.isInteger(dc) && dc > 0 ? dc : undefined
  }
}
