import type {
  CompendiumIndexEntry,
  CompendiumItemData,
  CompendiumPackInfo
} from '@/types/api-types'

// Pure shaping for reading compendia DIRECTLY over the socket (see
// api/compendium.ts), replacing what the GM-side handlers used to compute
// (foundry/handlers/listCompendia.ts, getCompendiumIndex.ts, getCompendiumItem.ts).
// Framework-free and side-effect-free so the uuid/permission/description logic
// is unit-testable without a socket or a store.

// ── Compendium UUID ──────────────────────────────────────────────────────────
// Compendium.<scope>.<pack>.<DocType>.<id>, e.g.
// Compendium.pf2e.equipment-srd.Item.abc123 → pack "pf2e.equipment-srd",
// documentType "Item", id "abc123". Returns undefined for anything that isn't a
// compendium reference (a world/actor-embedded uuid must never be resolved).
export function parseCompendiumUuid(
  uuid: string
): { packId: string; documentType: string; id: string } | undefined {
  if (!uuid.startsWith('Compendium.')) return undefined
  const parts = uuid.split('.')
  if (parts.length < 5) return undefined
  return { packId: `${parts[1]}.${parts[2]}`, documentType: parts[3], id: parts[4] }
}

// ── Actor-embedded item UUID ─────────────────────────────────────────────────
// Actor.<actorId>.Item.<itemId> — a link to an item that lives on a world actor
// rather than in a compendium (PF2e Dailies, for instance, links the staff it
// prepared on the character). Also matches the token-scoped form
// Scene.<id>.Token.<id>.Actor.<id>.Item.<id> by anchoring on the trailing
// Actor/Item pair. These resolve from the already-loaded world payload, with no
// socket round-trip (see api/compendium.ts).
const EMBEDDED_ITEM_UUID = /(?:^|\.)Actor\.([^.]+)\.Item\.([^.]+)$/

export function parseEmbeddedItemUuid(
  uuid: string
): { actorId: string; itemId: string } | undefined {
  // A pack actor's embedded item (Compendium.<pack>.Actor.<id>.Item.<id>) shares
  // the trailing shape but lives in a compendium, not the world payload.
  if (uuid.startsWith('Compendium.')) return undefined
  const match = EMBEDDED_ITEM_UUID.exec(uuid)
  if (!match) return undefined
  return { actorId: match[1], itemId: match[2] }
}

// ── Observe permission (client-side, cosmetic) ───────────────────────────────
// The server does NOT enforce compendium read permission, so this only decides
// which packs appear in the browse list — mirroring what a player sees in
// Foundry's own UI. Foundry roles are hierarchical (a higher role also holds the
// lower roles' grants), so a user's effective level is the max across every role
// up to their own; a GM always owns everything.
const ROLE_NAMES: Record<number, string> = {
  1: 'PLAYER',
  2: 'TRUSTED',
  3: 'ASSISTANT',
  4: 'GAMEMASTER'
}
const OWNERSHIP_LEVELS: Record<string, number> = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }
const OBSERVER = 2

type PackOwnership = Record<string, string | number> | undefined

export function packObserveLevel(ownership: PackOwnership, userRole: number): number {
  if (userRole >= 4) return 3 // GM: always owner
  let level = 0
  for (let role = 1; role <= userRole; role++) {
    const raw = ownership?.[ROLE_NAMES[role]]
    const value =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? OWNERSHIP_LEVELS[raw] : undefined
    if (typeof value === 'number' && value > level) level = value
  }
  return level
}

// The raw metadata shape the app receives in the world payload for each pack.
export interface PackMetadataLike {
  id?: string
  collection?: string
  label?: string
  type?: string
  documentName?: string
  packageName?: string
  ownership?: PackOwnership
}

function packId(meta: PackMetadataLike): string | undefined {
  return meta.id ?? meta.collection
}

function packDocumentType(meta: PackMetadataLike): string | undefined {
  return meta.type ?? meta.documentName
}

