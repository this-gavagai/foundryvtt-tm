import type { RollDamageArgs } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { registerCapture } from '../chatCapture'
import { getGame, makeAck } from '../utils/foundry'
import { extractRollPayload, rollDamageFormulaToMessage } from '../utils/roll'

// Unified entry point for any ad-hoc damage roll the tablet initiates —
// both the side-menu formula builder and inline @Damage[...] clicks. When
// `itemId` is set we route through PF2e's _onClickInlineRoll pipeline so the
// chat card matches a native click on the same anchor (item header, trait
// pills, item-context modifiers, runes, materials, NPC elite/weak
// adjustments). When it isn't, we post a bare DamageRoll → toMessage.
//
// PF2e patches Foundry's TextEditor with TextEditorPF2e at boot (see
// pf2e/src/scripts/set-game-pf2e.ts) and exposes it on game.pf2e.TextEditor.
declare const game: {
  user: { settings: { showDamageDialogs?: boolean } }
  pf2e: {
    TextEditor: { _onClickInlineRoll: (event: PointerEvent) => Promise<unknown> }
  }
}
// Mirrors PF2e's @Damage enricher (text-editor.ts:776-805): combine explicit
// traits with the item's own traits (unless overrideTraits), and stamp the
// rest of the pipe annotations onto the corresponding dataset attributes that
// _onClickInlineRoll reads (text-editor.ts:142-160). Param→dataset mapping:
//   traits         → data-traits          (merged with item.traits unless overridden)
//   options        → data-roll-options    (PF2e renames `options:` to rollOptions)
//   domains        → data-domains
//   name           → data-name
//   immutable      → data-immutable       (flag presence)
//   overrideTraits → data-override-traits (flag presence; also drives merge above)
//
// shiftKey is set from the GM's showDamageDialogs setting so PF2e's
// eventToRollParams (pf2e/src/module/sheet/helpers.ts:140) always yields
// `skipDialog: true` — the tablet user is the one initiating the roll and a
// Foundry-side roll-config dialog would block the GM's screen with no way
// to interact from the tablet. eventToRollParams logic:
//   skipDefault = !user.settings.showDamageDialogs
//   skipDialog  = shiftKey ? !skipDefault : skipDefault
// Setting shiftKey to skipDefault's inverse makes both branches yield true.
// ctrlKey flips messageMode to 'gm'/'blind' for secret rolls.
function makeInlineAnchorEvent(
  formula: string,
  itemUuid: string,
  itemTraits: string[],
  damageInline: Record<string, string | true> | undefined,
  secret: boolean
): PointerEvent {
  const wrapper = document.createElement('div')
  wrapper.dataset.itemUuid = itemUuid
  const anchor = document.createElement('a')
  anchor.dataset.formula = formula
  anchor.dataset.baseFormula = formula
  anchor.dataset.damageRoll = ''

  const overrideTraits = damageInline?.overrideTraits === true
  const paramTraits =
    typeof damageInline?.traits === 'string'
      ? damageInline.traits
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : []
  const mergedTraits = overrideTraits
    ? paramTraits
    : Array.from(new Set([...itemTraits, ...paramTraits]))
  if (mergedTraits.length) anchor.dataset.traits = mergedTraits.join(',')

  if (typeof damageInline?.options === 'string' && damageInline.options) {
    anchor.dataset.rollOptions = damageInline.options
  }
  if (typeof damageInline?.domains === 'string' && damageInline.domains) {
    anchor.dataset.domains = damageInline.domains
  }
  if (typeof damageInline?.name === 'string' && damageInline.name) {
    anchor.dataset.name = damageInline.name
  }
  // Flag-form params are emitted as empty strings on a native enriched anchor
  // (text-editor.ts:796-797: `immutable ? "" : null`). PF2e checks them via
  // `"immutable" in anchor.dataset`, so any present-but-empty value qualifies.
  if (damageInline?.immutable === true) anchor.dataset.immutable = ''
  if (overrideTraits) anchor.dataset.overrideTraits = ''

  wrapper.appendChild(anchor)
  const event = new PointerEvent('click', {
    shiftKey: !!game.user.settings.showDamageDialogs,
    ctrlKey: secret
  })
  Object.defineProperty(event, 'target', { value: anchor, configurable: true })
  return event
}

export async function foundryRollDamage(args: RollDamageArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  const item = args.itemId ? actor.items.get(args.itemId) : null
  const rollMode = args.secret ? 'blindroll' : 'publicroll'

  const rRaw = await withBackgroundRoll(args.diceResults, async () => {
    if (!item) {
      // No item context — post a bare DamageRoll with the requested message
      // visibility. The side-menu formula builder lands here.
      return rollDamageFormulaToMessage(args.formula, actor, { rollMode })
    }
    // _onClickInlineRoll's augment branch awaits DamagePF2e.roll but doesn't
    // return its ChatMessage (text-editor.ts:185-189), so capture it by request
    // uuid: the listener stamps args.uuid onto the message it creates, and
    // registerCapture resolves once that message exists. Its timeout guards
    // against the augment pipeline bailing out silently (e.g.
    // augmentInlineDamageRoll returning null on an unparsable formula).
    const capture = registerCapture(args.uuid)
    const itemTraits =
      (item.system as { traits?: { value?: string[] } } | undefined)?.traits?.value ?? []
    const event = makeInlineAnchorEvent(
      args.formula,
      item.uuid,
      itemTraits,
      args.damageInline,
      args.secret
    )
    await game.pf2e.TextEditor._onClickInlineRoll(event)
    const message = await capture
    return message?.rolls?.[0]
  })

  return {
    ...makeAck(args),
    ...extractRollPayload(rRaw, { userId: args.userId, options: { rollMode } })
  }
}
