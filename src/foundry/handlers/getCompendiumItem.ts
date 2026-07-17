import type { CompendiumItemData, GetCompendiumItemArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'
import {
  compendiumPackIdFromUuid,
  getRequestingUser,
  userCanObservePack
} from '../utils/permissions'

interface CompendiumDocObject {
  _id?: string
  name?: string
  img?: string
  type?: string
  system?: Record<string, unknown>
  // Journals: a JournalEntry serializes its pages as an array; a single
  // JournalEntryPage serializes its own `text.content` directly.
  pages?: JournalPageObject[]
  text?: { content?: string }
}

interface JournalPageObject {
  name?: string
  type?: string
  text?: { content?: string }
}

declare function fromUuid(uuid: string): Promise<{
  toObject(): CompendiumDocObject
} | null>

// Journal documents don't carry a `system.description.value` — their rich HTML
// lives in `text.content` (a single JournalEntryPage) or across
// `pages[].text.content` (a whole JournalEntry). Fold that into the description
// shape the client already renders, so journal links display like any other
// compendium entry. Returns undefined for non-journal documents so Items pass
// through untouched.
function journalDescriptionHtml(obj: CompendiumDocObject): string | undefined {
  if (typeof obj.text?.content === 'string') return obj.text.content
  if (!Array.isArray(obj.pages)) return undefined
  const pages = obj.pages.filter(
    (page): page is JournalPageObject => typeof page?.text?.content === 'string'
  )
  if (!pages.length) return ''
  const withHeadings = pages.length > 1
  return pages
    .map((page) =>
      withHeadings && page.name ? `<h2>${page.name}</h2>${page.text!.content}` : page.text!.content
    )
    .join('\n')
}

export async function foundryGetCompendiumItem(args: GetCompendiumItemArgs) {
  const source = getGame()
  const emptyAck = { ...makeAck(args), compendiumItem: null }

  // Only compendium documents are exposed, and only from a pack the requesting
  // user may observe — fromUuid on the GM client would otherwise resolve world
  // or actor-embedded documents (and GM-only packs) past player permissions.
  // UUID shape: Compendium.<scope>.<pack>.<type>.<id>
  // e.g. Compendium.pf2e.conditionitems.Item.xyz → pack id "pf2e.conditionitems"
  const packId = compendiumPackIdFromUuid(args.itemUuid)
  const pack = packId ? source.packs.get(packId) : undefined
  const user = getRequestingUser(source, args.userId)
  if (!packId || !pack || !user || !userCanObservePack(pack, user)) {
    logger.warn('TM-GET-COMPENDIUM-ITEM: not permitted or not a compendium uuid', args.itemUuid)
    return emptyAck
  }

  const doc = await fromUuid(args.itemUuid)
  if (!doc) {
    logger.warn('TM-GET-COMPENDIUM-ITEM: could not resolve', args.itemUuid)
    return emptyAck
  }

  const packLabel = pack.metadata.label ?? packId
  const obj = doc.toObject()
  const journalHtml = journalDescriptionHtml(obj)
  if (journalHtml !== undefined) {
    obj.system = { ...(obj.system ?? {}), description: { value: journalHtml } }
  }

  // Typed local so the wire contract's field names stay compiler-checked;
  // the document serializes with optional-everything, so the required fields
  // get explicit defaults and only the free-form `system` bag is asserted.
  const compendiumItem: CompendiumItemData = {
    ...obj,
    name: obj.name ?? '',
    system: (obj.system ?? {}) as CompendiumItemData['system'],
    source: packLabel
  }
  return { ...makeAck(args), compendiumItem }
}