// A pack is visible in the browse list when its metadata resolves an id + type
// and the user may at least observe it. Packs with no ownership block are
// treated as observable (matches Foundry's permissive default for reads).
export function isPackVisible(meta: PackMetadataLike, userRole: number): boolean {
  if (!packId(meta) || !packDocumentType(meta)) return false
  if (!meta.ownership) return true
  return packObserveLevel(meta.ownership, userRole) >= OBSERVER
}

export function packInfoFromMetadata(meta: PackMetadataLike): CompendiumPackInfo | undefined {
  const id = packId(meta)
  const documentType = packDocumentType(meta)
  if (!id || !documentType) return undefined
  return {
    id,
    label: meta.label ?? id,
    documentType,
    packageName: meta.packageName ?? ''
  }
}

export function listVisiblePacks(
  packs: PackMetadataLike[],
  userRole: number
): CompendiumPackInfo[] {
  return packs
    .filter((meta) => isPackVisible(meta, userRole))
    .map(packInfoFromMetadata)
    .filter((info): info is CompendiumPackInfo => !!info)
}

// ── Index shaping ────────────────────────────────────────────────────────────
// Core fields Foundry's CompendiumCollection.getIndex() merges in by default.
// The raw socket get projects ONLY the fields we request, so these must be
// listed explicitly alongside the extras or entries come back missing name/img.
export const CORE_INDEX_FIELDS = ['_id', 'name', 'img', 'type', 'sort', 'folder']
export const EXTRA_INDEX_FIELDS = ['system.level.value', 'system.traits.rarity']

interface RawIndexEntry {
  _id?: string
  name?: string
  img?: string
  type?: string
  system?: { level?: { value?: number }; traits?: { rarity?: string } }
}

export function shapeIndexEntries(
  raw: RawIndexEntry[],
  packId: string,
  documentType: string
): CompendiumIndexEntry[] {
  return raw
    .filter((entry) => !!entry._id)
    .map((entry) => ({
      uuid: `Compendium.${packId}.${documentType}.${entry._id}`,
      name: entry.name ?? '',
      img: entry.img,
      type: entry.type,
      level: entry.system?.level?.value,
      // Raw rarity slug — the browse row localizes it against the viewed
      // character's world-locale trait map (see CompendiumBrowserOverlay).
      rarity: entry.system?.traits?.rarity
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── Item shaping ─────────────────────────────────────────────────────────────
interface RawCompendiumDoc {
  _id?: string
  name?: string
  img?: string
  type?: string
  system?: Record<string, unknown>
  // Journals serialize their rich HTML in text.content (a single page) or across
  // pages[].text.content (a whole entry), not under system.description.
  pages?: Array<{ name?: string; text?: { content?: string } }>
  text?: { content?: string }
}

// Fold a Journal document's HTML into the system.description.value shape the
// client renders, so journal links display like any other compendium entry.
// Returns undefined for non-journal docs (Items pass through untouched).
export function foldJournalDescription(doc: RawCompendiumDoc): string | undefined {
  if (typeof doc.text?.content === 'string') return doc.text.content
  if (!Array.isArray(doc.pages)) return undefined
  const pages = doc.pages.filter(
    (page): page is { name?: string; text: { content: string } } =>
      typeof page?.text?.content === 'string'
  )
  if (!pages.length) return ''
  const withHeadings = pages.length > 1
  return pages
    .map((page) =>
      withHeadings && page.name ? `<h2>${page.name}</h2>${page.text.content}` : page.text.content
    )
    .join('\n')
}

export function shapeCompendiumItem(doc: RawCompendiumDoc, packLabel: string): CompendiumItemData {
  const system = { ...(doc.system ?? {}) } as CompendiumItemData['system']
  const journalHtml = foldJournalDescription(doc)
  if (journalHtml !== undefined) {
    system.description = { value: journalHtml }
  }
  return {
    _id: doc._id,
    name: doc.name ?? '',
    img: doc.img,
    type: doc.type,
    source: packLabel,
    system
  }
}
