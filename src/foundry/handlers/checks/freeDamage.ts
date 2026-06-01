import { rollDamageFormulaToMessage } from '@/foundry/utils/roll'
import type { CheckRollHandler } from './types'

// PF2e patches Foundry's TextEditor with TextEditorPF2e at boot (see
// pf2e/src/scripts/set-game-pf2e.ts) and exposes it on game.pf2e.TextEditor.
// Its static _onClickInlineRoll is the single entry point for inline-damage
// clicks: it reads dataset attributes off an anchor, resolves the source item
// via `htmlClosest(anchor, "[data-item-uuid]")`, and dispatches through
// augmentInlineDamageRoll → DamagePF2e.roll for the full chat-card pipeline
// (action glyph, trait pills, item-context modifiers, materials, runes,
// NPC elite/weak adjustments). Mirroring that path here saves us from
// reimplementing flavor HTML.
declare const game: {
  user: { settings: { showDamageDialogs?: boolean } }
  pf2e: {
    TextEditor: { _onClickInlineRoll: (event: PointerEvent) => Promise<unknown> }
  }
}
declare const Hooks: {
  once: (event: string, cb: (msg: { rolls?: unknown[] }) => void) => number
  off: (event: string, id: number) => void
}

// Build the synthetic anchor PF2e expects on a click event. Wrapping it in a
// `[data-item-uuid]` parent lets _onClickInlineRoll's UUID fallback path find
// the source item via fromUuidSync without needing an open sheet or chat
// message. `damage-roll` (any presence) routes through the augmented pipeline;
// `base-formula` is what augmentInlineDamageRoll parses into terms.
//
// shiftKey is set from the GM's showDamageDialogs setting so that PF2e's
// eventToRollParams (pf2e/src/module/sheet/helpers.ts:140) always resolves
// to `skipDialog: true` — the tablet user is the one initiating the roll and
// the Foundry-side roll-config dialog would just block the GM's screen with
// no way to interact from the tablet. eventToRollParams logic:
//   skipDefault = !user.settings.showDamageDialogs
//   skipDialog  = shiftKey ? !skipDefault : skipDefault
// Setting shiftKey to skipDefault's inverse makes both branches yield true.
function makeInlineAnchorEvent(
  formula: string,
  itemUuid: string,
  traits: string[]
): PointerEvent {
  const wrapper = document.createElement('div')
  wrapper.dataset.itemUuid = itemUuid
  const anchor = document.createElement('a')
  anchor.dataset.formula = formula
  anchor.dataset.baseFormula = formula
  anchor.dataset.damageRoll = ''
  // PF2e's native @Damage enricher (text-editor.ts:742-746) combines any
  // explicit `traits:` params with the source item's own traits and writes
  // them to `data-traits`. _onClickInlineRoll then surfaces those as
  // context.traits in augmentInlineDamageRoll → rendered as the "action trait"
  // pill row in the chat card. The item-trait pill row is rendered separately
  // by DamagePF2e.roll from context.self.item, so without data-traits set we
  // get the item row only (and the chat card looks subtly different from a
  // native click on the same anchor).
  if (traits.length) anchor.dataset.traits = traits.join(',')
  wrapper.appendChild(anchor)
  const event = new PointerEvent('click', { shiftKey: !!game.user.settings.showDamageDialogs })
  Object.defineProperty(event, 'target', { value: anchor, configurable: true })
  return event
}

// Arbitrary inline damage roll from an @Damage[...] in a description. The
// formula is fully client-resolved in ParsedDescription before reaching here.
// When the source item is known (the typical case), we route through PF2e's
// inline-roll click handler so the chat card is indistinguishable from a
// native click on the same anchor. Without an item, fall back to a bare
// DamageRoll → toMessage path (no item header / trait pills, but the dice
// still post with proper damage typing).
//
// _onClickInlineRoll's augment branch awaits DamagePF2e.roll but doesn't
// return its ChatMessage (pf2e/src/module/system/text-editor.ts:185-189), so
// to surface the DamageRoll back to the tablemate result modal we capture it
// via a one-shot createChatMessage hook installed around the call.
export const handleFreeDamage: CheckRollHandler = async ({ actor, args }) => {
  const formula = args.checkSubtype
  const itemId = (args.options as { itemId?: string } | undefined)?.itemId
  const item = itemId ? actor.items.get(itemId) : null
  if (!item) return rollDamageFormulaToMessage(formula, actor)

  let resolveMessage: ((msg: { rolls?: unknown[] } | undefined) => void) | undefined
  const messagePromise = new Promise<{ rolls?: unknown[] } | undefined>((resolve) => {
    resolveMessage = resolve
  })
  const hookId = Hooks.once('createChatMessage', (msg) => resolveMessage?.(msg))
  // Safety timeout: if the augment pipeline bails out (e.g. augmentInlineDamageRoll
  // returns null on an unparsable formula), no message will fire — don't hang.
  const timeoutId = setTimeout(() => {
    Hooks.off('createChatMessage', hookId)
    resolveMessage?.(undefined)
  }, 5000)

  const traits = (item.system as { traits?: { value?: string[] } } | undefined)?.traits?.value ?? []
  const event = makeInlineAnchorEvent(formula, item.uuid, traits)
  await game.pf2e.TextEditor._onClickInlineRoll(event)
  const message = await messagePromise
  clearTimeout(timeoutId)
  return message?.rolls?.[0]
}
