import type { RollInlineCheckArgs } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { registerCapture } from '../chatCapture'
import { getGame, makeAck } from '../utils/foundry'
import { extractRollPayload } from '../utils/roll'

// Inline @Check route. Builds a synthetic PF2e inline-check anchor (matching
// the dataset shape produced by TextEditorPF2e.#createSingleCheck) and lets
// PF2e's global click listener resolve everything — statistic lookup,
// target/DC from `against`, traits, roll options, action header. The only
// PF2e API we tickle directly is the listener registered by
// InlineRollLinks.activatePF2eListeners; everything else is data-driven.
//
// Param→dataset mapping (mirrors text-editor.ts:665-686 + inline params):
//   slug             → data-pf2-check
//   against          → data-against
//   itemId (resolved to UUID) → data-item-uuid (drives item context + role)
//   inline.traits    → data-pf2-traits
//   inline.options   → data-pf2-roll-options
//   inline.name      → data-pf2-repost-flavor (chat header text)
//   inline.roller    → data-pf2-roller
//   inline.rollerRole→ data-roller-role
//   inline.overrideTraits (flag) → data-override-traits
//   inline.targetOwner (flag)    → data-target-owner
//
// The anchor must live in the document so the document-level listener fires
// from the bubbled click; we append it hidden, click, then remove on the
// next tick (after PF2e has read the dataset off `event.target`).
function buildAnchor(args: RollInlineCheckArgs, itemUuid: string | undefined): HTMLAnchorElement {
  const anchor = document.createElement('a')
  anchor.classList.add('inline-check')
  anchor.dataset.pf2Check = args.slug
  if (args.against) anchor.dataset.against = args.against
  if (itemUuid) anchor.dataset.itemUuid = itemUuid

  const inline = args.inline ?? {}
  if (typeof inline.traits === 'string' && inline.traits) {
    anchor.dataset.pf2Traits = inline.traits
  }
  if (typeof inline.options === 'string' && inline.options) {
    anchor.dataset.pf2RollOptions = inline.options
  }
  if (typeof inline.name === 'string' && inline.name) {
    anchor.dataset.pf2RepostFlavor = inline.name
  }
  if (typeof inline.roller === 'string' && inline.roller) {
    anchor.dataset.pf2Roller = inline.roller
  }
  if (typeof inline.rollerRole === 'string' && inline.rollerRole) {
    anchor.dataset.rollerRole = inline.rollerRole
  }
  if (typeof inline.dc === 'string' && inline.dc) {
    anchor.dataset.pf2Dc = inline.dc
  }
  if (typeof inline.showDC === 'string' && inline.showDC) {
    anchor.dataset.pf2ShowDc = inline.showDC
  }
  if (typeof inline.adjustment === 'string' && inline.adjustment) {
    anchor.dataset.pf2Adjustment = inline.adjustment
  }
  // Flag-form params: present-but-empty dataset entry (PF2e checks with `in`).
  if (inline.overrideTraits === true) anchor.dataset.overrideTraits = ''
  if (inline.targetOwner === true) anchor.dataset.targetOwner = ''

  // Hidden so it doesn't flash visibly during the click round-trip.
  anchor.style.position = 'fixed'
  anchor.style.left = '-9999px'
  anchor.style.top = '-9999px'
  anchor.setAttribute('aria-hidden', 'true')
  return anchor
}

export async function foundryRollInlineCheck(args: RollInlineCheckArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = args.itemId ? actor.items.get(args.itemId) : null

  const message = await withBackgroundRoll(args.diceResults, async () => {
    const anchor = buildAnchor(args, item?.uuid)
    document.body.appendChild(anchor)

    // PF2e's listener doesn't return the ChatMessage; capture it by request
    // uuid (see rollDamage.ts / chatCapture.ts). The capture's timeout guards
    // against the click resolving no message.
    const capture = registerCapture(args.uuid)

    // ctrlKey flips the roll to blindroll via PF2e's eventToRollParams; shiftKey
    // honours the user's dialog setting (suppressing the GM-side roll dialog
    // since the tablet user can't interact with it).
    const event = new PointerEvent('click', {
      bubbles: true,
      cancelable: true,
      shiftKey: !!source.user.settings['showDamageDialogs'],
      ctrlKey: args.secret
    })
    anchor.dispatchEvent(event)

    try {
      return await capture
    } finally {
      // Anchor's job is done — remove it once PF2e has read the dataset.
      anchor.remove()
    }
  })

  const rollMode = args.secret ? 'blindroll' : 'publicroll'
  return {
    ...makeAck(args),
    ...extractRollPayload(message?.rolls?.[0], { userId: args.userId, options: { rollMode } })
  }
}
