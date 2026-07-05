import type { GetCompendiumItemArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

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
  const doc = await fromUuid(args.itemUuid)
  if (!doc) {
    logger.warn('TM-GET-COMPENDIUM-ITEM: could not resolve', args.itemUuid)
    return { ...makeAck(args), compendiumItem: null }
  }
  // UUID shape: Compendium.<scope>.<pack>.<type>.<id>
  // e.g. Compendium.pf2e.conditionitems.Item.xyz → pack id "pf2e.conditionitems"
  const uuidParts = args.itemUuid.split('.')
  const packId = uuidParts.length >= 3 ? `${uuidParts[1]}.${uuidParts[2]}` : args.itemUuid
  const source = getGame().packs.get(packId)?.metadata.label ?? packId

  const obj = doc.toObject()
  const journalHtml = journalDescriptionHtml(obj)
  if (journalHtml !== undefined) {
    obj.system = { ...(obj.system ?? {}), description: { value: journalHtml } }
  }

  return {
    ...makeAck(args),
    compendiumItem: { ...obj, source }
  }
}
