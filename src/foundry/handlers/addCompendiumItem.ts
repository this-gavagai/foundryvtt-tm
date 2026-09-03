import type { AddCompendiumItemArgs, GetItemChoicesArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'
import { resolveUuid } from '../globals'
import {
  compendiumPackIdFromUuid,
  getRequestingUser,
  userCanObservePack
} from '../utils/permissions'
import { CHOICES_UNANSWERABLE, applyChoiceSelections, pendingItemChoices } from './itemChoices'

// The permission-checked source data behind a compendium uuid. Shared by both
// handlers below so the pack-observe rule is stated once — a player must not be
// able to read an item out of a GM-only pack by asking what it would choose, any
// more than by adding it.
async function resolveCompendiumSource(
  source: ReturnType<typeof getGame>,
  itemUuid: string,
  userId: string
): Promise<Record<string, unknown>> {
  // Only copy items out of a compendium the requesting user may observe, and
  // only from an Item pack — otherwise a player could pull items from GM-only
  // packs, or embed a non-Item document, via a crafted UUID.
  // Throw instead of acking success on every refused/failed path below: a
  // plain ack would make the app show an item that was never added.
  const packId = compendiumPackIdFromUuid(itemUuid)
  const pack = packId ? source.packs.get(packId) : undefined
  const user = getRequestingUser(source, userId)
  if (!packId || !pack || !user || !userCanObservePack(pack, user)) {
    logger.warn('TM-ADD-COMPENDIUM-ITEM: not permitted or not a compendium uuid', itemUuid)
    throw new Error(`compendium item not permitted or not a compendium uuid: ${itemUuid}`)
  }
  if (pack.documentName !== 'Item') {
    logger.warn('TM-ADD-COMPENDIUM-ITEM: not an Item pack', itemUuid)
    throw new Error(`not an Item pack: ${itemUuid}`)
  }

  const doc = await resolveUuid(itemUuid)
  if (!doc) {
    logger.warn('TM-ADD-COMPENDIUM-ITEM: could not resolve', itemUuid)
    throw new Error(`compendium item could not be resolved: ${itemUuid}`)
  }
  return doc.toObject() as Record<string, unknown>
}

function itemName(itemData: Record<string, unknown>): string {
  return typeof itemData.name === 'string' ? itemData.name : 'This item'
}

// "What would adding this item ask me to choose?" Read-only — creates nothing.
export async function foundryGetItemChoices(args: GetItemChoicesArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const itemData = await resolveCompendiumSource(source, args.itemUuid, args.userId)
  // The answers so far go on before inflating, so a ChoiceSet whose options are
  // built from an earlier one resolves against a real selection rather than a
  // null.
  applyChoiceSelections(itemData, args.selections)
  return { ...makeAck(args), choices: await pendingItemChoices(actor, itemData) }
}

export async function foundryAddCompendiumItem(args: AddCompendiumItemArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const itemData = await resolveCompendiumSource(source, args.itemUuid, args.userId)

  if (args.spellcastingEntryId && itemData.type === 'spell') {
    const system = (itemData.system ?? {}) as Record<string, unknown>
    const location = (system.location ?? {}) as Record<string, unknown>
    itemData.system = { ...system, location: { ...location, value: args.spellcastingEntryId } }
  }

  // The player's answers, written into the source so PF2e's ChoiceSet finds a
  // selection already there and never opens its dialog (see itemChoices.ts).
  applyChoiceSelections(itemData, args.selections)

  // Anything still unanswered would stop the creation pipeline on THIS client —
  // the elected GM's — and ask them to make the requesting player's choice, with
  // nothing on the dialog saying whose it is. Worse, dismissing it leaves PF2e to
  // mark the rule ignored, so the item lands silently broken.
  //
  // Refuse instead. The app has already had its chance to ask (GET_ITEM_CHOICES),
  // so reaching here means either a question it could not put to the player (a
  // drop-only ChoiceSet) or a stale app that does not know to ask at all. Both
  // are better as a visible failure naming the item.
  const pending = await pendingItemChoices(actor, itemData)
  if (pending.length) {
    const unanswered = pending.map((choice) => choice.label || choice.flag).join(', ')
    logger.warn('TM-ADD-COMPENDIUM-ITEM: refusing an item with unanswered choices', unanswered)
    throw new Error(`${CHOICES_UNANSWERABLE}: ${itemName(itemData)} needs a choice (${unanswered})`)
  }

  await actor.createEmbeddedDocuments('Item', [itemData])
  return makeAck(args)
}
